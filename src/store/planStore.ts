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
import {
  MAX_WORKERS_PER_ORDER,
  type CrewAssignment,
  type LineKey,
} from '@/domain/assembly';

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
  /** Immutable crew snapshot for this shift. */
  operatorIds?: string[];
  operatorNames?: string[];
  /** Exact completion instant; set only when `jobCompleted` is true. */
  completedAt?: string | null;
  notes: string;
}

export interface ActualStartRecord {
  /** Exact instant the Start production button was confirmed. */
  startedAt: string;
  /** Required whenever the normal release gate was overridden. */
  overrideReason: string | null;
  operatorIds: string[];
  operatorNames: string[];
}

export interface ProgressBaseline {
  /** Source quantities at the first local booking, used to avoid double counting. */
  remainingQty: number;
  completedQty: number;
}

interface PlanState {
  containers: Containers;
  initialized: boolean;

  /** Supervisor-owned current production line for each operator. */
  workerLines: Record<string, LineKey>;
  /**
   * Who is on each order, and between which days.
   *
   * The only record of it. There used to be a second, `orderWorkers`, holding
   * the same people without their windows, and every mutation had to write
   * both — so the two disagreed the moment anyone was given a window, and
   * every reader had to know which of them to believe. Plans stored in the
   * older shape are migrated on the way in; see `setAssemblyPlan`.
   */
  orderCrewAssignments: Record<string, CrewAssignment[]>;
  /** Job id → ISO day the planner dragged the bar to. */
  orderStarts: Record<string, string>;
  orderActualStarts: Record<string, ActualStartRecord>;
  /**
   * Job id → supervisor approval to work this order at the weekend. Absent
   * means no: the schedule steps over Saturday and Sunday by default, and the
   * board asks before writing weekend work.
   */
  orderOvertime: Record<string, boolean>;
  /**
   * Job id → workers the supervisor has explicitly allowed to be on this order
   * while they are on another at the same time. Nobody does two jobs at once,
   * so the board asks before allocating into an overlap; this is the answer.
   * Stored against the order being allocated — the pair is approved either way
   * round.
   */
  orderDoubleBooked: Record<string, string[]>;
  /** Job id → end-of-shift completed-quantity entries. */
  progress: Record<string, { date: string; qty: number }[]>;
  progressBaselines: Record<string, ProgressBaseline>;
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
  assignWorkerWindow: (
    jobId: JobId,
    workerId: string,
    fromDay: string | null,
    toDayExclusive: string | null,
  ) => void;
  updateWorkerWindow: (
    jobId: JobId,
    workerId: string,
    fromDay: string | null,
    toDayExclusive: string | null,
  ) => void;
  /** Take a worker off an order. */
  unassignWorker: (jobId: JobId, workerId: string) => void;
  /** Record that the supervisor accepts this person being on two orders. */
  approveDoubleBooking: (jobId: JobId, workerId: string) => void;
  /**
   * Crew several orders at once, for a freshly imported export. Only fills
   * orders that have nobody on them — an allocation already made is the
   * supervisor's and is never overwritten.
   */
  assignCrews: (allocations: Record<string, string[]>) => void;
  /** Move an operator's roster position; started work makes them immovable. */
  moveWorkerToLine: (workerId: string, line: LineKey) => void;
  /** Pin an order's bar to a start day (null clears the pin). */
  setOrderStart: (jobId: JobId, isoDay: string | null) => void;
  startOrder: (jobId: JobId, record: ActualStartRecord) => void;
  /** Approve, or withdraw, weekend working on one order. */
  setOvertime: (jobId: JobId, approved: boolean) => void;
  /** Record the quantity finished on a given day (replaces that day's entry). */
  recordProgress: (jobId: JobId, isoDay: string, qty: number) => void;
  recordProduction: (jobId: JobId, entry: ProductionEntry) => void;
  /** Save the shift and its progress atomically; completion also releases crew. */
  saveProductionEntry: (
    jobId: JobId,
    entry: ProductionEntry,
    source: ProgressBaseline,
  ) => void;
  /** Replace the assembly plan wholesale (e.g. loaded from persistence). */
  setAssemblyPlan: (plan: {
    /** Only read, never written: the older shape, migrated on the way in. */
    orderWorkers?: Record<string, string[]>;
    workerLines?: Record<string, LineKey>;
    orderCrewAssignments?: Record<string, CrewAssignment[]>;
    orderStarts?: Record<string, string>;
    orderActualStarts?: Record<string, ActualStartRecord>;
    orderOvertime?: Record<string, boolean>;
    orderDoubleBooked?: Record<string, string[]>;
    progress?: Record<string, { date: string; qty: number }[]>;
    progressBaselines?: Record<string, ProgressBaseline>;
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

const MIN_DAY = '0000-00-00';

const fullAssignments = (workers: string[]): CrewAssignment[] =>
  workers.slice(0, MAX_WORKERS_PER_ORDER).map((workerId) => ({
    workerId,
    fromDay: null,
    toDayExclusive: null,
  }));

const startsAt = (assignment: CrewAssignment): string =>
  assignment.fromDay ?? MIN_DAY;

const activeAt = (assignment: CrewAssignment, day: string): boolean =>
  startsAt(assignment) <= day &&
  (assignment.toDayExclusive === null || day < assignment.toDayExclusive);

const windowsOverlap = (
  a: CrewAssignment,
  b: CrewAssignment,
): boolean =>
  (a.toDayExclusive === null || startsAt(b) < a.toDayExclusive) &&
  (b.toDayExclusive === null || startsAt(a) < b.toDayExclusive);

/** Maximum people active together, evaluated at every window start. */
const withinCrewLimit = (assignments: CrewAssignment[]): boolean => {
  const starts = new Set(assignments.map(startsAt));
  return [...starts].every(
    (day) =>
      assignments.filter((assignment) => activeAt(assignment, day)).length <=
      MAX_WORKERS_PER_ORDER,
  );
};

export const usePlanStore = create<PlanState>((set, get) => ({
  containers: { [POOL_ID]: [] },
  workerLines: {},
  orderCrewAssignments: {},
  orderStarts: {},
  orderActualStarts: {},
  orderOvertime: {},
  orderDoubleBooked: {},
  progress: {},
  progressBaselines: {},
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
      const orderCrewAssignments = keep(state.orderCrewAssignments);
      for (const job of jobs) {
        const key = String(job.id);
        if (!orderCrewAssignments[key] && job.assignedWorkers.length > 0) {
          orderCrewAssignments[key] = fullAssignments(
            job.assignedWorkers.map(String),
          );
        }
      }

      return {
        containers: next,
        orderCrewAssignments,
        orderStarts: keep(state.orderStarts),
        orderActualStarts: keep(state.orderActualStarts),
        orderOvertime: keep(state.orderOvertime),
        orderDoubleBooked: keep(state.orderDoubleBooked),
        progress: keep(state.progress),
        progressBaselines: keep(state.progressBaselines),
        production: keep(state.production),
        initialized: true,
      };
    });
  },

  setContainers(containers) {
    set({ containers, initialized: true });
  },

  assignWorker(jobId, workerId) {
    get().assignWorkerWindow(jobId, workerId, null, null);
  },

  assignWorkerWindow(jobId, workerId, fromDay, toDayExclusive) {
    set((state) => {
      const key = String(jobId);
      if (state.orderActualStarts[key]) return state;
      if (fromDay && toDayExclusive && fromDay >= toDayExclusive) return state;
      const current = state.orderCrewAssignments[key] ?? [];
      const proposed: CrewAssignment = { workerId, fromDay, toDayExclusive };
      if (
        current.some(
          (assignment) =>
            assignment.workerId === workerId &&
            windowsOverlap(assignment, proposed),
        )
      ) return state;
      const next = [...current, proposed];
      if (!withinCrewLimit(next)) return state;
      return {
        orderCrewAssignments: { ...state.orderCrewAssignments, [key]: next },
      };
    });
  },

  updateWorkerWindow(jobId, workerId, fromDay, toDayExclusive) {
    set((state) => {
      const key = String(jobId);
      if (state.orderActualStarts[key]) return state;
      if (fromDay && toDayExclusive && fromDay >= toDayExclusive) return state;
      const current = state.orderCrewAssignments[key] ?? [];
      const proposed: CrewAssignment = { workerId, fromDay, toDayExclusive };
      const next = [
        ...current.filter((assignment) => assignment.workerId !== workerId),
        proposed,
      ];
      if (!withinCrewLimit(next)) return state;
      return {
        orderCrewAssignments: { ...state.orderCrewAssignments, [key]: next },
      };
    });
  },

  unassignWorker(jobId, workerId) {
    set((state) => {
      const key = String(jobId);
      if (state.orderActualStarts[key]) return state;
      const assignments = state.orderCrewAssignments[key] ?? [];
      // Any approval to double-book them here goes with them: put the same
      // person back later and the overlap is a fresh decision, not an old one.
      const approved = (state.orderDoubleBooked[key] ?? []).filter(
        (w) => w !== workerId,
      );
      const orderDoubleBooked = { ...state.orderDoubleBooked };
      if (approved.length > 0) orderDoubleBooked[key] = approved;
      else delete orderDoubleBooked[key];

      return {
        orderCrewAssignments: {
          ...state.orderCrewAssignments,
          [key]: assignments.filter(
            (assignment) => assignment.workerId !== workerId,
          ),
        },
        orderDoubleBooked,
      };
    });
  },

  approveDoubleBooking(jobId, workerId) {
    set((state) => {
      const key = String(jobId);
      const current = state.orderDoubleBooked[key] ?? [];
      if (current.includes(workerId)) return state;
      return {
        orderDoubleBooked: {
          ...state.orderDoubleBooked,
          [key]: [...current, workerId],
        },
      };
    });
  },

  assignCrews(allocations) {
    set((state) => {
      const orderCrewAssignments = { ...state.orderCrewAssignments };
      let changed = false;
      for (const [jobId, crew] of Object.entries(allocations)) {
        if (state.orderActualStarts[jobId]) continue;
        if ((orderCrewAssignments[jobId] ?? []).length > 0 || crew.length === 0) {
          continue;
        }
        orderCrewAssignments[jobId] = fullAssignments(crew);
        changed = true;
      }
      return changed ? { orderCrewAssignments } : state;
    });
  },

  moveWorkerToLine(workerId, line) {
    set((state) => {
      const assignmentsFor = (jobId: string): CrewAssignment[] =>
        state.orderCrewAssignments[jobId] ?? [];
      const hasWorker = (jobId: string): boolean =>
        assignmentsFor(jobId).some(
          (assignment) => assignment.workerId === workerId,
        );

      // Once production has started, the recorded crew is an operational fact
      // and cannot be rewritten by moving a name in the planning roster.
      if (
        Object.keys(state.orderActualStarts).some(
          (jobId) => state.orderActualStarts[jobId] && hasWorker(jobId),
        )
      ) return state;

      const containerByJob = new Map<string, string>();
      for (const [container, jobIds] of Object.entries(state.containers)) {
        for (const jobId of jobIds) containerByJob.set(String(jobId), container);
      }

      const affected = Object.keys(state.orderCrewAssignments).filter(
        (jobId) =>
          hasWorker(jobId) &&
          !state.orderActualStarts[jobId] &&
          containerByJob.get(jobId) !== line,
      );
      const orderCrewAssignments = { ...state.orderCrewAssignments };
      const orderDoubleBooked = { ...state.orderDoubleBooked };

      for (const jobId of affected) {
        const next = assignmentsFor(jobId).filter(
          (assignment) => assignment.workerId !== workerId,
        );
        if (next.length > 0) orderCrewAssignments[jobId] = next;
        else delete orderCrewAssignments[jobId];
      }
      for (const [jobId, workers] of Object.entries(orderDoubleBooked)) {
        // An approval may be stored against either side of the old overlap.
        // Once a line move removes any assignment, expire every approval for
        // this worker so a future clash always needs a fresh decision.
        if (affected.length === 0) continue;
        const next = workers.filter((id) => id !== workerId);
        if (next.length > 0) orderDoubleBooked[jobId] = next;
        else delete orderDoubleBooked[jobId];
      }

      return {
        workerLines: { ...state.workerLines, [workerId]: line },
        orderCrewAssignments,
        orderDoubleBooked,
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

  startOrder(jobId, record) {
    set((state) => {
      const key = String(jobId);
      if (
        state.orderActualStarts[key] ||
        record.operatorIds.length === 0 ||
        Number.isNaN(Date.parse(record.startedAt))
      ) return state;
      return {
        orderActualStarts: { ...state.orderActualStarts, [key]: record },
      };
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

  saveProductionEntry(jobId, entry, source) {
    set((state) => {
      const key = String(jobId);
      const actualStart = state.orderActualStarts[key];
      const quantities = [
        entry.complete,
        entry.reject,
        entry.rework,
        entry.shiftOutput,
      ];
      if (
        !actualStart ||
        !quantities.every((value) => Number.isFinite(value) && value >= 0) ||
        (entry.jobCompleted && !entry.completedAt)
      ) return state;
      const savedEntry: ProductionEntry = {
        ...entry,
        operatorIds: entry.operatorIds ?? actualStart.operatorIds,
        operatorNames: entry.operatorNames ?? actualStart.operatorNames,
      };
      const productionEntries = (state.production[key] ?? []).filter(
        (existing) => existing.date !== savedEntry.date,
      );
      const progressEntries = (state.progress[key] ?? []).filter(
        (existing) => existing.date !== savedEntry.date,
      );
      const orderCrewAssignments = { ...state.orderCrewAssignments };
      const orderDoubleBooked = { ...state.orderDoubleBooked };
      if (savedEntry.jobCompleted) {
        delete orderCrewAssignments[key];
        delete orderDoubleBooked[key];
      }
      return {
        production: {
          ...state.production,
          [key]: [...productionEntries, savedEntry].sort((a, b) =>
            a.date.localeCompare(b.date),
          ),
        },
        progress: {
          ...state.progress,
          [key]: [...progressEntries, { date: savedEntry.date, qty: savedEntry.complete }].sort(
            (a, b) => a.date.localeCompare(b.date),
          ),
        },
        progressBaselines: state.progressBaselines[key]
          ? state.progressBaselines
          : { ...state.progressBaselines, [key]: source },
        orderCrewAssignments,
        orderDoubleBooked,
      };
    });
  },

  setAssemblyPlan(plan) {
    set((state) => {
      // A plan stored before crew had windows carries `orderWorkers` and no
      // assignments. Read once, here, and never written back.
      const orderCrewAssignments =
        plan.orderCrewAssignments ??
        (plan.orderWorkers
          ? Object.fromEntries(
              Object.entries(plan.orderWorkers).map(([jobId, workers]) => [
                jobId,
                fullAssignments(workers),
              ]),
            )
          : state.orderCrewAssignments);
      return {
        workerLines: plan.workerLines ?? state.workerLines,
        orderCrewAssignments,
        orderStarts: plan.orderStarts ?? state.orderStarts,
        orderActualStarts: plan.orderActualStarts ?? state.orderActualStarts,
        orderOvertime: plan.orderOvertime ?? state.orderOvertime,
        orderDoubleBooked: plan.orderDoubleBooked ?? state.orderDoubleBooked,
        progress: plan.progress ?? state.progress,
        progressBaselines:
          plan.progressBaselines ?? state.progressBaselines,
        production: plan.production ?? state.production,
      };
    });
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
      workerLines: {},
      orderCrewAssignments: {},
      orderStarts: {},
      orderActualStarts: {},
      orderOvertime: {},
      orderDoubleBooked: {},
      progress: {},
      progressBaselines: {},
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
