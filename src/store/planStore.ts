/**
 * The planner's working state: which jobs sit on which line, in what order.
 *
 * Everything is modelled as named "containers" of job ids — one per machine
 * plus a special pool of un-scheduled jobs — which makes drag-and-drop between
 * lanes and the pool uniform. The derived timeline (start/end, changeovers,
 * material) is computed separately in `selectors.ts`; this store only owns the
 * ordering.
 */

import { create } from 'zustand';
import type { JobId, MachineId } from '@/domain/ids';
import type { Job, Machine } from '@/domain/types';

/** Container id for the un-scheduled job pool. */
export const POOL_ID = '__pool__';

export type Containers = Record<string, JobId[]>;

interface PlanState {
  containers: Containers;
  initialized: boolean;

  /** Seed lanes from each job's workbook machine; the rest go to the pool. */
  initFromDataset: (machines: Machine[], jobs: Job[]) => void;
  /**
   * Merge a refreshed dataset into the current layout: keep every placement the
   * planner made, drop jobs that disappeared, and file genuinely new jobs onto
   * their workbook line (or the pool). Idempotent — safe to call on every load.
   */
  reconcile: (machines: Machine[], jobs: Job[]) => void;
  /** Replace the whole layout (e.g. loaded from persistence). */
  setContainers: (containers: Containers) => void;
  /** Move a job into `toContainer` at `toIndex` (end if omitted). */
  moveJob: (jobId: JobId, toContainer: string, toIndex?: number) => void;
  /** Send a job back to the un-scheduled pool. */
  sendToPool: (jobId: JobId) => void;
  /** Clear the board and re-seed from the dataset. */
  reset: (machines: Machine[], jobs: Job[]) => void;
  /** Which container currently holds the job, or null. */
  containerOf: (jobId: JobId) => string | null;
}

function emptyContainers(machines: Machine[]): Containers {
  const c: Containers = { [POOL_ID]: [] };
  for (const m of machines) c[m.id] = [];
  return c;
}

function seed(machines: Machine[], jobs: Job[]): Containers {
  const containers = emptyContainers(machines);
  const known = new Set<MachineId>(machines.map((m) => m.id));
  for (const job of jobs) {
    const target =
      job.preferredMachine && known.has(job.preferredMachine)
        ? job.preferredMachine
        : POOL_ID;
    containers[target].push(job.id);
  }
  return containers;
}

/** Remove a job id from every container (returns a new map). */
function withoutJob(containers: Containers, jobId: JobId): Containers {
  const next: Containers = {};
  for (const [key, ids] of Object.entries(containers)) {
    next[key] = ids.includes(jobId) ? ids.filter((id) => id !== jobId) : ids;
  }
  return next;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  containers: { [POOL_ID]: [] },
  initialized: false,

  initFromDataset(machines, jobs) {
    if (get().initialized) return;
    set({ containers: seed(machines, jobs), initialized: true });
  },

  reconcile(machines, jobs) {
    set((state) => {
      const known = new Set<MachineId>(machines.map((m) => m.id));
      const liveJobs = new Set(jobs.map((j) => String(j.id)));
      const next: Containers = emptyContainers(machines);
      const placed = new Set<string>();

      // 1. Carry over existing placements for jobs that still exist.
      for (const [key, ids] of Object.entries(state.containers)) {
        const target =
          key === POOL_ID || known.has(key as MachineId) ? key : POOL_ID;
        for (const id of ids) {
          const sid = String(id);
          if (!liveJobs.has(sid) || placed.has(sid)) continue;
          next[target].push(id);
          placed.add(sid);
        }
      }

      // 2. File any genuinely new jobs onto their workbook line, else the pool.
      for (const job of jobs) {
        if (placed.has(String(job.id))) continue;
        const target =
          job.preferredMachine && known.has(job.preferredMachine)
            ? job.preferredMachine
            : POOL_ID;
        next[target].push(job.id);
        placed.add(String(job.id));
      }

      return { containers: next, initialized: true };
    });
  },

  setContainers(containers) {
    set({ containers, initialized: true });
  },

  moveJob(jobId, toContainer, toIndex) {
    set((state) => {
      const cleared = withoutJob(state.containers, jobId);
      const target = [...(cleared[toContainer] ?? [])];
      const at = toIndex === undefined ? target.length : Math.max(0, Math.min(toIndex, target.length));
      target.splice(at, 0, jobId);
      return { containers: { ...cleared, [toContainer]: target } };
    });
  },

  sendToPool(jobId) {
    get().moveJob(jobId, POOL_ID);
  },

  reset(machines, jobs) {
    set({ containers: seed(machines, jobs), initialized: true });
  },

  containerOf(jobId) {
    for (const [key, ids] of Object.entries(get().containers)) {
      if (ids.includes(jobId)) return key;
    }
    return null;
  },
}));
