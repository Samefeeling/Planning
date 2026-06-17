/**
 * Derived board state: turns the plan (containers of job ids) + the dataset
 * into a fully-scheduled timeline the UI renders.
 *
 * For each lane we walk the jobs in order, placing each one back-to-back: a
 * changeover (if the die/colour/insert differs from the previous job) and any
 * wait for incoming material push the start later, which shows up as a gap on
 * the board. This is the single place the engine pieces are composed.
 */

import { useMemo } from 'react';
import type { Job, Machine, PlanWarning, ScheduledJob } from '@/domain/types';
import type { PlanningDataset } from '@/domain/types';
import type { DataIndexes } from '@/engine/indexes';
import {
  detectChangeover,
  type ChangeoverInputs,
} from '@/engine/changeover';
import { routingFor } from '@/engine/routing';
import { explodeMaterials } from '@/engine/materialExplosion';
import { materialAvailability } from '@/engine/materialAvailability';
import { routingWarning } from '@/engine/constraints';
import { computeWarnings } from '@/engine/validate';
import { changeoverHours, laborHours } from '@/engine/duration';
import { addHours, addLaborHours, floorToHour, maxDate } from '@/lib/time';
import { useDataStore } from './dataStore';
import { POOL_ID, usePlanStore, type Containers } from './planStore';

export interface LaneView {
  machine: Machine;
  jobs: ScheduledJob[];
  totalRunHours: number;
  totalSetupMinutes: number;
}

export interface BoardView {
  horizonStart: Date;
  horizonEnd: Date;
  lanes: LaneView[];
  pool: Job[];
  warnings: PlanWarning[];
  jobsById: Map<string, Job>;
}

export function computeBoardView(
  dataset: PlanningDataset,
  indexes: DataIndexes,
  containers: Containers,
  now: Date,
): BoardView {
  const jobsById = new Map(dataset.jobs.map((j) => [String(j.id), j]));
  const horizonStart = floorToHour(now);
  let horizonEnd = addHours(horizonStart, 24);

  const lanes: LaneView[] = dataset.machines.map((machine) => {
    const ids = containers[machine.id] ?? [];
    const scheduled: ScheduledJob[] = [];
    let cursor = horizonStart;
    let prev: ChangeoverInputs | null = null;
    let totalRunHours = 0;
    let totalSetupMinutes = 0;

    ids.forEach((jobId, index) => {
      const job = jobsById.get(String(jobId));
      if (!job) return;

      const routing = routingFor(job.partNum, machine.id, indexes.routing);
      const currInputs: ChangeoverInputs = routing
        ? { tool: routing.tool, color: routing.color, insert: routing.insert }
        : { tool: job.tool, color: null, insert: null };

      const changeover = detectChangeover(prev, currInputs);
      const material = materialAvailability(
        explodeMaterials(job, indexes.bomByJob, indexes.bomByPart),
        indexes.inventoryByPart,
        indexes.poByPart,
      );

      const afterSetup = addHours(cursor, changeoverHours(changeover.minutes));
      const runStart = material.earliestStart
        ? maxDate(afterSetup, material.earliestStart)
        : afterSetup;
      const runHours = laborHours(job);
      const runEnd = addLaborHours(runStart, runHours);

      const warnings: PlanWarning[] = [];
      const rWarn = routingWarning(job, machine.id, indexes.routing);
      if (rWarn) warnings.push(rWarn);
      warnings.push(...computeWarnings({ job, material, end: runEnd, now }));

      scheduled.push({
        job,
        machine: machine.id,
        index,
        start: runStart,
        end: runEnd,
        runHours,
        changeover,
        material,
        routing,
        warnings,
      });

      cursor = runEnd;
      prev = currInputs;
      totalRunHours += runHours;
      totalSetupMinutes += changeover.minutes;
    });

    if (cursor > horizonEnd) horizonEnd = cursor;
    return { machine, jobs: scheduled, totalRunHours, totalSetupMinutes };
  });

  const pool = (containers[POOL_ID] ?? [])
    .map((id) => jobsById.get(String(id)))
    .filter((j): j is Job => Boolean(j));

  const warnings = lanes.flatMap((l) => l.jobs.flatMap((j) => j.warnings));

  return {
    horizonStart,
    horizonEnd: addHours(horizonEnd, 8), // breathing room on the right edge
    lanes,
    pool,
    warnings,
    jobsById,
  };
}

/** Subscribe to the fully-derived board, recomputed when data or plan change. */
export function useBoardView(): BoardView | null {
  const dataset = useDataStore((s) => s.dataset);
  const indexes = useDataStore((s) => s.indexes);
  const containers = usePlanStore((s) => s.containers);
  return useMemo(
    () =>
      dataset && indexes
        ? computeBoardView(dataset, indexes, containers, dataset.fetchedAt)
        : null,
    [dataset, indexes, containers],
  );
}

/** Look up a single scheduled job across all lanes (for the inspector). */
export function findScheduledJob(
  board: BoardView | null,
  jobId: string | null,
): ScheduledJob | null {
  if (!board || !jobId) return null;
  for (const lane of board.lanes) {
    const hit = lane.jobs.find((s) => String(s.job.id) === jobId);
    if (hit) return hit;
  }
  return null;
}
