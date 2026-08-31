/**
 * Production orders from `Planning1.csv` — the Epicor BAQ export that feeds
 * both the PMD row and the assembly lines.
 *
 * Sample (headers abbreviated):
 *   JobNum      PartNum   PartDescription  Line  ProdQty  RemainingQty  ...
 *   SFM507615   7911FR    Encore           PMD   34       34
 *   018140-1-1  CSSL0143  Cosmic Stool     ASSY  30       30
 *
 * Columns are matched **by header name**, not position: the BAQ is edited from
 * time to time and column order is not something we control. `mapHeaders`
 * ignores the `JobHead_` / `JobOper_` / `Calculated_` prefixes, so both the raw
 * export and a hand-tidied file parse the same way.
 *
 * Derivations the export leaves implicit:
 *   laborHrs    = RemainingQty x ProdStandard   (hours per unit)
 *   qtyPerHr    = 1 / ProdStandard
 *   completedQty = ProdQty - RemainingQty
 */

import { JobId, MachineId, PartId, WorkCenterId } from '@/domain/ids';
import type { Department, Job } from '@/domain/types';
import {
  LINE_BY_ID,
  type MaterialPrepStatus,
  type OrderType,
} from '@/domain/assembly';
import { isVisibleMachine } from '@/domain/constants';
import { mapHeaders, parseCsv, type CsvRow } from '@/lib/csv';
import type { ParseOutcome } from '@/data/excel/parsers/types';

type Field =
  | 'jobNum'
  | 'partNum'
  | 'description'
  | 'line'
  | 'prodQty'
  | 'remainingQty'
  | 'startDate'
  | 'dueDate'
  | 'laborHrs'
  | 'prodStandard'
  | 'shipDate'
  | 'orderType'
  | 'completedQty'
  | 'predecessor'
  | 'materialPrep'
  | 'released'
  | 'priority';

/**
 * Accepted header spellings per field, most-specific first. Prefixes are
 * stripped before matching, so `JobHead_ReqDueDate` matches `ReqDueDate`.
 */
const ALIASES: Record<Field, readonly string[]> = {
  jobNum: ['JobNum', 'Job'],
  partNum: ['PartNum', 'Part'],
  description: ['PartDescription', 'Description', 'PartDesc'],
  // The PMD / ASSY column. Which table it comes from varies by BAQ, so several
  // spellings are accepted — and if none matches, `findLineColumn` finds it by
  // looking at the values.
  line: [
    'Line',
    'Department',
    'Dept',
    'ResourceGrpID',
    'ResourceGroup',
    'ProdTeamID',
    'WorkCenter',
    'Area',
    'Plant',
  ],
  prodQty: ['ProdQty', 'Qty', 'OrderQty'],
  remainingQty: ['RemainingQty', 'QtyRemaining'],
  startDate: ['StartDate', 'SchedStartDate'],
  dueDate: ['ReqDueDate', 'DueDate'],
  laborHrs: ['LaborHrs', 'ProdHours', 'TotalHours'],
  prodStandard: ['ProdStandard', 'EstProdHours', 'HoursPerPiece'],
  // Not in today's export — read if they get added (see README).
  shipDate: ['ShipDate', 'PromiseDate'],
  orderType: ['OrderType', 'WorkOrderType', 'OpCode'],
  completedQty: ['QtyCompleted', 'CompletedQty'],
  predecessor: ['Predecessor', 'PredecessorJob', 'ParentJobNum'],
  materialPrep: ['MaterialPrep', 'MaterialStatus', 'KitStatus'],
  released: ['JobReleased', 'Released'],
  priority: ['Priority'],
};

const ORDER_TYPES: Record<string, OrderType> = {
  'cutting/sewing': 'cutting-sewing',
  'cutting-sewing': 'cutting-sewing',
  cuttingsewing: 'cutting-sewing',
  'cut & sew': 'cutting-sewing',
  upholstery: 'upholstery',
  uph: 'upholstery',
  'final assembly': 'final-assembly',
  'final-assembly': 'final-assembly',
  finalassembly: 'final-assembly',
};

const PREP_VALUES = new Set<MaterialPrepStatus>([
  'not-prepared',
  'preparing',
  'ready',
  'shortage',
]);

const cell = (row: CsvRow, at: number | undefined): string =>
  at === undefined ? '' : (row[at] ?? '').trim();

const num = (v: string): number | null => {
  if (v === '') return null;
  const n = Number(v.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const date = (v: string): Date | null => {
  if (v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Which line/department a row belongs to. `PMD` and the moulding press names
 * are moulding; `UPL` / `ASSY` / `TABLE` are the assembly lines.
 */
function readPlacement(raw: string): {
  department: Department;
  line: Job['line'];
  preferredMachine: Job['preferredMachine'];
} | null {
  if (raw === '') return null;
  const id = WorkCenterId(raw);
  const known = LINE_BY_ID.get(String(id));

  if (known) {
    return known.key === 'PMD'
      ? { department: 'moulding', line: null, preferredMachine: MachineId(raw) }
      : { department: 'assembly', line: id, preferredMachine: null };
  }
  // A named press (1300T, BATT1, …) — still a moulding row.
  if (isVisibleMachine(String(id))) {
    return { department: 'moulding', line: null, preferredMachine: id };
  }
  return null;
}

/**
 * Fallback when no header matches: the line column is the one whose values are
 * (almost) all recognisable lines. Leftmost wins.
 */
function findLineColumn(rows: CsvRow[], width: number): number | undefined {
  const sample = rows.slice(0, 200);
  for (let col = 0; col < width; col++) {
    let filled = 0;
    let hits = 0;
    for (const row of sample) {
      const v = (row[col] ?? '').trim();
      if (v === '') continue;
      filled++;
      if (readPlacement(v)) hits++;
    }
    if (filled >= 1 && hits / filled >= 0.8) return col;
  }
  return undefined;
}

/**
 * The work-order type. The export does not carry one yet, so it is inferred
 * from the line where that is unambiguous: ASSY and TABLE only ever run final
 * assembly. UPL runs both cutting/sewing and upholstery, so it stays blank
 * until the column exists.
 */
function readOrderType(raw: string, line: Job['line']): OrderType | null {
  const explicit = ORDER_TYPES[raw.trim().toLowerCase()];
  if (explicit) return explicit;
  const def = line ? LINE_BY_ID.get(String(line)) : undefined;
  return def && def.types.length === 1 ? def.types[0] : null;
}

function readPrep(raw: string): MaterialPrepStatus {
  const p = raw.trim().toLowerCase().replace(/\s+/g, '-') as MaterialPrepStatus;
  return PREP_VALUES.has(p) ? p : 'ready';
}

/** Parse the text of `Planning1.csv` into production orders. */
export function parsePlanningCsv(text: string): ParseOutcome<Job> {
  const rows = parseCsv(text);
  if (rows.length === 0) return { values: [], errors: ['Planning1.csv is empty'] };

  const header = rows[0];
  const body = rows.slice(1);
  const col = mapHeaders<Field>(header, ALIASES);
  col.line ??= findLineColumn(body, header.length);

  const errors: string[] = [];
  const missing = (['jobNum', 'partNum'] as const).filter(
    (f) => col[f] === undefined,
  );
  if (missing.length > 0) {
    return {
      values: [],
      errors: [
        `Planning1.csv: no column for ${missing.join(', ')}. ` +
          `Headers found: ${header.join(', ')}`,
      ],
    };
  }
  if (col.line === undefined) {
    errors.push(
      'Planning1.csv: no PMD/ASSY column recognised — every order lands in ' +
        'the pool. Add a Department column or tell the parser its name.',
    );
  }

  const values: Job[] = [];
  const seen = new Set<string>();

  body.forEach((row, i) => {
    const jobNum = cell(row, col.jobNum);
    const partNum = cell(row, col.partNum);
    if (!jobNum || !partNum) return; // spacer / totals row
    if (seen.has(jobNum)) return; // first occurrence wins
    seen.add(jobNum);

    const placement = readPlacement(cell(row, col.line));
    const prodQty = num(cell(row, col.prodQty));
    const remainingQty =
      num(cell(row, col.remainingQty)) ?? prodQty ?? 0;
    const prodStandard = num(cell(row, col.prodStandard));
    const laborHrs =
      num(cell(row, col.laborHrs)) ??
      (prodStandard !== null ? remainingQty * prodStandard : 0);

    if (laborHrs <= 0) {
      errors.push(`Planning1.csv row ${i + 2} (${jobNum}): no labour hours`);
    }

    const line = placement?.line ?? null;
    const explicitDone = num(cell(row, col.completedQty));
    const predecessor = cell(row, col.predecessor);
    const releasedRaw = cell(row, col.released).toLowerCase();

    values.push({
      id: JobId(jobNum),
      department: placement?.department ?? 'assembly',
      partNum: PartId(partNum),
      description: cell(row, col.description),
      remainingQty,
      qtyPerHr: prodStandard && prodStandard > 0 ? 1 / prodStandard : null,
      laborHrs,
      dueDate: date(cell(row, col.dueDate)),
      startDate: date(cell(row, col.startDate)),
      // Material has to be at the line when the order starts.
      reqBy: date(cell(row, col.startDate)),
      released:
        releasedRaw === ''
          ? true
          : ['true', 'yes', 'y', '1'].includes(releasedRaw),
      priority: num(cell(row, col.priority)) ?? 3,
      materialPrep: readPrep(cell(row, col.materialPrep)),
      tool: null,
      preferredMachine: placement?.preferredMachine ?? null,
      orderType: readOrderType(cell(row, col.orderType), line),
      line,
      shipDate: date(cell(row, col.shipDate)),
      completedQty:
        explicitDone ??
        (prodQty !== null ? Math.max(0, prodQty - remainingQty) : 0),
      predecessor: predecessor ? JobId(predecessor) : null,
      assignedWorkers: [],
    });
  });

  return { values, errors };
}
