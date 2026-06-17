/**
 * Persistence contract for saved plans. Single planner, so "current" is the
 * working plan; `list()` supports named snapshots if you want them later.
 */

import type { Containers } from '@/store/planStore';

export interface PersistedPlan {
  id: string;
  name: string;
  /** ISO timestamp. */
  savedAt: string;
  containers: Containers;
  /** Per-line breakdown/delay offsets in hours. */
  laneDelays?: Record<string, number>;
}

export interface PlanSummary {
  id: string;
  name: string;
  savedAt: string;
}

/** The id used for the planner's live working plan. */
export const CURRENT_PLAN_ID = 'current';

export interface PlanRepository {
  save(plan: PersistedPlan): Promise<void>;
  load(id?: string): Promise<PersistedPlan | null>;
  list(): Promise<PlanSummary[]>;
}
