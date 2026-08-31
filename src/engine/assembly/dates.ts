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
