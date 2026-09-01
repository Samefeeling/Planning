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

import { MAX_WORKERS_PER_ORDER, type Worker } from '@/domain/assembly';
import { remainingQty } from './duration';
import type { AssemblyGanttView } from './board';

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

export function suggestCrew(board: AssemblyGanttView): CrewSuggestion {
  const allocations: Record<string, string[]> = {};
  let staffed = 0;
  let unstaffed = 0;

  for (const group of board.groups) {
    if (!group.line.schedulable) continue;

    // Same rule as the crew picker: in today, and qualified for this line.
    const pool: Worker[] = board.workers.filter(
      (w) => w.onShift && w.skills.includes(group.line.key),
    );

    // Orders nobody has crewed, and that still have something left to make.
    const waiting = group.rows.filter(
      (row) =>
        row.workers.length === 0 &&
        !row.completedToday &&
        remainingQty(row.job) > 0,
    );
    if (waiting.length === 0) continue;
    if (pool.length === 0) {
      unstaffed += waiting.length;
      continue;
    }

    const size = crewSize(pool.length, group.line.parallelOrders);
    let cursor = 0;
    for (const row of waiting) {
      const crew: string[] = [];
      for (let i = 0; i < size; i++) {
        crew.push(String(pool[cursor % pool.length].id));
        cursor++;
      }
      allocations[String(row.job.id)] = crew;
      staffed++;
    }
  }

  return { allocations, staffed, unstaffed };
}
