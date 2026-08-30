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
import type { JobId, WorkCenterId } from '@/domain/ids';
import type { Job, WorkCenter } from '@/domain/types';
import { areaForJob } from '@/engine/assembly/route';

/** Container id for the un-scheduled job pool. */
export const POOL_ID = '__pool__';

export type Containers = Record<string, JobId[]>;

interface PlanState {
  containers: Containers;
  /** Per-line breakdown/delay offset in hours; shifts the whole lane right. */
  laneDelays: Record<string, number>;
  initialized: boolean;

  /** Per-area crew size the supervisor allocated (assembly only). */
  areaHeadcount: Record<string, number>;

  /** Seed lanes from each job's home work centre; the rest go to the pool. */
  initFromDataset: (workCenters: WorkCenter[], jobs: Job[]) => void;
  /**
   * Merge a refreshed dataset into the current layout: keep every placement the
   * planner made, drop jobs that disappeared, and file genuinely new jobs onto
   * their workbook line (or the pool). Idempotent — safe to call on every load.
   */
  reconcile: (workCenters: WorkCenter[], jobs: Job[]) => void;
  /** Replace the whole layout (e.g. loaded from persistence). */
  setContainers: (containers: Containers) => void;
  /** Nudge a line's delay by a relative amount of hours (clamped ≥ 0). */
  adjustLaneDelay: (workCenterId: WorkCenterId, deltaHours: number) => void;
  /** Remove a line's delay. */
  clearLaneDelay: (workCenterId: WorkCenterId) => void;
  /** Replace all lane delays (e.g. loaded from persistence). */
  setLaneDelays: (delays: Record<string, number>) => void;
  /** Set an assembly area's crew size. */
  setAreaHeadcount: (areaId: WorkCenterId, headcount: number) => void;
  /** Replace all area headcounts (e.g. loaded from persistence). */
  setAreaHeadcounts: (counts: Record<string, number>) => void;
  /** Move a job into `toContainer` at `toIndex` (end if omitted). */
  moveJob: (jobId: JobId, toContainer: string, toIndex?: number) => void;
  /** Send a job back to the un-scheduled pool. */
  sendToPool: (jobId: JobId) => void;
  /** Clear the board and re-seed from the dataset. */
  reset: (workCenters: WorkCenter[], jobs: Job[]) => void;
  /** Which container currently holds the job, or null. */
  containerOf: (jobId: JobId) => string | null;
}

function emptyContainers(workCenters: WorkCenter[]): Containers {
  const c: Containers = { [POOL_ID]: [] };
  for (const w of workCenters) c[w.id] = [];
  return c;
}

/**
 * Where a job belongs before the planner touches it: a moulding job goes to
 * the line the workbook has it on, an assembly job to the area its current
 * route stage runs in.
 */
function homeContainer(job: Job, known: Set<string>): string {
  const target =
    job.department === 'assembly' ? areaForJob(job) : job.preferredMachine;
  return target && known.has(String(target)) ? String(target) : POOL_ID;
}

function seed(workCenters: WorkCenter[], jobs: Job[]): Containers {
  const containers = emptyContainers(workCenters);
  const known = new Set(workCenters.map((w) => String(w.id)));
  for (const job of jobs) containers[homeContainer(job, known)].push(job.id);
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
  laneDelays: {},
  areaHeadcount: {},
  initialized: false,

  initFromDataset(workCenters, jobs) {
    if (get().initialized) return;
    set({ containers: seed(workCenters, jobs), initialized: true });
  },

  reconcile(workCenters, jobs) {
    set((state) => {
      const known = new Set(workCenters.map((w) => String(w.id)));
      const liveJobs = new Set(jobs.map((j) => String(j.id)));
      const next: Containers = emptyContainers(workCenters);
      const placed = new Set<string>();

      // 1. Carry over existing placements for jobs that still exist.
      for (const [key, ids] of Object.entries(state.containers)) {
        const target = key === POOL_ID || known.has(key) ? key : POOL_ID;
        for (const id of ids) {
          const sid = String(id);
          if (!liveJobs.has(sid) || placed.has(sid)) continue;
          next[target].push(id);
          placed.add(sid);
        }
      }

      // 2. File any genuinely new jobs onto their home work centre, else pool.
      for (const job of jobs) {
        if (placed.has(String(job.id))) continue;
        next[homeContainer(job, known)].push(job.id);
        placed.add(String(job.id));
      }

      // Drop delays and crew sizes for work centres that no longer exist.
      const laneDelays: Record<string, number> = {};
      for (const [k, v] of Object.entries(state.laneDelays)) {
        if (known.has(k) && v > 0) laneDelays[k] = v;
      }
      const areaHeadcount: Record<string, number> = {};
      for (const [k, v] of Object.entries(state.areaHeadcount)) {
        if (known.has(k)) areaHeadcount[k] = v;
      }

      return { containers: next, laneDelays, areaHeadcount, initialized: true };
    });
  },

  setContainers(containers) {
    set({ containers, initialized: true });
  },

  adjustLaneDelay(machineId, deltaHours) {
    const key = String(machineId);
    set((state) => {
      const next = Math.max(0, (state.laneDelays[key] ?? 0) + deltaHours);
      const laneDelays = { ...state.laneDelays };
      if (next === 0) delete laneDelays[key];
      else laneDelays[key] = next;
      return { laneDelays };
    });
  },

  clearLaneDelay(machineId) {
    set((state) => {
      const laneDelays = { ...state.laneDelays };
      delete laneDelays[String(machineId)];
      return { laneDelays };
    });
  },

  setLaneDelays(delays) {
    set({ laneDelays: { ...delays } });
  },

  setAreaHeadcount(areaId, headcount) {
    set((state) => ({
      areaHeadcount: {
        ...state.areaHeadcount,
        [String(areaId)]: Math.max(0, Math.round(headcount)),
      },
    }));
  },

  setAreaHeadcounts(counts) {
    set({ areaHeadcount: { ...counts } });
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

  reset(workCenters, jobs) {
    set({
      containers: seed(workCenters, jobs),
      laneDelays: {},
      areaHeadcount: {},
      initialized: true,
    });
  },

  containerOf(jobId) {
    for (const [key, ids] of Object.entries(get().containers)) {
      if (ids.includes(jobId)) return key;
    }
    return null;
  },
}));
