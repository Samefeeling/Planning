/**
 * Production orders from the `planning` sheet — the rows a planner drags onto
 * the board. Each row already carries the current machine, die and run rate.
 *
 * Column map (0-based):
 *   0 machine | 2 qty/hr | 3 Due Date | 4 JobHead_JobNum | 5 JobHead_PartNum
 *   6 PartDescription | 7 Calculated_RemainingQty | 8 JobReleased
 *   10 Req. By | 13 Prod Hours | 14 Die
 */

import { JobId, MachineId, PartId, ToolId } from '@/domain/ids';
import type { Job } from '@/domain/types';
import { asBool, asDate, asNum, asStr, dataRows, type Sheet } from './cell';
import type { ParseOutcome } from './types';

const C = {
  machine: 0,
  qtyPerHr: 2,
  dueDate: 3,
  jobNum: 4,
  partNum: 5,
  description: 6,
  remainingQty: 7,
  released: 8,
  reqBy: 10,
  prodHours: 13,
  die: 14,
} as const;

export function parseJobs(planning: Sheet): ParseOutcome<Job> {
  const values: Job[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  dataRows(planning).forEach((row, i) => {
    const jobNum = asStr(row[C.jobNum]);
    const partNum = asStr(row[C.partNum]);
    if (!jobNum || !partNum) return; // spacer / summary row
    if (seen.has(jobNum)) return; // first occurrence wins
    seen.add(jobNum);

    const remainingQty = asNum(row[C.remainingQty]) ?? 0;
    const qtyPerHr = asNum(row[C.qtyPerHr]);
    const prodHours = asNum(row[C.prodHours]);
    const laborHrs =
      prodHours ?? (qtyPerHr && qtyPerHr > 0 ? remainingQty / qtyPerHr : 0);

    if (laborHrs <= 0) {
      errors.push(`planning row ${i + 2} (${jobNum}): no labour hours`);
    }

    const machineRaw = asStr(row[C.machine]);
    const dieRaw = asStr(row[C.die]);

    values.push({
      id: JobId(jobNum),
      partNum: PartId(partNum),
      description: asStr(row[C.description]) ?? '',
      remainingQty,
      qtyPerHr: qtyPerHr ?? null,
      laborHrs,
      dueDate: asDate(row[C.dueDate]),
      reqBy: asDate(row[C.reqBy]),
      released: asBool(row[C.released]),
      tool: dieRaw ? ToolId(dieRaw) : null,
      preferredMachine: machineRaw ? MachineId(machineRaw) : null,
    });
  });

  return { values, errors };
}
