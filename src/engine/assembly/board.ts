/**
 * Derives the assembly board: four area columns of orders, each with its
 * material verdict, release gate and people-hours load.
 *
 * Same shape as `computeBoardView` for the moulding Gantt — a pure function
 * from (orders + assignments + crew) to a view model — so when the MES event
 * log arrives it slots in here rather than changing the UI.
 */

import type { Job, PlanWarning, PlanningDataset, WorkCenter } from '@/domain/types';
import type { MaterialStatus } from '@/domain/types';
import type { StageDef, StageId } from '@/domain/assembly';
import type { DataIndexes } from '@/engine/indexes';
import { explodeMaterials } from '@/engine/materialExplosion';
import { materialAvailability } from '@/engine/materialAvailability';
import { computeWarnings } from '@/engine/validate';
import { areaLoad, type AreaLoad } from './capacity';
import { releaseCheck, type ReleaseCheck } from './release';
import { routeFor, stageDef, stageIndex } from './route';

export interface AssemblyOrderView {
  job: Job;
  /** The stage the order sits at, when it has a valid one. */
  stage: StageDef | null;
  route: StageId[];
  /** Position in the route, -1 when unknown. */
  stageIndex: number;
  material: MaterialStatus;
  release: ReleaseCheck;
  warnings: PlanWarning[];
}

export interface AreaColumnView {
  area: WorkCenter;
  orders: AssemblyOrderView[];
  load: AreaLoad;
}

export interface AssemblyBoardView {
  columns: AreaColumnView[];
  /** Assembly orders not assigned to any area. */
  pool: Job[];
  totals: {
    orders: number;
    plannedHours: number;
    availableHours: number;
    loadPct: number;
    blocked: number;
    ready: number;
  };
  jobsById: Map<string, Job>;
}

function viewFor(
  job: Job,
  indexes: DataIndexes,
  now: Date,
): AssemblyOrderView {
  const material = materialAvailability(
    explodeMaterials(job, indexes.bomByJob, indexes.bomByPart),
    indexes.inventoryByPart,
    indexes.poByPart,
  );
  const release = releaseCheck(material, job.materialPrep);
  const stage = job.currentStage ? stageDef(job.currentStage) : null;

  return {
    job,
    stage,
    route: routeFor(job.productType),
    stageIndex: stageIndex(job),
    material,
    release,
    // Assembly has no changeover, so due-date/labour/material checks are the
    // relevant ones — reused wholesale from the shared validator.
    warnings: computeWarnings({
      job,
      material,
      end: job.dueDate ?? now,
      now,
    }),
  };
}

export function computeAssemblyBoard(
  dataset: PlanningDataset,
  indexes: DataIndexes,
  containers: Record<string, unknown[]>,
  headcounts: Record<string, number>,
  now: Date,
): AssemblyBoardView {
  const assemblyJobs = dataset.jobs.filter((j) => j.department === 'assembly');
  const jobsById = new Map(assemblyJobs.map((j) => [String(j.id), j]));
  const areas = dataset.workCenters
    .filter((w) => w.department === 'assembly')
    .sort((a, b) => a.sortIndex - b.sortIndex);

  const placed = new Set<string>();

  const columns: AreaColumnView[] = areas.map((area) => {
    const ids = (containers[String(area.id)] ?? []).map(String);
    const orders: AssemblyOrderView[] = [];
    for (const id of ids) {
      const job = jobsById.get(id);
      if (!job || placed.has(id)) continue;
      placed.add(id);
      orders.push(viewFor(job, indexes, now));
    }
    const headcount = headcounts[String(area.id)] ?? area.suggested?.min ?? 0;
    return {
      area,
      orders,
      load: areaLoad(
        orders.map((o) => o.job),
        headcount,
      ),
    };
  });

  const pool = assemblyJobs.filter((j) => !placed.has(String(j.id)));

  const plannedHours = columns.reduce((s, c) => s + c.load.plannedHours, 0);
  const availableHours = columns.reduce((s, c) => s + c.load.availableHours, 0);
  const all = columns.flatMap((c) => c.orders);

  return {
    columns,
    pool,
    totals: {
      orders: all.length,
      plannedHours,
      availableHours,
      loadPct: availableHours > 0 ? (plannedHours / availableHours) * 100 : 0,
      blocked: all.filter((o) => o.release.level === 'blocked').length,
      ready: all.filter((o) => o.release.level === 'ready').length,
    },
    jobsById,
  };
}
