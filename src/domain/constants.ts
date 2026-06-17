/**
 * Tunable business rules and shop-floor constants.
 *
 * These are derived from the master workbook (e.g. the planning sheet adds a
 * flat 0.5 h to `Prod Hours` for a die change to get `Duration`) and from
 * shop convention. Keep all "magic numbers" here so planners can adjust them
 * in one place.
 */

import type { ShiftPattern } from './types';

/** Minutes lost to a die / tool change when the next job needs a new mould. */
export const DIE_CHANGE_MINUTES = 30; // = 0.5 h, matches Duration − Prod Hours

/** Minutes lost to a colour change / purge when the next job is a new colour. */
export const COLOR_CHANGE_MINUTES = 20;

/** Minutes lost swapping a die insert / cavity set. */
export const INSERT_CHANGE_MINUTES = 15;

/**
 * When several changeover kinds happen together (e.g. die + colour), the
 * machine is down once — we take the largest contributor rather than the sum,
 * plus a small overlap factor for the lesser ones.
 */
export const CHANGEOVER_OVERLAP_FACTOR = 0.5;

/** Shift patterns referenced by the workbook's `no of shift` column. */
export const SHIFT_PATTERNS: Record<string, ShiftPattern> = {
  '1shift': { id: '1shift', hoursPerDay: 8 },
  '2shift': { id: '2shift', hoursPerDay: 16 },
  '3shift': { id: '3shift', hoursPerDay: 24 },
};

/** Default pattern when a job/line does not specify one. */
export const DEFAULT_SHIFT: ShiftPattern = SHIFT_PATTERNS['3shift'];

/**
 * Preferred top-to-bottom ordering of lines on the board. Anything not listed
 * is appended alphabetically. Matches the physical layout of the PMD floor.
 */
export const MACHINE_ORDER: string[] = [
  '125T',
  '150T',
  '320T',
  '550T',
  '650T',
  '850T',
  '1300T',
  '1600T',
  'BATT1',
  'BATT2',
  'HS',
  'PLASSY',
];

/** Gantt zoom: horizontal pixels per productive hour. */
export const DEFAULT_PX_PER_HOUR = 14;

/** A job whose due date is within this many days is flagged "at risk". */
export const DUE_DATE_RISK_DAYS = 2;
