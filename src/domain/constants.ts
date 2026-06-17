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
 * Top-to-bottom ordering of lines on the board, arranged so adjacent lanes are
 * physically close on the floor (eases moving a job to a nearby machine). This
 * list also defines which lines are *visible*: machines not listed here are
 * hidden, and any jobs sitting on them fall back to the unscheduled pool.
 */
export const MACHINE_ORDER: string[] = [
  '1600T',
  '1300T',
  'BATT1',
  'BATT2',
  '850T',
  '550T',
  '320T',
  '150T',
  '125T',
  'HS',
];

const VISIBLE_MACHINES = new Set(MACHINE_ORDER);

/** Whether a machine id should appear on the board. */
export const isVisibleMachine = (id: string): boolean =>
  VISIBLE_MACHINES.has(id);

/** Step (hours) when nudging a line's breakdown/delay offset. */
export const LANE_DELAY_STEP_HOURS = 2;

/** Gantt zoom: horizontal pixels per productive hour. */
export const DEFAULT_PX_PER_HOUR = 14;

/** A job whose due date is within this many days is flagged "at risk". */
export const DUE_DATE_RISK_DAYS = 2;
