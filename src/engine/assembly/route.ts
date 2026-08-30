/**
 * Assembly route resolution: product type → stage sequence → area.
 *
 * The system only enforces stage *order*; it does not derive a route from the
 * BOM. Three fixed routes cover everything today, and per-part exceptions can
 * be layered on later without changing callers.
 */

import type { AreaId } from '@/domain/ids';
import type { Job } from '@/domain/types';
import {
  AREA_A,
  ROUTES,
  STAGES,
  type ProductType,
  type StageDef,
  type StageId,
} from '@/domain/assembly';

/** The ordered stages for a product type (empty when the type is unknown). */
export function routeFor(productType: ProductType | null): StageId[] {
  return productType ? ROUTES[productType] : [];
}

export const stageDef = (stage: StageId): StageDef => STAGES[stage];

/** Where a stage runs by default. */
export const areaForStage = (stage: StageId): AreaId =>
  STAGES[stage].defaultArea;

/** Position of the order in its route, or -1 when it doesn't fit. */
export function stageIndex(job: Job): number {
  if (!job.currentStage) return -1;
  return routeFor(job.productType).indexOf(job.currentStage);
}

/** The stage after the current one, or null when the route is finished. */
export function nextStage(job: Job): StageId | null {
  const route = routeFor(job.productType);
  const i = stageIndex(job);
  if (i < 0 || i >= route.length - 1) return null;
  return route[i + 1];
}

export function isFinalStage(job: Job): boolean {
  const route = routeFor(job.productType);
  return route.length > 0 && stageIndex(job) === route.length - 1;
}

/**
 * The area an assembly order belongs to right now. Falls back to general
 * assembly so an order with a missing/ill-formed stage still lands somewhere
 * visible rather than disappearing.
 */
export function areaForJob(job: Job): AreaId {
  if (job.currentStage && STAGES[job.currentStage]) {
    return STAGES[job.currentStage].defaultArea;
  }
  const first = routeFor(job.productType)[0];
  return first ? STAGES[first].defaultArea : AREA_A;
}
