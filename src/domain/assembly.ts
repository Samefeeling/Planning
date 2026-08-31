/**
 * Assembly department domain: lines, work-order types and the shift roster.
 *
 * Deliberately small. ~15 people on one white shift, the supervisor dispatches
 * on the floor, and nobody reports by the hour — completed quantity is entered
 * once at the end of the shift. So there is no operation routing and no event
 * stream: an order belongs to a line, carries a type, and has up to four people
 * on it.
 */

import { WorkCenterId, type WorkerId } from './ids';

/** A physical assembly line — the swimlanes on the board. */
export type LineKey = 'PMD' | 'UPL' | 'ASSY' | 'TABLE';

/** The only three kinds of assembly work order. */
export type OrderType = 'cutting-sewing' | 'upholstery' | 'final-assembly';

/** Physical prep state of the material kit, set by the material handler. */
export type MaterialPrepStatus =
  | 'not-prepared'
  | 'preparing'
  | 'ready'
  | 'shortage';

export interface LineDef {
  key: LineKey;
  id: WorkCenterId;
  name: string;
  /**
   * PMD is shown for context only — it mirrors the moulding plan so the
   * supervisor can see what is feeding assembly. It is not scheduled here.
   */
  schedulable: boolean;
  /** Work-order types this line runs. */
  types: OrderType[];
  sortIndex: number;
}

export const LINE_PMD = WorkCenterId('PMD');
export const LINE_UPL = WorkCenterId('UPL');
export const LINE_ASSY = WorkCenterId('ASSY');
export const LINE_TABLE = WorkCenterId('TABLE');

export const LINES: LineDef[] = [
  {
    key: 'PMD',
    id: LINE_PMD,
    name: 'PMD',
    schedulable: false,
    types: [],
    sortIndex: 0,
  },
  {
    key: 'UPL',
    id: LINE_UPL,
    name: 'UPL',
    schedulable: true,
    types: ['cutting-sewing', 'upholstery'],
    sortIndex: 1,
  },
  {
    key: 'ASSY',
    id: LINE_ASSY,
    name: 'ASSY',
    schedulable: true,
    types: ['final-assembly'],
    sortIndex: 2,
  },
  {
    key: 'TABLE',
    id: LINE_TABLE,
    name: 'TABLE',
    schedulable: true,
    types: ['final-assembly'],
    sortIndex: 3,
  },
];

export const LINE_BY_ID = new Map(LINES.map((l) => [String(l.id), l]));

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  'cutting-sewing': 'Cutting / Sewing',
  upholstery: 'Upholstery',
  'final-assembly': 'Final Assembly',
};

/** Short label for the tight left-hand table. */
export const ORDER_TYPE_SHORT: Record<OrderType, string> = {
  'cutting-sewing': 'C/S',
  upholstery: 'UPH',
  'final-assembly': 'F/A',
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** One row of the `ASSY_Operator` SharePoint list. */
export interface Worker {
  id: WorkerId;
  name: string;
  /** Lines this person is qualified to work — drives who can be allocated. */
  skills: LineKey[];
  /** On shift today. Attendance is confirmed by the supervisor each morning. */
  onShift: boolean;
  /** Job title from the roster, e.g. "Upholsterer". */
  position?: string;
  /** Who they report to; shown so the supervisor picks from their own people. */
  supervisor?: string;
  /** ISO days the worker is unavailable; supplied by the future attendance API. */
  plannedLeave?: string[];
}

/** Nobody is allocated to more than this many orders' worth of work at once. */
export const MAX_WORKERS_PER_ORDER = 4;

// ---------------------------------------------------------------------------
// Shift / calendar
// ---------------------------------------------------------------------------

/** Single white shift. */
export const SHIFT_HOURS = 8;
/** Non-productive break time per person per day. */
export const BREAK_HOURS = 0.75;
/** Productive hours one person contributes in a day. */
export const PRODUCTIVE_HOURS_PER_PERSON = SHIFT_HOURS - BREAK_HOURS;

/**
 * The board counts calendar days, matching how the schedule is drawn today.
 * Flip this when the shift calendar should skip weekends.
 */
export const WORKING_DAYS_ONLY = false;

/** How many days the timeline shows by default. */
export const DEFAULT_HORIZON_DAYS = 14;
