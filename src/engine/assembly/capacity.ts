/**
 * Area capacity: people-hours available vs standard hours planned.
 *
 * This is the assembly analogue of machine hours on the moulding Gantt. The
 * constraint here is people, so available hours come from how many of the
 * crew the supervisor put in the area, and load is the sum of the standard
 * hours of the orders queued there.
 */

import {
  OVERLOAD_PCT,
  PRODUCTIVE_HOURS_PER_PERSON,
  UNDERLOAD_PCT,
} from '@/domain/assembly';
import type { Job } from '@/domain/types';

export type LoadLevel = 'under' | 'ok' | 'over' | 'idle';

export interface AreaLoad {
  headcount: number;
  /** Productive people-hours the area has today. */
  availableHours: number;
  /** Standard hours of the orders queued in the area. */
  plannedHours: number;
  /** plannedHours / availableHours, as a percentage (0 when no crew). */
  loadPct: number;
  level: LoadLevel;
  /** Days of work queued at the current crew size. */
  daysOfWork: number;
}

export const availableHours = (headcount: number): number =>
  Math.max(0, headcount) * PRODUCTIVE_HOURS_PER_PERSON;

export function loadLevel(plannedHours: number, available: number): LoadLevel {
  if (plannedHours <= 0) return 'idle';
  if (available <= 0) return 'over'; // work queued with nobody on it
  const pct = (plannedHours / available) * 100;
  if (pct > OVERLOAD_PCT) return 'over';
  if (pct < UNDERLOAD_PCT) return 'under';
  return 'ok';
}

export function areaLoad(jobs: Job[], headcount: number): AreaLoad {
  const plannedHours = jobs.reduce((sum, j) => sum + Math.max(0, j.laborHrs), 0);
  const available = availableHours(headcount);
  return {
    headcount,
    availableHours: available,
    plannedHours,
    loadPct: available > 0 ? (plannedHours / available) * 100 : 0,
    level: loadLevel(plannedHours, available),
    daysOfWork: available > 0 ? plannedHours / available : 0,
  };
}
