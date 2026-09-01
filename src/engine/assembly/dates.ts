/**
 * Schedule colour: how the expected completion date compares with the two
 * commitments on the order.
 *
 * Ship Date is the agreed date the order leaves the factory; Due Date is the
 * later customer date. So the bands, worst last:
 *
 *   green   Expect ≤ Ship          makes the booked shipment
 *   orange  Ship < Expect < Due    misses the shipment, customer date still reachable
 *   red     Expect ≥ Due           the customer date will be missed
 */

import { MS_PER_DAY } from '@/lib/time';

export type ScheduleColor = 'green' | 'orange' | 'red' | 'grey';

export interface ScheduleStatus {
  color: ScheduleColor;
  /** Days early (negative) or late (positive) against the ship date. */
  shipSlackDays: number | null;
  /** Days early (negative) or late (positive) against the due date. */
  dueSlackDays: number | null;
  reason: string;
}

const dayDiff = (a: Date, b: Date): number =>
  (a.getTime() - b.getTime()) / MS_PER_DAY;

export function scheduleStatus(
  expect: Date | null,
  ship: Date | null,
  due: Date | null,
): ScheduleStatus {
  if (!expect || (!ship && !due)) {
    return {
      color: 'grey',
      shipSlackDays: null,
      dueSlackDays: null,
      reason: expect ? 'No ship or due date on file' : 'Not schedulable',
    };
  }

  const shipSlackDays = ship ? dayDiff(expect, ship) : null;
  const dueSlackDays = due ? dayDiff(expect, due) : null;

  // Worst band first so a missing ship date still classifies correctly.
  if (due && expect >= due) {
    return {
      color: 'red',
      shipSlackDays,
      dueSlackDays,
      reason: 'Will miss the customer due date',
    };
  }
  if (ship && expect > ship) {
    return {
      color: 'orange',
      shipSlackDays,
      dueSlackDays,
      reason: 'Will miss the booked ship date',
    };
  }
  return {
    color: 'green',
    shipSlackDays,
    dueSlackDays,
    reason: 'On track for the ship date',
  };
}

/** Add whole and fractional days to a date. */
export const addDays = (d: Date, days: number): Date =>
  new Date(d.getTime() + days * MS_PER_DAY);

/** Midnight at the start of the given day. */
export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Whole days between two dates, ignoring time of day. */
export const wholeDaysBetween = (a: Date, b: Date): number =>
  Math.round(dayDiff(startOfDay(a), startOfDay(b)));

// ---------------------------------------------------------------------------
// The shift calendar
//
// Resero runs one white shift, Monday to Friday. Saturday and Sunday are shut,
// so an order does not progress across them: three days of work started on a
// Thursday finishes on the Monday, not on the Saturday. A weekend is only
// worked when the supervisor has approved overtime on that particular order,
// which the board asks for the moment a bar is dropped on one.
// ---------------------------------------------------------------------------

/** Saturday or Sunday — the factory is closed. */
export const isWeekend = (d: Date): boolean =>
  d.getDay() === 0 || d.getDay() === 6;

/** Midnight of the next day, robust across daylight-saving shifts. */
const nextMidnight = (d: Date): Date => startOfDay(addDays(startOfDay(d), 1));

/**
 * `d` itself when the factory runs that day, otherwise the following Monday.
 * A weekend start is pulled to the start of Monday: nothing was worked on the
 * Saturday, so there is no part-day to carry over.
 */
export function nextWorkingDay(d: Date): Date {
  if (!isWeekend(d)) return d;
  let out = startOfDay(d);
  do {
    out = nextMidnight(out);
  } while (isWeekend(out));
  return out;
}

/**
 * The last day the factory ran before `d` — Friday, when `d` is a Monday.
 *
 * The board opens on this day rather than on today, because the supervisor's
 * first question in the morning is what yesterday's shift actually finished,
 * and on a Monday that shift was Friday's.
 */
export function prevWorkingDay(d: Date): Date {
  let out = startOfDay(d);
  do {
    out = startOfDay(addDays(out, -1));
  } while (isWeekend(out));
  return out;
}

/**
 * Where `now` falls in the working day, as a fraction of the shift.
 *
 * Zero before the crew clocks on, one after they leave; the board draws its
 * "now" line at that fraction across today's column. Outside the shift the
 * line pins to the edge of the column rather than wandering into the night,
 * which would read as progress nobody is making.
 */
export function shiftFraction(
  now: Date,
  startHour: number,
  endHour: number,
): number {
  const hours = now.getHours() + now.getMinutes() / 60;
  if (hours <= startHour) return 0;
  if (hours >= endHour) return 1;
  return (hours - startHour) / (endHour - startHour);
}

/** Stops the walk below on a duration that could never be real. */
const MAX_SPAN_DAYS = 2000;

/** A stretch of open days, and how much of the order's work falls in it. */
export interface WorkingSpan {
  from: Date;
  to: Date;
  /** Days of work already done when this stretch begins. */
  workedBefore: number;
  /** Days of work this stretch carries. */
  worked: number;
}

/**
 * Break `from`–`to` into the stretches the factory is actually open.
 *
 * A bar is dated in calendar time but measured in worked days, and the two
 * disagree across a weekend: three days of work from a Thursday ends on the
 * Tuesday. Drawing one block of three columns would stop short of the order's
 * own Expect Date; drawing five would claim the crew worked the weekend. So
 * the bar is drawn as one block per stretch, with the closed days showing
 * through between them — which is what actually happens.
 *
 * An order approved for overtime runs straight through, so its whole span is
 * one stretch.
 */
export function workingSpans(
  from: Date,
  to: Date,
  overtime = false,
): WorkingSpan[] {
  if (to <= from) return [];
  if (overtime) {
    const worked = (to.getTime() - from.getTime()) / MS_PER_DAY;
    return [{ from: new Date(from), to: new Date(to), workedBefore: 0, worked }];
  }

  const out: WorkingSpan[] = [];
  let cursor = new Date(from);
  let done = 0;
  let open: Date | null = null;

  for (let guard = 0; guard < MAX_SPAN_DAYS && cursor < to; guard++) {
    const tomorrow = nextMidnight(cursor);
    const end = tomorrow < to ? tomorrow : to;
    if (isWeekend(cursor)) {
      if (open) {
        const worked = (cursor.getTime() - open.getTime()) / MS_PER_DAY;
        out.push({ from: open, to: new Date(cursor), workedBefore: done, worked });
        done += worked;
        open = null;
      }
    } else if (!open) {
      open = new Date(cursor);
    }
    cursor = end;
  }
  if (open && cursor > open) {
    out.push({
      from: open,
      to: new Date(cursor),
      workedBefore: done,
      worked: (cursor.getTime() - open.getTime()) / MS_PER_DAY,
    });
  }
  return out;
}

/**
 * `from` plus `days` of work, stepping over the days the factory is closed.
 *
 * Fractional days are honoured against the part of the day still ahead, so
 * half a day's work starting at noon on Friday finishes on Monday morning
 * rather than on the Saturday.
 */
export function addWorkingDays(from: Date, days: number): Date {
  if (days <= 0) return new Date(from);
  let cursor = new Date(from);
  let left = days;

  for (let guard = 0; guard < MAX_SPAN_DAYS; guard++) {
    const tomorrow = nextMidnight(cursor);
    if (isWeekend(cursor)) {
      cursor = tomorrow;
      continue;
    }
    const openToday = (tomorrow.getTime() - cursor.getTime()) / MS_PER_DAY;
    if (left <= openToday) return addDays(cursor, left);
    left -= openToday;
    cursor = tomorrow;
  }
  return cursor;
}
