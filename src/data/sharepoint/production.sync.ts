/**
 * Mirrors the board into the `ASSY_Production` SharePoint list.
 *
 * One row per **order per day**, matching the list Resero already designed —
 * the same shape as `PMD_Production`, so KPI work can aggregate the two
 * departments without a second mapping layer.
 *
 * Each row carries two kinds of column, and the split is the whole design:
 *
 *   order-level — Line, Operators, StartDate, DueDate, OrderQty, RemainingQty.
 *     The same on every row of a job, and kept current on all of them, so a
 *     re-exported Due Date reaches rows booked weeks ago.
 *   row-level — ShiftOutput, Complete, Reject, Rework, JobCompleted, Paused,
 *     PauseReason, Notes. What that particular shift did.
 *
 * Which side owns what:
 *
 *   Planning1.csv  →  DueDate, OrderQty, RemainingQty
 *   the supervisor →  Operators, StartDate, Line
 *   the shift      →  everything row-level
 *
 * So dragging a bar to level the load writes **StartDate only**: Epicor owns
 * the Due Date and this board never changes it.
 *
 * Rows are diffed before writing, so the five-minute refresh costs one read and
 * no writes when nothing moved. Orders that leave the export keep their rows —
 * the list is the production record, not a copy of today's CSV.
 */

import type { AssemblyGanttView } from '@/engine/assembly/board';
import type { SharePointConfig } from '@/data/excel/sharepoint.client';
import type { ProductionEntry } from '@/store/planStore';
import type { ListItemFields } from './lists.client';
import {
  createListItem,
  fetchListItemsWithIds,
  updateListItem,
} from './lists.write';

/** Default list name; override with `VITE_PRODUCTION_LIST`. */
export const PRODUCTION_LIST = 'ASSY_Production';

/** Internal column names. Create the list with these exact names. */
export const PRODUCTION_COLUMNS = {
  // key
  jobNum: 'Title',
  date: 'Date',
  recordKey: 'RecordKey',
  // order-level
  line: 'Line',
  operators: 'Operators',
  operatorIds: 'OperatorIds',
  startDate: 'StartDate',
  actualStartAt: 'ActualStartAt',
  startOverrideReason: 'StartOverrideReason',
  dueDate: 'DueDate',
  expectDate: 'ExpectDate',
  orderQty: 'OrderQty',
  remainingQty: 'RemainingQty',
  // row-level
  shiftOutput: 'ShiftOutput',
  complete: 'Complete',
  reject: 'Reject',
  rework: 'Rework',
  jobCompleted: 'JobCompleted',
  completedAt: 'CompletedAt',
  paused: 'Paused',
  pauseReason: 'PauseReason',
  notes: 'Notes',
} as const;

/** The order-level columns, kept identical across every row of a job. */
const ORDER_LEVEL = [
  PRODUCTION_COLUMNS.line,
  PRODUCTION_COLUMNS.startDate,
  PRODUCTION_COLUMNS.actualStartAt,
  PRODUCTION_COLUMNS.startOverrideReason,
  PRODUCTION_COLUMNS.dueDate,
  PRODUCTION_COLUMNS.expectDate,
  PRODUCTION_COLUMNS.orderQty,
  PRODUCTION_COLUMNS.remainingQty,
] as const;

/** What the plan says about an order, regardless of which day's row holds it. */
export interface OrderFacts {
  jobNum: string;
  line: string | null;
  /** Stable worker keys — the SharePoint item ids from `ASSY_Operator`. */
  operatorIds: string[];
  /** The same people by name, so the list is readable without a join. */
  operatorNames: string[];
  /** True when the roster is the built-in fallback; those ids must not sync. */
  hasSyntheticCrew?: boolean;
  /** Effective start: the later of the drag, the queue and the predecessor. */
  startDate: string | null;
  actualStartAt?: string | null;
  startOverrideReason?: string | null;
  /** Epicor's date. From the CSV, never written by a drag. */
  dueDate: string | null;
  expectDate: string | null;
  orderQty: number;
  remainingQty: number;
  /** `YYYY-MM-DD` for the row to open the order with when it has none yet. */
  anchorDay: string;
  /** One entry per booked shift. */
  shifts: ProductionEntry[];
}

export interface SyncOutcome {
  created: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const iso = (d: Date | null | undefined): string | null =>
  d ? d.toISOString() : null;

const day = (d: Date | null | undefined): string | null =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : null;

/**
 * What the list should say about every order on the board.
 *
 * Schedulable lines only: the PMD lane mirrors moulding's own plan, which this
 * page does not own and must not write back.
 */
export function orderFactsFromBoard(
  board: AssemblyGanttView,
  production: Record<string, ProductionEntry[]>,
): OrderFacts[] {
  return board.groups
    .filter((group) => group.line.schedulable)
    .flatMap((group) =>
      group.rows.map((row) => {
        const anchorDay = day(row.start) ?? day(board.horizonStart)!;
        const anchorIds =
          row.crewDays?.find((crewDay) => crewDay.day === anchorDay)?.workerIds ??
          row.crewDays?.[0]?.workerIds ??
          row.workers.map((worker) => String(worker.id));
        const anchorCrew = row.workers.filter((worker) =>
          anchorIds.includes(String(worker.id)),
        );
        return {
          jobNum: String(row.job.id),
          line: group.line.name,
          operatorIds: anchorCrew.map((worker) => String(worker.id)),
          operatorNames: anchorCrew.map((worker) => worker.name),
          hasSyntheticCrew: anchorCrew.some((worker) => worker.synthetic),
          startDate: iso(row.plannedStart),
          actualStartAt: row.actualStart?.startedAt ?? null,
          startOverrideReason: row.actualStart?.overrideReason ?? null,
          dueDate: iso(row.job.dueDate),
          expectDate: iso(row.expectDate),
          orderQty: row.job.remainingQty + row.job.completedQty,
          remainingQty: row.job.remainingQty,
          // The day the order opens its record on. Falls back to the horizon so
          // an order with no crew — and so no start — still gets its one row.
          anchorDay,
          shifts: production[String(row.job.id)] ?? [],
        };
      }),
    );
}

function orderFields(facts: OrderFacts): ListItemFields {
  const c = PRODUCTION_COLUMNS;
  return {
    [c.line]: facts.line ?? '',
    [c.startDate]: facts.startDate,
    [c.actualStartAt]: facts.actualStartAt ?? null,
    [c.startOverrideReason]: facts.startOverrideReason ?? '',
    [c.dueDate]: facts.dueDate,
    [c.expectDate]: facts.expectDate,
    [c.orderQty]: facts.orderQty,
    [c.remainingQty]: facts.remainingQty,
  };
}

/** An empty shift — the row an order opens with before anything is booked. */
function blankShift(date: string): ProductionEntry {
  return {
    date,
    complete: 0,
    reject: 0,
    rework: 0,
    shiftOutput: 0,
    paused: false,
    pauseReason: null,
    jobCompleted: false,
    notes: '',
  };
}

function rowFields(facts: OrderFacts, shift: ProductionEntry): ListItemFields {
  const c = PRODUCTION_COLUMNS;
  const operatorIds = shift.operatorIds ?? facts.operatorIds;
  const operatorNames = shift.operatorNames ?? facts.operatorNames;
  return {
    [c.jobNum]: facts.jobNum,
    [c.date]: shift.date,
    [c.recordKey]: `${facts.jobNum}|${shift.date}`,
    ...orderFields(facts),
    [c.operators]: operatorNames.join(', '),
    [c.operatorIds]: operatorIds.join(','),
    [c.shiftOutput]: shift.shiftOutput,
    [c.complete]: shift.complete,
    [c.reject]: shift.reject,
    [c.rework]: shift.rework,
    [c.jobCompleted]: shift.jobCompleted,
    [c.completedAt]: shift.completedAt ?? null,
    [c.paused]: shift.paused,
    [c.pauseReason]: shift.pauseReason ?? '',
    [c.notes]: shift.notes,
  };
}

/**
 * True when the row already says what we would write.
 *
 * Dates are compared as instants, not strings: SharePoint hands back
 * `2026-09-10T00:00:00Z` for what we sent as `2026-09-10T00:00:00.000Z`, and a
 * string compare would rewrite every row on every refresh.
 */
function same(existing: ListItemFields, next: ListItemFields): boolean {
  return Object.entries(next).every(([key, value]) => {
    const had = existing[key];
    if (value === null || value === '') {
      return had === null || had === undefined || had === '';
    }
    if (typeof value === 'number') return Number(had) === value;
    if (typeof value === 'boolean') return Boolean(had) === value;

    const text = String(value);
    if (text.includes('T')) {
      const wanted = Date.parse(text);
      const found = Date.parse(String(had ?? ''));
      if (!Number.isNaN(wanted)) return !Number.isNaN(found) && found === wanted;
    }
    return String(had ?? '') === text;
  });
}

/** The subset of `next` that `existing` disagrees with. */
function drift(
  existing: ListItemFields,
  next: ListItemFields,
  keys: readonly string[],
): ListItemFields {
  const out: ListItemFields = {};
  for (const key of keys) {
    if (!(key in next)) continue;
    if (!same(existing, { [key]: next[key] })) out[key] = next[key];
  }
  return out;
}

/** `YYYY-MM-DD` from whatever the list stores in its Date column. */
function rowDay(fields: ListItemFields): string {
  const raw = String(fields[PRODUCTION_COLUMNS.date] ?? '');
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw.trim();
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Push the board into the list: open a row for any order that has none, upsert
 * each booked shift, and refresh the order-level columns on every other row of
 * that job so a changed Due Date reaches all of them.
 *
 * A read failure aborts before any write, so a transient Graph error cannot
 * half-apply a plan.
 */
export async function syncProduction(
  cfg: SharePointConfig,
  list: string,
  orders: OrderFacts[],
): Promise<SyncOutcome> {
  const out: SyncOutcome = { created: 0, updated: 0, unchanged: 0, errors: [] };

  const existing = await fetchListItemsWithIds(cfg, list);
  if (!existing.ok) {
    out.errors.push(existing.error);
    return out;
  }

  const byJob = new Map<string, { id: string; fields: ListItemFields }[]>();
  for (const item of existing.value) {
    const key = String(item.fields[PRODUCTION_COLUMNS.jobNum] ?? '').trim();
    if (!key) continue;
    const list = byJob.get(key) ?? [];
    list.push(item);
    byJob.set(key, list);
  }

  for (const facts of orders) {
    if (facts.hasSyntheticCrew) {
      out.errors.push(
        `${facts.jobNum}: fallback demo employees were not written to SharePoint`,
      );
      continue;
    }
    const rows = byJob.get(facts.jobNum) ?? [];
    const byDay = new Map<string, (typeof rows)[number]>();
    const duplicateDays = new Set<string>();
    for (const row of rows) {
      const key = rowDay(row.fields);
      if (byDay.has(key)) duplicateDays.add(key);
      else byDay.set(key, row);
    }
    if (duplicateDays.size > 0) {
      out.errors.push(
        `${facts.jobNum}: duplicate SharePoint rows for ${[...duplicateDays].join(', ')}`,
      );
      continue;
    }

    // Every order holds at least one row: open one when the list has none and
    // no shift has been booked. Once it exists this branch never fires again,
    // so the anchor day cannot drift from one refresh to the next.
    const shifts =
      facts.shifts.length > 0
        ? facts.shifts
        : rows.length === 0
          ? [blankShift(facts.anchorDay)]
          : [];

    const touched = new Set<string>();

    for (const shift of shifts) {
      const wanted = rowFields(facts, shift);
      const found = byDay.get(shift.date);
      touched.add(shift.date);

      if (!found) {
        const res = await createListItem(cfg, list, wanted);
        if (res.ok) out.created++;
        else out.errors.push(res.error);
        continue;
      }
      if (same(found.fields, wanted)) {
        out.unchanged++;
        continue;
      }
      const res = await updateListItem(cfg, list, found.id, wanted);
      if (res.ok) out.updated++;
      else out.errors.push(res.error);
    }

    // Rows for days this board is not booking — older shifts, or entries the
    // backend added. Their production figures are theirs to keep; only the
    // order-level columns follow the plan.
    const orderWide = orderFields(facts);
    for (const row of rows) {
      if (touched.has(rowDay(row.fields))) continue;
      const isOpenPlaceholder =
        facts.shifts.length === 0 && rowDay(row.fields) === facts.anchorDay;
      const wanted = isOpenPlaceholder
        ? {
            ...orderWide,
            [PRODUCTION_COLUMNS.operators]: facts.operatorNames.join(', '),
            [PRODUCTION_COLUMNS.operatorIds]: facts.operatorIds.join(','),
          }
        : orderWide;
      const keys = isOpenPlaceholder
        ? [
            ...ORDER_LEVEL,
            PRODUCTION_COLUMNS.operators,
            PRODUCTION_COLUMNS.operatorIds,
          ]
        : ORDER_LEVEL;
      const stale = drift(row.fields, wanted, keys);
      if (Object.keys(stale).length === 0) {
        out.unchanged++;
        continue;
      }
      const res = await updateListItem(cfg, list, row.id, stale);
      if (res.ok) out.updated++;
      else out.errors.push(res.error);
    }
  }

  return out;
}
