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
import { MS_PER_DAY } from '@/lib/time';
import { remainingHours } from './duration';
import { addDays, isWeekend, startOfDay } from './dates';
import type { OrderRow } from './board';

export { isWeekend };

/** Days a person's popup covers — "one week". */
export const LOAD_WINDOW_DAYS = 7;

/**
 * Squares drawn beside a name in the board header.
 *
 * Five, because a calendar week holds exactly five working days and the
 * factory is shut for the other two — so the squares and the popup are two
 * views of the same window rather than two different weeks.
 */
export const LOAD_PREVIEW_DAYS = 5;

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
  /**
   * Hours they can actually work: a full shift on an open day, none while on
   * leave and none at the weekend. Anything booked against a zero reads as
   * over — which is right, because that is what overtime is.
   */
  capacity: number;
  /** Booked past what they can work — they are on two orders at once. */
  over: boolean;
  /** Off the roster for the day, so `capacity` is zero by design. */
  onLeave: boolean;
  /** A day the factory runs. Saturday and Sunday are closed. */
  working: boolean;
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

/** How hard a day is booked, against Resero's thresholds. */
export type LoadBand = 'green' | 'orange' | 'red';

/**
 * Colour band for a day's load: comfortable below 80%, tight to 90%,
 * over-committed beyond. Exhaustive and non-overlapping.
 */
export function loadBand(pct: number): LoadBand {
  if (pct < 80) return 'green';
  if (pct <= 90) return 'orange';
  return 'red';
}

/** One day column's load across the whole board. */
export interface DayBoardLoad {
  key: string;
  date: Date;
  /** The first column — the day the board is being planned on. */
  isToday: boolean;
  /**
   * A day the factory runs. Weekends are closed, so bars step over them and a
   * closed column reads 0% — unless an order has been approved for overtime,
   * which is exactly the case the supervisor needs to see standing out.
   */
  working: boolean;
  /** Standard hours of work landing on the day, summed over every order. */
  hours: number;
  /** Hours the people available that day can deliver. */
  capacity: number;
  /** hours ÷ capacity, as a percentage. Zero when nobody is in. */
  pct: number;
  band: LoadBand;
  /** People available, after attendance today and planned leave later. */
  available: number;
}

/**
 * The load histogram along the top of the board.
 *
 * Same hours as the per-person and per-line views, so the three agree: the
 * remaining standard hours of each order, spread over the days its bar covers.
 * Attendance is only known for today — the supervisor confirms it each morning
 * — so later days assume everyone is in bar those on planned leave.
 */
export function boardDayLoads(
  rows: OrderRow[],
  workers: Worker[],
  from: Date,
  dayCount: number,
): DayBoardLoad[] {
  const start = startOfDay(from);
  const todayKey = dayKey(start);
  const scheduled = rows.filter((r) => r.line.schedulable);
  const out: DayBoardLoad[] = [];

  for (let i = 0; i < dayCount; i++) {
    const date = addDays(start, i);
    const key = dayKey(date);
    const available = workers.filter(
      (w) => (key !== todayKey || w.onShift) && !w.plannedLeave?.includes(key),
    ).length;
    const capacity = available * PRODUCTIVE_HOURS_PER_PERSON;
    // `hoursOnDay` is per person, so multiply back up by the crew on the order.
    const hours = scheduled.reduce(
      (s, r) => s + hoursOnDay(r, date) * r.workers.length,
      0,
    );
    const pct = capacity > 0 ? (hours / capacity) * 100 : 0;

    out.push({
      key,
      date,
      isToday: key === todayKey,
      working: !isWeekend(date),
      hours,
      capacity,
      pct,
      band: loadBand(pct),
      available,
    });
  }
  return out;
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
 * The bar is treated as an even spread of work over the days it is actually
 * worked, so a bar half inside a day contributes half its daily rate. That
 * keeps a short order (0.4 days) inside the one day it runs, instead of
 * charging a whole shift to it.
 *
 * A closed day carries nothing: the bar merely spans it. `row.days` counts the
 * days worked, which is precisely the sum of the open overlaps below, so an
 * order's daily shares always add back up to its remaining hours.
 */
function hoursOnDay(row: OrderRow, from: Date): number {
  if (!row.start || !row.expectDate || row.days === null || row.days <= 0) {
    return 0;
  }
  const crew = row.workers.length;
  if (crew === 0) return 0;
  if (isWeekend(from) && !row.overtime) return 0;

  const to = addDays(from, 1);
  const overlapMs =
    Math.min(row.expectDate.getTime(), to.getTime()) -
    Math.max(row.start.getTime(), from.getTime());
  if (overlapMs <= 0) return 0;

  const share = remainingHours(row.job) / crew;
  return share * (overlapMs / MS_PER_DAY / row.days);
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
    const working = !isWeekend(date);
    const capacity = onLeave || !working ? 0 : PRODUCTIVE_HOURS_PER_PERSON;
    days.push({
      key,
      date,
      hours,
      capacity,
      over: hours > capacity + OVER_TOLERANCE_HOURS,
      onLeave,
      working,
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

/**
 * Every person's week in one pass, keyed by worker id.
 *
 * The header draws a load square per person per working day, so the board needs
 * all of them on every render; computing them together keeps that to a single
 * walk of the rows instead of one per name.
 */
export function rosterLoad(
  workers: Worker[],
  rows: OrderRow[],
  from: Date,
  dayCount: number = LOAD_WINDOW_DAYS,
): Map<string, WorkerLoad> {
  return new Map(
    workers.map((w) => [String(w.id), workerLoad(w, rows, from, dayCount)]),
  );
}

/** How a single day reads, as a square or as a meter. */
export type LoadDot = 'leave' | 'idle' | LoadBand;

/**
 * The colour for one day, used by both views of a person's week so they can
 * never tell different stories. Work booked against no capacity — planned
 * leave, or a weekend — is fully over: there is no shift to absorb it.
 */
export function dayBand(day: DayLoad): LoadDot {
  if (day.hours <= 0) return day.onLeave ? 'leave' : 'idle';
  if (day.capacity <= 0) return 'red';
  return loadBand((day.hours / day.capacity) * 100);
}

/** One square: a working day boiled down to a colour. */
export interface LoadPreviewDay {
  key: string;
  date: Date;
  hours: number;
  capacity: number;
  /** booked ÷ available, as a percentage. Zero when they cannot work. */
  pct: number;
  onLeave: boolean;
  dot: LoadDot;
}

/**
 * The squares for one person: the working days of their window, in order.
 *
 * Closed days are left out rather than drawn grey — the supervisor is reading
 * these to find room for an order, and the factory offers none at the weekend.
 * Work booked on a day with no capacity (leave, or an approved weekend) counts
 * as fully over: there is no shift to absorb it.
 */
export function loadPreview(
  load: WorkerLoad,
  count: number = LOAD_PREVIEW_DAYS,
): LoadPreviewDay[] {
  return load.days
    .filter((d) => d.working)
    .slice(0, count)
    .map((d) => ({
      key: d.key,
      date: d.date,
      hours: d.hours,
      capacity: d.capacity,
      pct: d.capacity > 0 ? (d.hours / d.capacity) * 100 : 0,
      onLeave: d.onLeave,
      dot: dayBand(d),
    }));
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
