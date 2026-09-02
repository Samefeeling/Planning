/**
 * A first crew for the orders that have none.
 *
 * A fresh export carries no allocation — `Planning1.csv` says what to build,
 * never who builds it — and an order with nobody on it has no duration, so it
 * has no bar, no Expect Date and no share of the load. Eighty such orders is
 * not a schedule, and staffing them one at a time is not a morning's work.
 *
 * So: hand every unstaffed order a crew drawn from the people qualified for
 * its line, cycling through them down the queue. The result is a starting
 * point, not an answer — it knows nothing about who is good at what, and the
 * supervisor is expected to change it. That is why it only ever *adds*: an
 * order somebody has already crewed is left exactly as it is.
 *
 * Pure. No React, no store.
 */

import {
  MAX_WORKERS_PER_ORDER,
  type CrewAssignment,
  type Worker,
} from '@/domain/assembly';
import { durationDays, remainingHours, remainingQty } from './duration';
import { addDays, addWorkingDays } from './dates';
import { planVariableCrew } from './crewSchedule';
import type { AssemblyGanttView, OrderRow } from './board';

export interface CrewSuggestion {
  /** Job id → worker ids, for the orders that had nobody on them. */
  allocations: Record<string, string[]>;
  /** How many orders were given a crew. */
  staffed: number;
  /** Orders left alone because nobody on shift is qualified for their line. */
  unstaffed: number;
}

/**
 * How many people to put on one order.
 *
 * A line runs `positions` orders side by side, so its people divide between
 * that many teams: eight people over three positions is two per order with a
 * pair spare, not eight on the first order and nobody on the rest. Never more
 * than the four an order can hold, and never fewer than one — a team of one
 * is slow, but it is a schedule, and no team at all is not.
 */
function crewSize(available: number, positions: number): number {
  const perTeam = Math.floor(available / Math.max(1, positions));
  return Math.max(1, Math.min(perTeam, MAX_WORKERS_PER_ORDER, available));
}

/**
 * When an order would run with `crew` people on it.
 *
 * From `plannedStart`, which the line hands out whether or not anyone is
 * allocated — so this answers for an order nobody is on yet, which is exactly
 * when a supervisor is deciding who to put on it.
 */
function span(row: OrderRow, crew: number): { from: Date; to: Date } | null {
  const days = durationDays(row.job, crew);
  if (days === null) return null;
  const from = row.plannedStart;
  return {
    from,
    to: row.overtime ? addDays(from, days) : addWorkingDays(from, days),
  };
}

/**
 * The orders `workerId` is already on that would run at the same time as
 * `target` — the work they cannot be in two places for.
 *
 * Nobody does two jobs at once, so this is the check behind allocating: the
 * supervisor either picks someone else or says explicitly that this one is
 * fine (splitting their day between two orders, or covering a hand-over).
 * Bars that merely touch — one ending as the next begins — do not clash.
 *
 * Only the target order can be unstaffed; any order the person is already on
 * has at least one person, and therefore has real dates.
 */
export function clashesFor(
  rows: OrderRow[],
  target: OrderRow,
  workerId: string,
): OrderRow[] {
  if (!target.line.schedulable || target.completedToday) return [];
  const current =
    target.crewAssignments ??
    target.workers.map((worker) => ({
      workerId: String(worker.id),
      fromDay: null,
      toDayExclusive: null,
    }));
  const proposed: CrewAssignment[] = current.some(
    (assignment) => assignment.workerId === workerId,
  )
    ? current
    : [...current, { workerId, fromDay: null, toDayExclusive: null }];
  const mine = planVariableCrew(
    target.plannedStart,
    remainingHours(target.job),
    proposed,
    target.overtime,
  );
  const mineDays = new Set(
    mine.crewDays
      .filter((day) => day.workerIds.includes(workerId))
      .map((day) => day.day),
  );
  if (mineDays.size === 0) return [];
  const id = String(target.job.id);
  return rows.filter(
    (r) =>
      String(r.job.id) !== id &&
      r.line.schedulable &&
      !r.completedToday &&
      r.workers.some((w) => String(w.id) === workerId) &&
      (r.crewDays
        ? r.crewDays.some(
            (day) =>
              day.workerIds.includes(workerId) && mineDays.has(day.day),
          )
        : (() => {
            const legacy = span(r, Math.max(1, r.workers.length));
            return legacy
              ? mine.crewDays.some(
                  (day) => day.date >= legacy.from && day.date < legacy.to,
                )
              : false;
          })()),
  );
}

export interface FreeCrewWindow {
  /** First local day the worker can help this order. */
  fromDay: string;
  /** First unavailable day; null means they can stay through completion. */
  toDayExclusive: string | null;
  /** Orders beginning on the boundary, shown as the reason for the hand-off. */
  nextJobIds: string[];
}

/**
 * Earliest useful gap a worker can lend to an order without touching a later
 * commitment. This is what turns Bill's empty 2/9–3/9 into a safe hand-off
 * instead of rejecting him because he has another order later in the week.
 */
export function freeCrewWindow(
  rows: OrderRow[],
  target: OrderRow,
  workerId: string,
): FreeCrewWindow | null {
  const current =
    target.crewAssignments ??
    target.workers.map((worker) => ({
      workerId: String(worker.id),
      fromDay: null,
      toDayExclusive: null,
    }));
  const proposed: CrewAssignment[] = current.some(
    (assignment) => assignment.workerId === workerId,
  )
    ? current
    : [...current, { workerId, fromDay: null, toDayExclusive: null }];
  const plan = planVariableCrew(
    target.plannedStart,
    remainingHours(target.job),
    proposed,
    target.overtime,
  );
  const candidateDays = plan.crewDays.filter((day) =>
    day.workerIds.includes(workerId),
  );
  if (candidateDays.length === 0) return null;

  const otherRows = rows.filter(
    (row) =>
      String(row.job.id) !== String(target.job.id) && !row.completedToday,
  );
  const busy = new Map<string, string[]>();
  for (const row of otherRows) {
    for (const day of row.crewDays ?? []) {
      if (!day.workerIds.includes(workerId)) continue;
      const jobs = busy.get(day.day) ?? [];
      jobs.push(String(row.job.id));
      busy.set(day.day, jobs);
    }
  }

  const firstConflict = candidateDays.findIndex((day) => busy.has(day.day));
  if (firstConflict < 0) {
    return {
      fromDay: candidateDays[0].day,
      toDayExclusive: null,
      nextJobIds: [],
    };
  }
  // A gap after an immediate conflict needs an explicit user choice; the
  // default offered here is deliberately only the safe leading gap.
  if (firstConflict === 0) return null;
  const boundary = candidateDays[firstConflict].day;
  return {
    fromDay: candidateDays[0].day,
    toDayExclusive: boundary,
    nextJobIds: busy.get(boundary) ?? [],
  };
}

interface Span {
  from: Date;
  to: Date;
}

const clashesWith = (booked: Span[] | undefined, want: Span): boolean =>
  (booked ?? []).some((s) => s.from < want.to && want.from < s.to);

/** Orders on a schedulable line with nobody on them and work left to do. */
const waitingRows = (board: AssemblyGanttView): OrderRow[] =>
  board.groups
    .filter((g) => g.line.schedulable)
    .flatMap((g) => g.rows)
    .filter(
      (r) =>
        r.workers.length === 0 && !r.completedToday && remainingQty(r.job) > 0,
    );

/** How many orders are waiting for a crew — the number on the button. */
export const countUnstaffed = (board: AssemblyGanttView): number =>
  waitingRows(board).length;

/**
 * How many waves to run. Each one re-derives the board, so this bounds the
 * work; whatever is left over is simply offered again next time.
 */
const MAX_WAVES = 40;

/**
 * Staff the earliest waiting order on each line, and say who went where.
 *
 * One per line, not several, because the moment an order is crewed the whole
 * schedule moves — it takes a build position, and anything waiting on its
 * parts follows it out. Guessing where the next two would land is how a
 * suggestion ends up double-booking people; asking the scheduler is not.
 */
function staffOneWave(
  board: AssemblyGanttView,
  into: Record<string, string[]>,
): number {
  // Who is committed when, from the board as it stands.
  const booked = new Map<string, Span[]>();
  for (const row of board.groups.flatMap((g) => g.rows)) {
    if (!row.start || !row.expectDate || row.completedToday) continue;
    for (const w of row.workers) {
      const held = booked.get(String(w.id));
      const span = { from: row.start, to: row.expectDate };
      if (held) held.push(span);
      else booked.set(String(w.id), [span]);
    }
  }

  let staffed = 0;
  for (const group of board.groups) {
    if (!group.line.schedulable) continue;

    // Same rule as the crew picker: in today, and qualified for this line.
    const pool: Worker[] = board.workers.filter(
      (w) => w.onShift && w.skills.includes(group.line.key),
    );
    if (pool.length === 0) continue;

    const waiting = group.rows
      .filter(
        (r) =>
          r.workers.length === 0 &&
          !r.completedToday &&
          remainingQty(r.job) > 0 &&
          !into[String(r.job.id)],
      )
      .sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime());

    const size = crewSize(pool.length, group.line.parallelOrders);
    // The earliest order the line can actually crew. One that nobody is free
    // for is skipped rather than stalling the line behind it — the schedule
    // will have moved it out by the next round, and if it never becomes
    // staffable it is left for the supervisor, which is the honest answer.
    for (const next of waiting) {
      // Build the team one at a time. Each person added shortens the bar, so
      // the window the next has to be free across only ever narrows — nobody
      // vetted against the longer window becomes a clash later.
      const crew: string[] = [];
      for (let i = 0; i < size; i++) {
        const want = span(next, crew.length + 1);
        if (!want) break;
        const free = pool
          .filter(
            (w) =>
              !crew.includes(String(w.id)) &&
              !clashesWith(booked.get(String(w.id)), want),
          )
          // Spread the work: whoever is carrying least goes first.
          .sort(
            (a, b) =>
              (booked.get(String(a.id))?.length ?? 0) -
              (booked.get(String(b.id))?.length ?? 0),
          );
        if (free.length === 0) break;
        crew.push(String(free[0].id));
      }
      if (crew.length === 0) continue;

      into[String(next.job.id)] = crew;
      staffed++;

      // Book them for this wave too: the lines are staffed one after another,
      // and somebody free on UPL is not still free once ASSY has taken them.
      const taken = span(next, crew.length);
      if (taken) {
        for (const id of crew) {
          const held = booked.get(id);
          if (held) held.push(taken);
          else booked.set(id, [taken]);
        }
      }
      break; // one per line per round; the scheduler settles before the next
    }
  }
  return staffed;
}

/**
 * Crew the waiting orders, letting the schedule settle between each round.
 *
 * `recompute` re-derives the board with the allocations so far. Without it
 * only the first round runs — enough for a preview, not for the real thing:
 * every span after the first is one the scheduler worked out, not one this
 * guessed, which is what keeps the suggestion clash-free.
 */
export function suggestCrew(
  board: AssemblyGanttView,
  recompute?: (allocations: Record<string, string[]>) => AssemblyGanttView,
): CrewSuggestion {
  const allocations: Record<string, string[]> = {};
  let view = board;

  for (let wave = 0; wave < MAX_WAVES; wave++) {
    if (staffOneWave(view, allocations) === 0) break;
    if (!recompute) break;
    view = recompute(allocations);
  }

  // A predecessor staffed in a later wave can move an already-suggested
  // successor. Validate against the settled board, removing the most recent
  // suggestion in any pair until no person occupies two orders on one day.
  if (recompute) {
    view = recompute(allocations);
    for (let guard = 0; guard < MAX_WAVES * 3; guard++) {
      const jobIds = Object.keys(allocations).reverse();
      const bad = jobIds.find((jobId) => {
        const row = view.rowsByJob.get(jobId);
        return row?.workers.some(
          (worker) =>
            clashesFor(
              [...view.rowsByJob.values()],
              row,
              String(worker.id),
            ).length > 0,
        );
      });
      if (!bad) break;
      delete allocations[bad];
      view = recompute(allocations);
    }
  }

  const staffed = Object.keys(allocations).length;
  return {
    allocations,
    staffed,
    unstaffed: countUnstaffed(board) - staffed,
  };
}
