/**
 * Work load — how much standard work is booked against a person or a line.
 *
 * The unit throughout is the remaining standard hours of an order, which comes
 * from `Calculated_RemainingLaborHrs` in `Planning1.csv`. An order's hours are
 * shared equally by its crew and spread over the calendar days its bar covers,
 * so a person's day shows what they are actually expected to work, not merely
 * how many orders carry their name.
 *
 * Pure. No React, no store.
 */

import { PRODUCTIVE_HOURS_PER_PERSON, type Worker } from '@/domain/assembly';
import type { JobId } from '@/domain/ids';
import { remainingHours } from './duration';
import { addDays, startOfDay } from './dates';
import type { OrderRow } from './board';

/** Days a person's popup covers — "one week". */
export const LOAD_WINDOW_DAYS = 7;

/**
 * Slack before a day counts as over-booked, in hours. A bar sized to fit its
 * crew exactly lands on 7.25 h through a chain of divisions, so a bare `>`
 * would flag half the board as overtime on floating-point dust. 36 seconds is
 * below anything the shop floor would call over.
 */
const OVER_TOLERANCE_HOURS = 0.01;

/** One order's contribution to one person's day. */
export interface LoadEntry {
  jobId: JobId;
  description: string;
  /** Line the order sits on, for the lane colour. */
  line: string;
  hours: number;
}

export interface DayLoad {
  /** Local `YYYY-MM-DD`, the key used for planned leave. */
  key: string;
  date: Date;
  /** Standard hours booked on this person for the day. */
  hours: number;
  /** Hours they can actually work: a full shift, or none while on leave. */
  capacity: number;
  /** Booked past what they can work — they are on two orders at once. */
  over: boolean;
  /** Off the roster for the day, so `capacity` is zero by design. */
  onLeave: boolean;
  entries: LoadEntry[];
}

export interface WorkerLoad {
  worker: Worker;
  days: DayLoad[];
  /** Booked hours across the window. */
  totalHours: number;
  /** Hours available across the window, after leave. */
  capacityHours: number;
  /** booked ÷ available; above 1 the person is double-booked. */
  utilisation: number;
  /** Distinct orders they appear on in the window. */
  orderCount: number;
  /** Days in the window booked past a full shift. */
  overloadedDays: number;
}

/** Work still to run on a line, and what the crew on it can absorb. */
export interface LineLoad {
  /** Standard hours still to run across the line's orders. */
  hours: number;
  /** Distinct people allocated anywhere on the line. */
  crew: number;
  /** Hours that crew delivers in a day. */
  capacityPerDay: number;
  /** Calendar days to clear the queue; null when nobody is allocated. */
  daysOfWork: number | null;
  /** Orders sitting on the line with nobody on them. */
  needsCrew: number;
}

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/**
 * Hours of `row` that fall on the day starting at `from`, per person.
 *
 * The bar is treated as an even spread of work between its start and its
 * Expect Date, so a bar half inside a day contributes half its daily rate.
 * That keeps a short order (0.4 days) inside the one day it runs, instead of
 * charging a whole shift to it.
 */
function hoursOnDay(row: OrderRow, from: Date): number {
  if (!row.start || !row.expectDate || row.days === null || row.days <= 0) {
    return 0;
  }
  const crew = row.workers.length;
  if (crew === 0) return 0;

  const to = addDays(from, 1);
  const overlapMs =
    Math.min(row.expectDate.getTime(), to.getTime()) -
    Math.max(row.start.getTime(), from.getTime());
  if (overlapMs <= 0) return 0;

  const share = remainingHours(row.job) / crew;
  const spanMs = row.expectDate.getTime() - row.start.getTime();
  if (spanMs <= 0) return share;
  return share * (overlapMs / spanMs);
}

/**
 * One person's load over `dayCount` days from `from`.
 *
 * `rows` should be every scheduled row on the board — an order counts against
 * the person wherever it sits, not only on the line they are looking at.
 */
export function workerLoad(
  worker: Worker,
  rows: OrderRow[],
  from: Date,
  dayCount: number = LOAD_WINDOW_DAYS,
): WorkerLoad {
  const start = startOfDay(from);
  const id = String(worker.id);
  const leave = new Set(worker.plannedLeave ?? []);
  const mine = rows.filter(
    (r) => !r.completedToday && r.workers.some((w) => String(w.id) === id),
  );

  const days: DayLoad[] = [];
  const jobs = new Set<string>();

  for (let i = 0; i < dayCount; i++) {
    const date = addDays(start, i);
    const key = dayKey(date);
    const onLeave = leave.has(key);
    const entries: LoadEntry[] = [];

    for (const row of mine) {
      const hours = hoursOnDay(row, date);
      if (hours <= 0) continue;
      jobs.add(String(row.job.id));
      entries.push({
        jobId: row.job.id,
        description: row.job.description || String(row.job.id),
        line: row.line.name,
        hours,
      });
    }

    entries.sort((a, b) => b.hours - a.hours);
    const hours = entries.reduce((s, e) => s + e.hours, 0);
    const capacity = onLeave ? 0 : PRODUCTIVE_HOURS_PER_PERSON;
    days.push({
      key,
      date,
      hours,
      capacity,
      over: hours > capacity + OVER_TOLERANCE_HOURS,
      onLeave,
      entries,
    });
  }

  const totalHours = days.reduce((s, d) => s + d.hours, 0);
  const capacityHours = days.reduce((s, d) => s + d.capacity, 0);

  return {
    worker,
    days,
    totalHours,
    capacityHours,
    utilisation: capacityHours > 0 ? totalHours / capacityHours : 0,
    orderCount: jobs.size,
    overloadedDays: days.filter((d) => d.over).length,
  };
}

/** Work still queued on a line, and how long its crew needs to clear it. */
export function lineLoad(rows: OrderRow[]): LineLoad {
  const hours = rows.reduce((s, r) => s + remainingHours(r.job), 0);
  const crew = new Set(rows.flatMap((r) => r.workers.map((w) => String(w.id))))
    .size;
  const capacityPerDay = crew * PRODUCTIVE_HOURS_PER_PERSON;

  return {
    hours,
    crew,
    capacityPerDay,
    daysOfWork: capacityPerDay > 0 ? hours / capacityPerDay : null,
    needsCrew: rows.filter((r) => r.line.schedulable && r.workers.length === 0)
      .length,
  };
}
