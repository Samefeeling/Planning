/**
 * Persistence contract for saved plans. Single planner, so "current" is the
 * working plan; `list()` supports named snapshots if you want them later.
 */

import type { Containers } from '@/store/planStore';
import type {
  ActualStartRecord,
  ProductionEntry,
  ProgressBaseline,
} from '@/store/planStore';
import type { CrewAssignment } from '@/domain/assembly';

export interface PersistedPlan {
  id: string;
  name: string;
  /** ISO timestamp. */
  savedAt: string;
  containers: Containers;
  /** Assembly plan: crew per order, pinned starts, booked output. */
  assembly?: {
    orderWorkers?: Record<string, string[]>;
    /** Date-bounded crew plan; supersedes static `orderWorkers`. */
    orderCrewAssignments?: Record<string, CrewAssignment[]>;
    orderStarts?: Record<string, string>;
    /** Exact, immutable production start confirmation. */
    orderActualStarts?: Record<string, ActualStartRecord>;
    /** Orders the supervisor approved for weekend working. */
    orderOvertime?: Record<string, boolean>;
    /** Per order, the people approved to be on it while on another too. */
    orderDoubleBooked?: Record<string, string[]>;
    progress?: Record<string, { date: string; qty: number }[]>;
    progressBaselines?: Record<string, ProgressBaseline>;
    /** Daily rows persisted by the backend in the ASSY_Production list. */
    production?: Record<string, ProductionEntry[]>;
  };
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
