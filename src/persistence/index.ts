/**
 * Pick a plan repository from configuration: a REST backend when
 * `VITE_PERSIST_API_URL` is set, otherwise browser localStorage.
 */

import type { PlanRepository } from './PlanRepository';
import { ApiPlanRepository } from './ApiPlanRepository';
import { LocalStoragePlanRepository } from './LocalStoragePlanRepository';

export function createPlanRepository(): PlanRepository {
  const url = import.meta.env.VITE_PERSIST_API_URL;
  return url
    ? new ApiPlanRepository(url)
    : new LocalStoragePlanRepository();
}

export * from './PlanRepository';
