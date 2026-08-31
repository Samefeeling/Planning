/**
 * Derives the assembly Gantt: one row per order, grouped by line.
 *
 * Each row's bar starts at the later of the line's own queue, its
 * predecessor's finish, and any start day the planner dragged it to. Its
 * length is the remaining work divided by the crew on it, so allocating
 * another person visibly shortens the bar. The end of the bar is the Expect
 * Date, which is what the colour bands compare against Ship and Due.
 *
 * Pure — same shape as `computeBoardView` for moulding.
 */

import type { JobId } from '@/domain/ids';
import type { Job, MaterialStatus, PlanningDataset } from '@/domain/types';
import {
  DEFAULT_HORIZON_DAYS,
  LINES,
  MAX_WORKERS_PER_ORDER,
  type LineDef,
  type Worker,
} from '@/domain/assembly';
import type { DataIndexes } from '@/engine/indexes';
import { explodeMaterials } from '@/engine/materialExplosion';
import { materialAvailability } from '@/engine/materialAvailability';
import { releaseCheck, type ReleaseCheck } from './release';
import {
  crewNeededFor,
  dailyTargetQty,
  durationDays,
  remainingHours,
} from './duration';
import {
  addDays,
  scheduleStatus,
  startOfDay,
  type ScheduleStatus,
} from './dates';

export interface OrderRow {
  job: Job;
  line: LineDef;
  /** Crew allocated to this order (already capped at the maximum). */
  workers: Worker[];
  /** Bar start; null when the order cannot be scheduled (no crew). */
  start: Date | null;
  /** Bar end = Expect Date; null when unschedulable. */
  expectDate: Date | null;
  /** Bar length in days; null when unschedulable. */
  days: number | null;
  /** Units the crew should finish per day at this allocation. */
  dailyTarget: number;
  status: ScheduleStatus;
  material: MaterialStatus;
  release: ReleaseCheck;
  /** Predecessor order id, when this one waits on another. */
  predecessor: JobId | null;
  /** True when the bar was pushed later by its predecessor. */
  waitingOnPredecessor: boolean;
  /** Smallest crew that would hit the ship date, when one exists. */
  crewToHitShip: number | null;
}

export interface LineGroup {
  line: LineDef;
  rows: OrderRow[];
}

export interface AssemblyGanttView {
  /** First day column. */
  horizonStart: Date;
  /** Number of day columns. */
  horizonDays: number;
  groups: LineGroup[];
  /** Assembly orders not on any line yet. */
  pool: Job[];
  workers: Worker[];
  rowsByJob: Map<string, OrderRow>;
  jobsById: Map<string, Job>;
  totals: {
    orders: number;
    green: number;
    orange: number;
    red: number;
    /** Placed on a line but with nobody on them, so they have no dates yet. */
    needsCrew: number;
  };
}

export interface AssemblyInputs {
  dataset: PlanningDataset;
  indexes: DataIndexes;
  /** Line id → ordered job ids. */
  containers: Record<string, unknown[]>;
  /** Job id → allocated worker ids. */
  orderWorkers: Record<string, string[]>;
  /** Job id → ISO day the planner dragged the bar to. */
  orderStarts: Record<string, string>;
  /** Job id → end-of-shift completed-quantity entries. */
  progress: Record<string, { date: string; qty: number }[]>;
  workers: Worker[];
  today: Date;
}

/** Orders on the PMD row are shown for context, using their own dates. */
function mouldingContextRows(
  dataset: PlanningDataset,
  line: LineDef,
  today: Date,
): OrderRow[] {
  const noMaterial: MaterialStatus = {
    level: 'unknown',
    earliestStart: null,
    shortages: [],
  };
  /** When moulding plans to run it: its own start, else its due date. */
  const plannedStart = (j: Job): Date | null => j.startDate ?? j.dueDate;

  return dataset.jobs
    .filter((j) => j.department === 'moulding' && plannedStart(j))
    .sort((a, b) => plannedStart(a)!.getTime() - plannedStart(b)!.getTime())
    .slice(0, 6)
    .map((job) => {
      const days = Math.max(0.25, job.laborHrs / 24);
      const start = startOfDay(plannedStart(job) ?? today);
      return {
        job,
        line,
        workers: [],
        start,
        expectDate: addDays(start, days),
        days,
        dailyTarget: 0,
        status: {
          color: 'grey' as const,
          shipSlackDays: null,
          dueSlackDays: null,
          reason: 'Moulding plan — shown for context, not scheduled here',
        },
        material: noMaterial,
        release: {
          level: 'ready' as const,
          releasable: true,
          needsOverride: false,
          reason: 'Moulding plan',
        },
        predecessor: null,
        waitingOnPredecessor: false,
        crewToHitShip: null,
      };
    });
}

export function computeAssemblyGantt(input: AssemblyInputs): AssemblyGanttView {
  const { dataset, indexes, containers, orderWorkers, orderStarts, today } =
    input;
  const progress = input.progress ?? {};

  /**
   * Fold the shift's completed-quantity entries into the order, so the bar
   * shortens as work is booked and lengthens when a day misses its target.
   */
  const withProgress = (job: Job): Job => {
    const booked = (progress[String(job.id)] ?? []).reduce(
      (s, e) => s + e.qty,
      0,
    );
    if (booked <= 0) return job;
    const done = Math.min(job.completedQty + booked, job.completedQty + job.remainingQty);
    return {
      ...job,
      completedQty: done,
      remainingQty: Math.max(0, job.remainingQty + job.completedQty - done),
    };
  };

  const assemblyJobs = dataset.jobs
    .filter((j) => j.department === 'assembly')
    .map(withProgress);
  const jobsById = new Map(assemblyJobs.map((j) => [String(j.id), j]));
  const workersById = new Map(input.workers.map((w) => [String(w.id), w]));
  const horizonStart = startOfDay(today);

  const rowsByJob = new Map<string, OrderRow>();
  const placed = new Set<string>();
  const groups: LineGroup[] = [];

  // Two passes over the schedulable lines: build rows, then resolve the
  // predecessor chain (a successor may sit on a different line).
  const pending: { line: LineDef; ids: string[] }[] = [];
  for (const line of LINES) {
    if (!line.schedulable) continue;
    const ids = (containers[String(line.id)] ?? [])
      .map(String)
      .filter((id) => jobsById.has(id) && !placed.has(id));
    ids.forEach((id) => placed.add(id));
    pending.push({ line, ids });
  }

  const lineCursor = new Map<string, Date>();

  /** Resolve a row, recursing into its predecessor first. Cycle-safe. */
  const resolve = (id: string, seen: Set<string>): OrderRow | null => {
    const existing = rowsByJob.get(id);
    if (existing) return existing;
    const job = jobsById.get(id);
    if (!job) return null;
    if (seen.has(id)) return null; // dependency cycle — treat as unconstrained
    seen.add(id);

    const line =
      pending.find((p) => p.ids.includes(id))?.line ?? LINES[1];

    const workers = (orderWorkers[id] ?? [])
      .slice(0, MAX_WORKERS_PER_ORDER)
      .map((w) => workersById.get(String(w)))
      .filter((w): w is Worker => Boolean(w));

    const days = durationDays(job, workers.length);

    // Earliest start: the line's queue, the planner's drag, the predecessor.
    const cursor = lineCursor.get(String(line.id)) ?? horizonStart;
    const dragged = orderStarts[id] ? startOfDay(new Date(orderStarts[id])) : null;
    let start = dragged && dragged > cursor ? dragged : cursor;

    let waitingOnPredecessor = false;
    const predId = job.predecessor ? String(job.predecessor) : null;
    if (predId) {
      const pred = resolve(predId, seen);
      if (pred?.expectDate && pred.expectDate > start) {
        start = pred.expectDate;
        waitingOnPredecessor = true;
      }
    }

    const material = materialAvailability(
      explodeMaterials(job, indexes.bomByJob, indexes.bomByPart),
      indexes.inventoryByPart,
      indexes.poByPart,
    );
    // Material that only lands on a future PO cannot be worked before then.
    if (material.earliestStart && material.earliestStart > start) {
      start = startOfDay(material.earliestStart);
    }

    const expectDate = days === null ? null : addDays(start, days);
    const status = scheduleStatus(expectDate, job.shipDate, job.dueDate);

    const row: OrderRow = {
      job,
      line,
      workers,
      start: days === null ? null : start,
      expectDate,
      days,
      dailyTarget: dailyTargetQty(job, workers.length),
      status,
      material,
      release: releaseCheck(material, job.materialPrep),
      predecessor: job.predecessor,
      waitingOnPredecessor,
      crewToHitShip: job.shipDate
        ? crewNeededFor(
            job,
            Math.max(
              0.25,
              (job.shipDate.getTime() - start.getTime()) / 86_400_000,
            ),
          )
        : null,
    };

    rowsByJob.set(id, row);
    if (expectDate) lineCursor.set(String(line.id), expectDate);
    return row;
  };

  for (const { line, ids } of pending) {
    const rows = ids
      .map((id) => resolve(id, new Set()))
      .filter((r): r is OrderRow => r !== null);
    groups.push({ line, rows });
  }

  // PMD context row on top.
  const pmd = LINES.find((l) => !l.schedulable)!;
  groups.unshift({ line: pmd, rows: mouldingContextRows(dataset, pmd, today) });
  groups.sort((a, b) => a.line.sortIndex - b.line.sortIndex);

  const pool = assemblyJobs.filter((j) => !placed.has(String(j.id)));

  const scheduled = [...rowsByJob.values()];
  const horizonDays = Math.max(
    DEFAULT_HORIZON_DAYS,
    ...scheduled.map((r) =>
      r.expectDate
        ? Math.ceil(
            (r.expectDate.getTime() - horizonStart.getTime()) / 86_400_000,
          ) + 1
        : 0,
    ),
  );

  return {
    horizonStart,
    horizonDays,
    groups,
    pool,
    workers: input.workers,
    rowsByJob,
    jobsById,
    totals: {
      orders: scheduled.length,
      green: scheduled.filter((r) => r.status.color === 'green').length,
      orange: scheduled.filter((r) => r.status.color === 'orange').length,
      red: scheduled.filter((r) => r.status.color === 'red').length,
      needsCrew: scheduled.filter((r) => r.days === null).length,
    },
  };
}

/** Total remaining standard hours across a set of rows. */
export const totalRemainingHours = (rows: OrderRow[]): number =>
  rows.reduce((s, r) => s + remainingHours(r.job), 0);
