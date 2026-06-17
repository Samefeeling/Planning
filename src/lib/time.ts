/**
 * Labor-hours ↔ wall-clock conversion against a shift calendar, plus small
 * date helpers used by the Gantt timeline.
 *
 * The shop floor is modelled as running `shift.hoursPerDay` productive hours
 * per calendar day. With a 3-shift pattern (24 h/day) wall-clock time equals
 * labor time; with 1/2-shift patterns we stretch the wall-clock window so a
 * bar of N labor hours still represents N hours of work but spans the idle
 * gaps between shifts.
 */

import type { ShiftPattern } from '@/domain/types';
import { DEFAULT_SHIFT } from '@/domain/constants';

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const hoursToMs = (h: number): number => Math.round(h * MS_PER_HOUR);
export const msToHours = (ms: number): number => ms / MS_PER_HOUR;

/**
 * Advance `start` by `laborHours` of productive time under a shift pattern.
 *
 * With 24 h/day this is a plain addition. With fewer running hours per day we
 * map each productive hour onto `24 / hoursPerDay` wall-clock hours so the
 * bar visually occupies the longer real-time window.
 */
export function addLaborHours(
  start: Date,
  laborHours: number,
  shift: ShiftPattern = DEFAULT_SHIFT,
): Date {
  const stretch = 24 / Math.max(1, shift.hoursPerDay);
  return new Date(start.getTime() + hoursToMs(laborHours * stretch));
}

/** Wall-clock hours spanned by `laborHours` of work under a shift pattern. */
export function wallClockHours(
  laborHours: number,
  shift: ShiftPattern = DEFAULT_SHIFT,
): number {
  const stretch = 24 / Math.max(1, shift.hoursPerDay);
  return laborHours * stretch;
}

export const addHours = (d: Date, h: number): Date =>
  new Date(d.getTime() + hoursToMs(h));

export const addMinutes = (d: Date, m: number): Date =>
  new Date(d.getTime() + m * 60_000);

export const diffHours = (a: Date, b: Date): number =>
  msToHours(a.getTime() - b.getTime());

export const maxDate = (a: Date, b: Date): Date => (a > b ? a : b);
export const minDate = (a: Date, b: Date): Date => (a < b ? a : b);

/** Round down to the start of the hour — a tidy timeline origin. */
export function floorToHour(d: Date): Date {
  const r = new Date(d);
  r.setMinutes(0, 0, 0);
  return r;
}

/** Round down to local midnight. */
export function floorToDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDay = (d: Date): string => DAY_FMT.format(d);
export const formatTime = (d: Date): string => TIME_FMT.format(d);
export const formatDateTime = (d: Date): string =>
  `${DAY_FMT.format(d)} ${TIME_FMT.format(d)}`;

/** "3.4 h" or "45 min" depending on magnitude. */
export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toFixed(1)} h`;
}
