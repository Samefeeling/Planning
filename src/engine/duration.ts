/**
 * Calculated_LaborHrs → Gantt bar geometry.
 *
 * A bar's productive length is the job's labour hours; its full footprint on
 * the board also includes any changeover setup that precedes it.
 */

import type { Job } from '@/domain/types';
import { DEFAULT_PX_PER_HOUR } from '@/domain/constants';

/** Productive run time of a job, in hours (never negative). */
export const laborHours = (job: Job): number => Math.max(0, job.laborHrs);

/** Convert changeover minutes to hours. */
export const changeoverHours = (minutes: number): number => minutes / 60;

/** Total hours a job occupies on a line: setup + run. */
export function ganttDurationHours(
  job: Job,
  changeoverMinutes: number,
): number {
  return changeoverHours(changeoverMinutes) + laborHours(job);
}

export const hoursToPx = (
  hours: number,
  pxPerHour: number = DEFAULT_PX_PER_HOUR,
): number => hours * pxPerHour;

export const pxToHours = (
  px: number,
  pxPerHour: number = DEFAULT_PX_PER_HOUR,
): number => px / pxPerHour;
