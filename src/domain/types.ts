/**
 * Domain model for the PMD production schedule.
 *
 * The shapes here mirror the master Epicor/SharePoint workbook
 * (`PMD_Schedule_master_epicor.xlsm`) but are decoupled from any sheet
 * layout — the `data/` adapter layer is responsible for mapping raw cells
 * onto these types. Everything below is plain data; behaviour lives in
 * `engine/`.
 */

import type {
  ColorId,
  InsertId,
  JobId,
  MachineId,
  PartId,
  ToolId,
} from './ids';

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

/** A production line (injection-moulding press, batt line, hand station…). */
export interface Machine {
  id: MachineId;
  /** Human label, e.g. "1300T" or "Batt1". */
  name: string;
  /** Optional press tonnage parsed from the name (1300T → 1300). */
  tonnage?: number;
  /** Display order on the board; lower is higher. */
  sortIndex: number;
}

/** Shift pattern controlling how many wall-clock hours a day a line runs. */
export interface ShiftPattern {
  /** Key used in the workbook, e.g. "3shift". */
  id: string;
  /** Running hours per calendar day (3shift → 24, 1shift → 8). */
  hoursPerDay: number;
}

/**
 * Routing / capability row: which machine can run a part, with which die,
 * colour and insert. Sourced from the `resource` sheet
 * (BNO → machine / die / Column1=colour / Column3=insert).
 */
export interface RoutingEntry {
  partNum: PartId;
  machine: MachineId;
  tool: ToolId | null; // die / mould
  color: ColorId | null;
  insert: InsertId | null;
  description: string;
}

// ---------------------------------------------------------------------------
// Demand / inventory / supply (material planning inputs)
// ---------------------------------------------------------------------------

/** On-hand balance for a part (finished good or raw material), from `ohb`. */
export interface InventoryItem {
  partNum: PartId;
  description: string;
  /** Epicor Part_TypeCode: "M" manufactured, "P" purchased, … */
  typeCode: string | null;
  onHand: number;
  cmplWip: number;
  supply: number;
  demand: number;
  /** Calculated free-on-hand = onHand + supply − demand (may be negative). */
  freeOnHand: number;
}

/** One BOM / material requirement line for a job, from `part req`. */
export interface BomLine {
  finishedPart: PartId;
  jobNum: JobId | null;
  componentPart: PartId;
  requiredQty: number;
  uom: string;
  dueDate: Date | null;
  outstandingQty: number;
}

/** An open purchase order receipt for a raw material, from `po`. */
export interface PoLine {
  partNum: PartId;
  poNum: string | null;
  /** Quantity still to be received. */
  outstandingQty: number;
  dueDate: Date | null;
  promiseDate: Date | null;
  buyer: string | null;
}

/** Period demand for a part, from `total req`. */
export interface DemandLine {
  partNum: PartId;
  reqDate: Date | null;
  reqQty: number;
}

// ---------------------------------------------------------------------------
// Production orders (jobs)
// ---------------------------------------------------------------------------

/**
 * A releasable production order — the thing a planner drags onto a line.
 * Combines `open jobs` (qty, standard) with the current `planning`
 * assignment (machine, die).
 */
export interface Job {
  id: JobId;
  partNum: PartId;
  description: string;
  /** Calculated_RemainingQty — units still to be produced. */
  remainingQty: number;
  /** Units per hour the part runs at on its line (planning `qty/hr`). */
  qtyPerHr: number | null;
  /**
   * Calculated_LaborHrs — total run time for the order. This is the bar
   * length on the Gantt. Derived from remainingQty / qtyPerHr when the
   * workbook does not carry it directly.
   */
  laborHrs: number;
  dueDate: Date | null;
  /** Material "required by" date (planning `Req. By`). */
  reqBy: Date | null;
  released: boolean;
  /** Die named on the current schedule, used as the changeover key. */
  tool: ToolId | null;
  /** Machine the workbook currently has it on (the planner can override). */
  preferredMachine: MachineId | null;
}

// ---------------------------------------------------------------------------
// The complete dataset the engine works over
// ---------------------------------------------------------------------------

export interface PlanningDataset {
  machines: Machine[];
  jobs: Job[];
  routing: RoutingEntry[];
  inventory: InventoryItem[];
  bom: BomLine[];
  po: PoLine[];
  demand: DemandLine[];
  /** When the source workbook was last refreshed. */
  fetchedAt: Date;
}

// ---------------------------------------------------------------------------
// Computed / derived (engine outputs) — see engine/*
// ---------------------------------------------------------------------------

export type ChangeoverKind = 'tool' | 'color' | 'insert';

/** Why and how long a changeover between two adjacent jobs takes. */
export interface ChangeoverInfo {
  required: boolean;
  kinds: ChangeoverKind[];
  /** Total setup minutes added before the job can run. */
  minutes: number;
  /** Short human summary, e.g. "D/C → Ned stool, colour purge". */
  summary: string;
  fromTool: ToolId | null;
  toTool: ToolId | null;
}

export type MaterialStatusLevel = 'ok' | 'short' | 'covered' | 'unknown';

/** Shortage detail for a single component of a job. */
export interface ComponentShortage {
  componentPart: PartId;
  description: string;
  requiredQty: number;
  freeOnHand: number;
  shortQty: number;
  /** Earliest PO date that clears the shortfall, if any. */
  coverageDate: Date | null;
  poNum: string | null;
}

/** Roll-up of material readiness for a whole job. */
export interface MaterialStatus {
  level: MaterialStatusLevel;
  /** Earliest date all components are available (null = ready now). */
  earliestStart: Date | null;
  shortages: ComponentShortage[];
}

/** Severity buckets for plan validation messages. */
export type WarningSeverity = 'error' | 'warning' | 'info';

export interface PlanWarning {
  jobId: JobId;
  severity: WarningSeverity;
  code:
    | 'not-routable'
    | 'material-short'
    | 'due-date-risk'
    | 'no-labor-hours'
    | 'unassigned';
  message: string;
}

/**
 * A job placed on the timeline of a specific machine — the unit the Gantt
 * renders. Produced by `store/selectors` from the plan + engine.
 */
export interface ScheduledJob {
  job: Job;
  machine: MachineId;
  /** Zero-based position within the lane. */
  index: number;
  /** Wall-clock window the bar occupies. */
  start: Date;
  end: Date;
  /** Run time (hours) excluding setup — the productive part of the bar. */
  runHours: number;
  changeover: ChangeoverInfo;
  material: MaterialStatus;
  /** Routing chosen for this (part, machine), if one exists. */
  routing: RoutingEntry | null;
  warnings: PlanWarning[];
}
