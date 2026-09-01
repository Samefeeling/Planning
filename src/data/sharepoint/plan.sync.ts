/**
 * Mirrors the board into a SharePoint list, one row per order.
 *
 * Two directions of information meet in that list and must not be confused:
 *
 *   from Planning1.csv  →  DueDate, OrderQty, RemainingQty
 *   from the planner    →  Operators, StartDate, Line
 *
 * So dragging a bar to balance the load writes **StartDate only** — the Due
 * Date is Epicor's and is never touched here. Conversely a refreshed export
 * updates DueDate and RemainingQty without disturbing the crew the supervisor
 * allocated.
 *
 * Rows are diffed before writing: an unchanged order is not touched, so the
 * five-minute refresh costs one read and no writes when nothing moved. Orders
 * that leave the export keep their row — the list is the record of what was
 * planned, not a copy of today's CSV.
 */

import type { AssemblyGanttView } from '@/engine/assembly/board';
import type { SharePointConfig } from '@/data/excel/sharepoint.client';
import type { ListItemFields } from './lists.client';
import {
  createListItem,
  fetchListItemsWithIds,
  updateListItem,
} from './lists.write';

/** Default list name; override with `VITE_PLAN_LIST`. */
export const PLAN_LIST = 'ASSY_Plan';

/** The internal column names this writes. Create them with these exact names. */
export const PLAN_COLUMNS = {
  jobNum: 'Title',
  line: 'Line',
  operators: 'Operators',
  operatorIds: 'OperatorIds',
  startDate: 'StartDate',
  dueDate: 'DueDate',
  expectDate: 'ExpectDate',
  orderQty: 'OrderQty',
  remainingQty: 'RemainingQty',
} as const;

/** One order as the list holds it. */
export interface PlanRow {
  jobNum: string;
  line: string | null;
  /** Stable worker keys — the SharePoint item ids from `ASSY_Operator`. */
  operatorIds: string[];
  /** The same people by name, so the list is readable without a join. */
  operatorNames: string[];
  /** Planner's start, from the drag. ISO, or null while unscheduled. */
  startDate: string | null;
  /** Epicor's date. Read from the CSV, never written by a drag. */
  dueDate: string | null;
  /** Where the current crew lands it. Derived, written for visibility. */
  expectDate: string | null;
  orderQty: number;
  remainingQty: number;
}

export interface SyncOutcome {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

/**
 * The rows the list should hold, from the board.
 *
 * Only schedulable lines: the PMD lane mirrors moulding's own plan, which this
 * page does not own and must not write back.
 */
export function planRowsFromBoard(board: AssemblyGanttView): PlanRow[] {
  return board.groups
    .filter((group) => group.line.schedulable)
    .flatMap((group) =>
      group.rows.map((row) => ({
        jobNum: String(row.job.id),
        line: group.line.name,
        operatorIds: row.workers.map((w) => String(w.id)),
        operatorNames: row.workers.map((w) => w.name),
        startDate: iso(row.start),
        dueDate: iso(row.job.dueDate),
        expectDate: iso(row.expectDate),
        orderQty: row.job.remainingQty + row.job.completedQty,
        remainingQty: row.job.remainingQty,
      })),
    );
}

function toFields(row: PlanRow): ListItemFields {
  const c = PLAN_COLUMNS;
  return {
    [c.jobNum]: row.jobNum,
    [c.line]: row.line ?? '',
    [c.operators]: row.operatorNames.join(', '),
    [c.operatorIds]: row.operatorIds.join(','),
    [c.startDate]: row.startDate,
    [c.dueDate]: row.dueDate,
    [c.expectDate]: row.expectDate,
    [c.orderQty]: row.orderQty,
    [c.remainingQty]: row.remainingQty,
  };
}

/**
 * True when the list row already says what we would write.
 *
 * Dates are compared as instants, not strings: SharePoint hands back
 * `2026-09-10T00:00:00Z` for what we sent as `2026-09-10T00:00:00.000Z`, and a
 * string compare would rewrite every row on every refresh.
 */
function samePlan(existing: ListItemFields, next: ListItemFields): boolean {
  return Object.entries(next).every(([key, value]) => {
    const had = existing[key];
    if (value === null || value === '') return had === null || had === undefined || had === '';
    if (typeof value === 'number') return Number(had) === value;

    const asDate = Date.parse(String(value));
    if (!Number.isNaN(asDate) && String(value).includes('T')) {
      const hadDate = Date.parse(String(had ?? ''));
      return !Number.isNaN(hadDate) && hadDate === asDate;
    }
    return String(had ?? '') === String(value);
  });
}

/**
 * Push `rows` into the list: create what is missing, patch what changed, leave
 * the rest alone. A read failure aborts before any write, so a transient Graph
 * error cannot half-apply a plan.
 */
export async function syncPlanRows(
  cfg: SharePointConfig,
  list: string,
  rows: PlanRow[],
): Promise<SyncOutcome> {
  const out: SyncOutcome = { created: 0, updated: 0, unchanged: 0, errors: [] };

  const existing = await fetchListItemsWithIds(cfg, list);
  if (!existing.ok) {
    out.errors.push(existing.error);
    return out;
  }

  const byJob = new Map<string, { id: string; fields: ListItemFields }>();
  for (const item of existing.value) {
    const key = String(item.fields[PLAN_COLUMNS.jobNum] ?? '').trim();
    if (key) byJob.set(key, item);
  }

  for (const row of rows) {
    const fields = toFields(row);
    const found = byJob.get(row.jobNum);

    if (!found) {
      const res = await createListItem(cfg, list, fields);
      if (res.ok) out.created++;
      else out.errors.push(res.error);
      continue;
    }
    if (samePlan(found.fields, fields)) {
      out.unchanged++;
      continue;
    }
    const res = await updateListItem(cfg, list, found.id, fields);
    if (res.ok) out.updated++;
    else out.errors.push(res.error);
  }

  return out;
}
