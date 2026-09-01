/**
 * Derives the assembly Gantt: one row per order, grouped by line.
 *
 * ## Where a bar starts
 *
 * A line is not a single station: it has several build positions, so up to
 * `line.parallelOrders` orders run side by side. Each order asks to start on
 * the day the planner dragged it to — failing that, the day Epicor scheduled it
 * — and gets that day whenever the line still has a position free. Only when
 * every position is busy does the order queue behind whichever frees first.
 * That is what makes any bar draggable, not just the first on the line: there
 * is no single queue pinning the rest of the line behind it.
 *
 * Two hard constraints still push a bar later: a component another order is
 * still making, and material that has not landed.
 *
 * ## What waits for what
 *
 * `JobMaterialReq.csv` says which components each order consumes, and
 * `engine/assembly/dependencies` turns those into the orders that build them.
 * An order starts no earlier than the last of them finishes — so a chair on
 * ASSY sits behind its cover on UPL and its shell on a moulding press, and
 * pulling any of those forward pulls the chair forward with it.
 *
 * ## Where a bar ends
 *
 * Its length is the remaining work divided by the crew on it, so allocating
 * another person visibly shortens it. Those are *working* days: the factory is
 * shut at the weekend, so a bar steps over Saturday and Sunday unless the
 * supervisor has approved overtime on that order. The end of the bar is the
 * Expect Date, which is what the colour bands compare against Ship and Due —
 * past Due is red, and Due itself never moves from here.
 *
 * Pure — same shape as `computeBoardView` for moulding.
 */

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
import { buildDependencies, type Dependency } from './dependencies';
import {
  crewNeededFor,
  dailyTargetQty,
  durationDays,
  remainingHours,
} from './duration';
import {
  addDays,
  addWorkingDays,
  nextWorkingDay,
  scheduleStatus,
  startOfDay,
  type ScheduleStatus,
} from './dates';
import { lineLoad, type LineLoad } from './workload';

export interface OrderRow {
  job: Job;
  line: LineDef;
  /** Crew allocated to this order (already capped at the maximum). */
  workers: Worker[];
  /** Bar start; null when the order cannot be scheduled (no crew). */
  start: Date | null;
  /** Bar end = Expect Date; null when unschedulable. */
  expectDate: Date | null;
  /** Bar length in days worked; null when unschedulable. */
  days: number | null;
  /** Which of the line's parallel build positions the order took (0-based). */
  slot: number;
  /** Approved by the supervisor to run through the weekend. */
  overtime: boolean;
  /** Units the crew should finish per day at this allocation. */
  dailyTarget: number;
  status: ScheduleStatus;
  material: MaterialStatus;
  release: ReleaseCheck;
  /** Orders this one waits on, with the component each supplies. */
  predecessors: Dependency[];
  /** The one actually holding the bar back, when any is; else null. */
  waitingOn: Dependency | null;
  /** Smallest crew that would hit the ship date, when one exists. */
  crewToHitShip: number | null;
  /** Explicitly closed during today's shift; retained until tomorrow for confirmation. */
  completedToday: boolean;
}

export interface LineGroup {
  line: LineDef;
  rows: OrderRow[];
  /** Work still queued on the line, and how long its crew needs to clear it. */
  load: LineLoad;
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
  /** Material links that could not be used, e.g. a circular one. */
  dependencyWarnings: string[];
  totals: {
    orders: number;
    green: number;
    orange: number;
    red: number;
    /** Placed on a line but with nobody on them, so they have no dates yet. */
    needsCrew: number;
    /** Standard hours still to run across every scheduled order. */
    remainingHours: number;
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
  /** Job id → supervisor approval to work this order at the weekend. */
  orderOvertime?: Record<string, boolean>;
  /** Job id → end-of-shift completed-quantity entries. */
  progress: Record<string, { date: string; qty: number }[]>;
  /** Daily production confirmations, including explicit job completion. */
  production?: Record<string, { date: string; jobCompleted: boolean }[]>;
  workers: Worker[];
  today: Date;
}

/**
 * Put an order on one of a line's build positions.
 *
 * `slots` holds, per position, the moment it next frees up. An order that asks
 * for a day when any position is already clear keeps that exact day. When they
 * are all busy the answer depends on who is asking:
 *
 *   - left to itself, the order falls in behind the position that clears first,
 *     which is what keeps a line to three orders at a time;
 *   - dragged there by the planner, it stays put. A drag is an instruction, not
 *     a request — the last thing it should do is quietly snap back — and the
 *     day then reads over capacity on the load histogram, which is the honest
 *     way to say the line has been asked to run four orders at once.
 */
function claimSlot(
  slots: Date[],
  want: Date,
  pinned: boolean,
): { start: Date; slot: number } {
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].getTime() <= want.getTime()) return { start: want, slot: i };
  }
  let first = 0;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].getTime() < slots[first].getTime()) first = i;
  }
  return { start: pinned ? want : slots[first], slot: first };
}

/** Moulding rows keep moulding's own dates; this board does not schedule them. */
const MOULDING_MATERIAL: MaterialStatus = {
  level: 'unknown',
  earliestStart: null,
  shortages: [],
};

/** When moulding plans to run an order: its own start, else its due date. */
const mouldingStart = (j: Job): Date | null => j.startDate ?? j.dueDate;

/**
 * One moulding order as a board row.
 *
 * Read-only: the dates are moulding's, not ours. The row exists so the press
 * work is visible above the assembly lines, and so an assembly order that
 * needs one of these shells can be held behind the run that makes it.
 */
function mouldingRow(job: Job, line: LineDef, today: Date): OrderRow {
  const days = Math.max(0.25, job.laborHrs / 24);
  const start = startOfDay(mouldingStart(job) ?? today);
  return {
    job,
    line,
    workers: [],
    start,
    expectDate: addDays(start, days),
    days,
    slot: 0,
    overtime: false,
    dailyTarget: 0,
    status: {
      color: 'grey' as const,
      shipSlackDays: null,
      dueSlackDays: null,
      reason: 'Moulding plan — shown for context, not scheduled here',
    },
    material: MOULDING_MATERIAL,
    release: {
      level: 'ready' as const,
      releasable: true,
      needsOverride: false,
      reason: 'Moulding plan',
    },
    predecessors: [],
    waitingOn: null,
    crewToHitShip: null,
    completedToday: false,
  };
}

/**
 * Which moulding orders the PMD row shows.
 *
 * Every press job assembly is waiting on, because those are the ones a
 * supervisor needs to be able to see and chase, then the next few by date to
 * fill the row out.
 */
function mouldingContextRows(
  rows: Map<string, OrderRow>,
  neededIds: Set<string>,
  fill: number,
): OrderRow[] {
  const byDate = (a: OrderRow, b: OrderRow): number =>
    a.start!.getTime() - b.start!.getTime();
  const needed = [...neededIds]
    .map((id) => rows.get(id))
    .filter((r): r is OrderRow => Boolean(r));
  const rest = [...rows.values()]
    .filter((r) => !neededIds.has(String(r.job.id)) && mouldingStart(r.job))
    .sort(byDate)
    .slice(0, Math.max(0, fill - needed.length));
  return [...needed, ...rest].sort(byDate);
}

export function computeAssemblyGantt(input: AssemblyInputs): AssemblyGanttView {
  const { dataset, indexes, containers, orderWorkers, orderStarts, today } =
    input;
  const orderOvertime = input.orderOvertime ?? {};
  const progress = input.progress ?? {};
  const production = input.production ?? {};
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const completionDate = (job: Job): string | null =>
    (production[String(job.id)] ?? [])
      .filter((entry) => entry.jobCompleted)
      .map((entry) => entry.date)
      .sort()
      .at(-1) ?? null;

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
    // A completed order remains grey for the confirmation day, then leaves
    // both the lanes and the unassigned pool on the next calendar day.
    .filter((j) => !completionDate(j) || completionDate(j)! >= todayKey)
    .map(withProgress);
  const jobsById = new Map(assemblyJobs.map((j) => [String(j.id), j]));
  const workersById = new Map(input.workers.map((w) => [String(w.id), w]));
  const horizonStart = startOfDay(today);

  // The moulding plan, as rows. Built for every press job rather than the few
  // that fit on screen, because any of them may be the one an assembly order
  // is waiting for.
  const pmdLine = LINES.find((l) => !l.schedulable)!;
  const mouldingRows = new Map<string, OrderRow>(
    dataset.jobs
      .filter((j) => j.department === 'moulding')
      .map((j) => [String(j.id), mouldingRow(j, pmdLine, today)]),
  );

  // What waits for what, over both departments — a chair waits for its shell.
  const { byJob: dependsOn, warnings: dependencyWarnings } = buildDependencies(
    [...assemblyJobs, ...[...mouldingRows.values()].map((r) => r.job)],
    dataset.jobLinks ?? [],
  );

  const rowsByJob = new Map<string, OrderRow>();
  const placed = new Set<string>();
  const groups: LineGroup[] = [];

  /**
   * The day an order asks to begin: what the planner dragged it to, else the
   * day Epicor scheduled it. Anything already in the past starts as soon as
   * the board opens — there is no working yesterday.
   */
  const wantedStart = (id: string): Date => {
    const pinned = orderStarts[id];
    const wanted = pinned
      ? startOfDay(new Date(pinned))
      : jobsById.get(id)?.startDate
        ? startOfDay(jobsById.get(id)!.startDate!)
        : horizonStart;
    return wanted > horizonStart ? wanted : horizonStart;
  };

  // Two passes over the schedulable lines: build rows, then resolve the
  // predecessor chain (a successor may sit on a different line). Within a line
  // the earliest-wanted order claims a build position first, so dragging one
  // bar earlier moves it ahead of the others rather than being ignored.
  const pending: { line: LineDef; ids: string[] }[] = [];
  for (const line of LINES) {
    if (!line.schedulable) continue;
    const ids = (containers[String(line.id)] ?? [])
      .map(String)
      .filter((id) => jobsById.has(id) && !placed.has(id));
    ids.forEach((id) => placed.add(id));
    ids.sort((a, b) => wantedStart(a).getTime() - wantedStart(b).getTime());
    pending.push({ line, ids });
  }

  // Line id → when each of its build positions next frees up.
  const slotsByLine = new Map<string, Date[]>();
  const slotsFor = (line: LineDef): Date[] => {
    const key = String(line.id);
    let slots = slotsByLine.get(key);
    if (!slots) {
      slots = Array.from({ length: Math.max(1, line.parallelOrders) }, () =>
        startOfDay(horizonStart),
      );
      slotsByLine.set(key, slots);
    }
    return slots;
  };

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
    const completedToday = completionDate(job) === todayKey;
    // Weekend work is a cost decision, so it is approved per order rather than
    // assumed. Without it the bar steps over Saturday and Sunday.
    const overtime = Boolean(orderOvertime[id]);

    // Where the order asks to be, before the line's capacity has its say.
    let want = wantedStart(id);

    // Nothing can start before the last of its components is finished. A
    // predecessor on another assembly line is scheduled the same way as this
    // one, so it is resolved first; a moulding predecessor keeps its own dates.
    const predecessors = dependsOn.get(id) ?? [];
    let waitingOn: Dependency | null = null;
    for (const dep of predecessors) {
      const predId = String(dep.onJobId);
      const pred = resolve(predId, seen) ?? mouldingRows.get(predId) ?? null;
      if (pred?.expectDate && pred.expectDate > want) {
        want = pred.expectDate;
        waitingOn = dep;
      }
    }

    const material = materialAvailability(
      explodeMaterials(job, indexes.bomByJob, indexes.bomByPart),
      indexes.inventoryByPart,
      indexes.poByPart,
    );
    // Material that only lands on a future PO cannot be worked before then.
    if (material.earliestStart && material.earliestStart > want) {
      want = startOfDay(material.earliestStart);
    }
    if (!overtime) want = nextWorkingDay(want);

    // Take one of the line's build positions. The order keeps the day it asked
    // for whenever one is free; otherwise it queues behind the first to clear,
    // unless the planner dragged it there by hand.
    const slots = slotsFor(line);
    const claim = claimSlot(slots, want, Boolean(orderStarts[id]));
    const start = overtime ? claim.start : nextWorkingDay(claim.start);

    const expectDate = completedToday
      ? horizonStart
      : days === null
        ? null
        : overtime
          ? addDays(start, days)
          : addWorkingDays(start, days);
    const status = completedToday
      ? {
          color: 'grey' as const,
          shipSlackDays: null,
          dueSlackDays: null,
          reason: 'Job completed today',
        }
      : scheduleStatus(expectDate, job.shipDate, job.dueDate);

    const row: OrderRow = {
      job,
      line,
      workers,
      start: completedToday ? horizonStart : days === null ? null : start,
      expectDate,
      days: completedToday ? 0 : days,
      slot: claim.slot,
      overtime,
      dailyTarget: dailyTargetQty(job, workers.length),
      status,
      material,
      release: releaseCheck(material, job.materialPrep),
      predecessors,
      waitingOn,
      crewToHitShip: job.shipDate
        ? crewNeededFor(
            job,
            Math.max(
              0.25,
              (job.shipDate.getTime() - start.getTime()) / 86_400_000,
            ),
          )
        : null,
      completedToday,
    };

    rowsByJob.set(id, row);
    // The position stays taken until this order finishes on it. A closed order
    // gives it straight back. An order pinned over the top of a busy position
    // must not free it early, so the later of the two wins.
    if (expectDate && !completedToday && expectDate > slots[claim.slot]) {
      slots[claim.slot] = expectDate;
    }
    return row;
  };

  const withLoad = (line: LineDef, rows: OrderRow[]): LineGroup => ({
    line,
    rows,
    load: lineLoad(rows),
  });

  for (const { line, ids } of pending) {
    const rows = ids
      .map((id) => resolve(id, new Set()))
      .filter((r): r is OrderRow => r !== null);
    groups.push(withLoad(line, rows));
  }

  // PMD context row on top, led by the press work assembly is waiting for.
  const neededMoulding = new Set(
    [...rowsByJob.values()]
      .flatMap((r) => r.predecessors)
      .map((d) => String(d.onJobId))
      .filter((id) => mouldingRows.has(id)),
  );
  groups.unshift(
    withLoad(pmdLine, mouldingContextRows(mouldingRows, neededMoulding, 6)),
  );
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
    dependencyWarnings,
    totals: {
      orders: scheduled.length,
      green: scheduled.filter((r) => r.status.color === 'green').length,
      orange: scheduled.filter((r) => r.status.color === 'orange').length,
      red: scheduled.filter((r) => r.status.color === 'red').length,
      needsCrew: scheduled.filter((r) => r.days === null).length,
      remainingHours: totalRemainingHours(scheduled),
    },
  };
}

/** Total remaining standard hours across a set of rows. */
export const totalRemainingHours = (rows: OrderRow[]): number =>
  rows.reduce((s, r) => s + remainingHours(r.job), 0);
