/**
 * Assembly department domain: areas, product routes and stages.
 *
 * Deliberately small. The department runs one white shift with ~15 people and
 * the supervisor dispatches on the floor, so there is no multi-level operation
 * routing — just three fixed routes (A/B/C) over a handful of stages, and four
 * physical areas. Everything here is data; behaviour lives in engine/assembly.
 */

import { AreaId } from './ids';

/** A = tables / general assembly, B = sofa, C = chair upholstery. */
export type ProductType = 'A' | 'B' | 'C';

export type StageId =
  | 'cutting-sewing'
  | 'frame-foam'
  | 'upholstery-final'
  | 'chair-upholstery'
  | 'general-assembly'
  | 'final-assembly';

/** Physical prep state of the paper order's material kit, set by the handler. */
export type MaterialPrepStatus =
  | 'not-prepared'
  | 'preparing'
  | 'ready'
  | 'shortage';

export interface AreaDef {
  id: AreaId;
  name: string;
  /** Short label for tight UI. */
  short: string;
  /** Typical crew size the supervisor allocates (guidance, not enforced). */
  suggested: { min: number; max: number };
  sortIndex: number;
}

export interface StageDef {
  id: StageId;
  name: string;
  /** Where this stage normally runs. */
  defaultArea: AreaId;
  /**
   * Final assembly can be done by area A or stay in C — the supervisor decides
   * on the day, so the board allows the column to be overridden.
   */
  areaOverridable?: boolean;
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export const AREA_A = AreaId('AREA-A');
export const AREA_SHARED = AreaId('AREA-SHARED');
export const AREA_B = AreaId('AREA-B');
export const AREA_C = AreaId('AREA-C');

export const AREAS: AreaDef[] = [
  {
    id: AREA_A,
    name: 'A – General Assembly',
    short: 'A · General',
    suggested: { min: 6, max: 8 },
    sortIndex: 0,
  },
  {
    id: AREA_SHARED,
    name: 'Shared Cutting / Sewing',
    short: 'Cutting / Sewing',
    suggested: { min: 3, max: 5 },
    sortIndex: 1,
  },
  {
    id: AREA_B,
    name: 'B – Sofa',
    short: 'B · Sofa',
    suggested: { min: 3, max: 3 },
    sortIndex: 2,
  },
  {
    id: AREA_C,
    name: 'C – Chair Upholstery',
    short: 'C · Chair Uph.',
    suggested: { min: 3, max: 5 },
    sortIndex: 3,
  },
];

export const AREA_BY_ID = new Map(AREAS.map((a) => [String(a.id), a]));

// ---------------------------------------------------------------------------
// Stages and routes
// ---------------------------------------------------------------------------

export const STAGES: Record<StageId, StageDef> = {
  'cutting-sewing': {
    id: 'cutting-sewing',
    name: 'Cutting / Sewing',
    defaultArea: AREA_SHARED,
  },
  'frame-foam': {
    id: 'frame-foam',
    name: 'Frame & Foam',
    defaultArea: AREA_B,
  },
  'upholstery-final': {
    id: 'upholstery-final',
    name: 'Upholstery / Final',
    defaultArea: AREA_B,
  },
  'chair-upholstery': {
    id: 'chair-upholstery',
    name: 'Chair Upholstery',
    defaultArea: AREA_C,
  },
  'general-assembly': {
    id: 'general-assembly',
    name: 'General Assembly',
    defaultArea: AREA_A,
  },
  'final-assembly': {
    id: 'final-assembly',
    name: 'Final Assembly',
    defaultArea: AREA_A,
    areaOverridable: true, // A or C, supervisor's call on the day
  },
};

/** The three routes. Exceptions get configured per part later, not derived. */
export const ROUTES: Record<ProductType, StageId[]> = {
  A: ['general-assembly'],
  B: ['cutting-sewing', 'frame-foam', 'upholstery-final'],
  C: ['cutting-sewing', 'chair-upholstery', 'final-assembly'],
};

// ---------------------------------------------------------------------------
// Shift / labour constants
// ---------------------------------------------------------------------------

/** Single white shift. */
export const SHIFT_HOURS = 8;
/** Unpaid/!productive break time per person per day. */
export const BREAK_HOURS = 0.75;
/** Productive hours one person contributes in a day. */
export const PRODUCTIVE_HOURS_PER_PERSON = SHIFT_HOURS - BREAK_HOURS;

/** Load above this reads as over-committed on the board. */
export const OVERLOAD_PCT = 100;
/** Load below this reads as under-committed. */
export const UNDERLOAD_PCT = 60;
