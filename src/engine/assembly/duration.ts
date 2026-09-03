/**
 * How long an assembly order takes, given how many people are on it.
 *
 * Work is measured in standard hours. Adding a person divides the remaining
 * work, which is what lets the supervisor shorten a bar by allocating more
 * of the crew — capped at four people per order.
 */

import {
  MAX_WORKERS_PER_ORDER,
  PRODUCTIVE_HOURS_PER_PERSON,
} from '@/domain/assembly';
import type { Job } from '@/domain/types';
import { startOfDay, subWorkingDays } from './dates';

/** Fraction of the order already finished, clamped to [0, 1]. */
export function completedFraction(job: Job): number {
  const total = job.remainingQty + job.completedQty;
  if (total <= 0) return job.completedQty > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, job.completedQty / total));
}

/** Standard hours still to be worked on the order. */
export function remainingHours(job: Job): number {
  return Math.max(0, job.laborHrs) * (1 - completedFraction(job));
}

/**
 * Standard hours one finished unit is worth.
 *
 * The order's whole quantity carries its whole labour content, so this turns a
 * shift's output count back into hours — which is how the board can put what
 * was actually made yesterday on the same scale as what is planned for today.
 */
export function hoursPerUnit(job: Job): number {
  const total = job.remainingQty + job.completedQty;
  return total > 0 ? Math.max(0, job.laborHrs) / total : 0;
}

/** Units still to make. */
export function remainingQty(job: Job): number {
  return Math.max(0, job.remainingQty);
}

/** People-hours the crew delivers in one day. */
export const crewHoursPerDay = (workerCount: number): number =>
  Math.max(0, Math.min(workerCount, MAX_WORKERS_PER_ORDER)) *
  PRODUCTIVE_HOURS_PER_PERSON;

/**
 * Calendar days the order needs with this crew.
 * `null` when nobody is allocated — the order cannot be scheduled at all.
 */
export function durationDays(job: Job, workerCount: number): number | null {
  const perDay = crewHoursPerDay(workerCount);
  if (perDay <= 0) return null;
  const hours = remainingHours(job);
  if (hours <= 0) return 0;
  return hours / perDay;
}

/**
 * Units the crew is expected to finish in one day — the target the supervisor
 * measures the end-of-shift count against.
 */
export function dailyTargetQty(job: Job, workerCount: number): number {
  const days = durationDays(job, workerCount);
  if (days === null || days <= 0) return 0;
  return remainingQty(job) / days;
}

/** Smallest crew that finishes the order within `days`, capped at the max. */
export function crewNeededFor(job: Job, days: number): number | null {
  if (days <= 0) return null;
  const hours = remainingHours(job);
  if (hours <= 0) return 0;
  const needed = Math.ceil(hours / (days * PRODUCTIVE_HOURS_PER_PERSON));
  return needed > MAX_WORKERS_PER_ORDER ? null : needed;
}

/**
 * The last day work can begin and still be finished by `due`.
 *
 * This is where Epicor's own `JobHead_StartDate` comes from: the due date less
 * the work, counted back over open days only. The work is
 * `Calculated_RemainingLaborHrs`, and a day is worth
 * `PRODUCTIVE_HOURS_PER_PERSON` — 7.5, being 07:00 to 15:30 less morning tea
 * and lunch — per person on the order.
 *
 * So it is also a check: derive it here, compare it with the date the export
 * carries, and a gap means the crew size or the hours differ from whatever
 * Epicor assumed. `null` when nobody is on the order, because then there is no
 * rate to count back at.
 */
export function latestStart(
  job: Job,
  workerCount: number,
  due: Date,
): Date | null {
  const days = durationDays(job, workerCount);
  if (days === null) return null;
  return startOfDay(subWorkingDays(due, days));
}
