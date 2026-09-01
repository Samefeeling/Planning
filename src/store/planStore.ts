/**
 * The planner's working state: which orders sit on which line, who is on them,
 * where their bar starts, and what each shift booked.
 *
 * Placement is modelled as named "containers" of job ids — one per line plus a
 * pool of un-assigned orders — which makes drag-and-drop uniform. The derived
 * schedule (start, Expect Date, colour) is computed in
 * `engine/assembly/board.ts`; this store only owns the inputs.
 */

import { create } from 'zustand';
import type { JobId } from '@/domain/ids';
import type { Job, WorkCenter } from '@/domain/types';
import { MAX_WORKERS_PER_ORDER } from '@/domain/assembly';

/** Container id for the un-scheduled job pool. */
export const POOL_ID = '__pool__';

export type Containers = Record<string, JobId[]>;

export type PauseReason =
  | 'material-shortage'
  | 'waiting-previous-stage'
  | 'equipment'
  | 'quality'
  | 'labour-reallocated';

/** One daily ASSY_Production booking, shaped for downstream KPI.ts use. */
export interface ProductionEntry {
  date: string;
  /** Quantity confirmed complete during the shift. */
  complete: number;
  reject: number;
  rework: number;
  /** Total output reported by the shift, including pieces awaiting disposition. */
  shiftOutput: number;
  paused: boolean;
  pauseReason: PauseReason | null;
  /** Explicit supervisor confirmation that no more work remains on this job. */
  jobCompleted: boolean;
  notes: string;
}

interface PlanState {
  containers: Containers;
  initialized: boolean;

  /** Job id → allocated worker ids (assembly; capped at four). */
  orderWorkers: Record<string, string[]>;
  /** Job id → ISO day the planner dragged the bar to. */
  orderStarts: Record<string, string>;
  /**
   * Job id → supervisor approval to work this order at the weekend. Absent
   * means no: the schedule steps over Saturday and Sunday by default, and the
   * board asks before writing weekend work.
   */
  orderOvertime: Record<string, boolean>;
  /** Job id → end-of-shift completed-quantity entries. */
  progress: Record<string, { date: string; qty: number }[]>;
  production: Record<string, ProductionEntry[]>;

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
  /** Put a worker on an order (no-op when full or already on it). */
  assignWorker: (jobId: JobId, workerId: string) => void;
  /** Take a worker off an order. */
  unassignWorker: (jobId: JobId, workerId: string) => void;
  /** Pin an order's bar to a start day (null clears the pin). */
  setOrderStart: (jobId: JobId, isoDay: string | null) => void;
  /** Approve, or withdraw, weekend working on one order. */
  setOvertime: (jobId: JobId, approved: boolean) => void;
  /** Record the quantity finished on a given day (replaces that day's entry). */
  recordProgress: (jobId: JobId, isoDay: string, qty: number) => void;
  recordProduction: (jobId: JobId, entry: ProductionEntry) => void;
  /** Replace the assembly plan wholesale (e.g. loaded from persistence). */
  setAssemblyPlan: (plan: {
    orderWorkers?: Record<string, string[]>;
    orderStarts?: Record<string, string>;
    orderOvertime?: Record<string, boolean>;
    progress?: Record<string, { date: string; qty: number }[]>;
    production?: Record<string, ProductionEntry[]>;
  }) => void;
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
 * Where a job belongs before the planner touches it: its assembly line, or the
 * moulding line the workbook has it on.
 */
function homeContainer(job: Job, known: Set<string>): string {
  const target = job.department === 'assembly' ? job.line : job.preferredMachine;
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
  orderWorkers: {},
  orderStarts: {},
  orderOvertime: {},
  progress: {},
  production: {},
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

      const keep = <T,>(src: Record<string, T>): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [k, v] of Object.entries(src)) {
          if (liveJobs.has(k)) out[k] = v;
        }
        return out;
      };

      // Crew is the supervisor's to set, but a brand-new order starts with
      // whatever allocation the source system already has on it.
      const orderWorkers = keep(state.orderWorkers);
      for (const job of jobs) {
        const key = String(job.id);
        if (!orderWorkers[key] && job.assignedWorkers.length > 0) {
          orderWorkers[key] = job.assignedWorkers.map(String);
        }
      }

      return {
        containers: next,
        orderWorkers,
        orderStarts: keep(state.orderStarts),
        orderOvertime: keep(state.orderOvertime),
        progress: keep(state.progress),
        production: keep(state.production),
        initialized: true,
      };
    });
  },

  setContainers(containers) {
    set({ containers, initialized: true });
  },


  assignWorker(jobId, workerId) {
    set((state) => {
      const key = String(jobId);
      const current = state.orderWorkers[key] ?? [];
      if (current.includes(workerId) || current.length >= MAX_WORKERS_PER_ORDER) {
        return state;
      }
      return {
        orderWorkers: { ...state.orderWorkers, [key]: [...current, workerId] },
      };
    });
  },

  unassignWorker(jobId, workerId) {
    set((state) => {
      const key = String(jobId);
      const current = state.orderWorkers[key] ?? [];
      return {
        orderWorkers: {
          ...state.orderWorkers,
          [key]: current.filter((w) => w !== workerId),
        },
      };
    });
  },

  setOrderStart(jobId, isoDay) {
    set((state) => {
      const orderStarts = { ...state.orderStarts };
      if (isoDay === null) delete orderStarts[String(jobId)];
      else orderStarts[String(jobId)] = isoDay;
      return { orderStarts };
    });
  },

  setOvertime(jobId, approved) {
    set((state) => {
      const orderOvertime = { ...state.orderOvertime };
      if (approved) orderOvertime[String(jobId)] = true;
      else delete orderOvertime[String(jobId)];
      return { orderOvertime };
    });
  },

  recordProgress(jobId, isoDay, qty) {
    set((state) => {
      const key = String(jobId);
      const entries = (state.progress[key] ?? []).filter(
        (e) => e.date !== isoDay,
      );
      const next = [...entries, { date: isoDay, qty: Math.max(0, qty) }].sort(
        (a, b) => a.date.localeCompare(b.date),
      );
      return { progress: { ...state.progress, [key]: next } };
    });
  },

  recordProduction(jobId, entry) {
    set((state) => {
      const key = String(jobId);
      const entries = (state.production[key] ?? []).filter(
        (existing) => existing.date !== entry.date,
      );
      return {
        production: {
          ...state.production,
          [key]: [...entries, entry].sort((a, b) => a.date.localeCompare(b.date)),
        },
      };
    });
  },

  setAssemblyPlan(plan) {
    set((state) => ({
      orderWorkers: plan.orderWorkers ?? state.orderWorkers,
      orderStarts: plan.orderStarts ?? state.orderStarts,
      orderOvertime: plan.orderOvertime ?? state.orderOvertime,
      progress: plan.progress ?? state.progress,
      production: plan.production ?? state.production,
    }));
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
      orderWorkers: {},
      orderStarts: {},
      orderOvertime: {},
      progress: {},
      production: {},
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
