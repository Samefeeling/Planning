/**
 * machine ↔ tool ↔ part routing constraints.
 *
 * The hard rule on the floor: a part can only run on a line that has a routing
 * for it. Planners may still drag a job onto an un-routed line (they sometimes
 * know about a new tool before the workbook does), so this surfaces a warning
 * rather than blocking the drop.
 */

import type { MachineId } from '@/domain/ids';
import type { Job, PlanWarning } from '@/domain/types';
import { isRoutable, machinesForPart, type RoutingIndex } from './routing';

/** A warning when a job sits on a line it isn't routed to, else null. */
export function routingWarning(
  job: Job,
  machine: MachineId,
  idx: RoutingIndex,
): PlanWarning | null {
  if (isRoutable(job.partNum, machine, idx)) return null;

  const allowed = machinesForPart(job.partNum, idx);
  if (allowed.length === 0) {
    return {
      jobId: job.id,
      severity: 'info',
      code: 'not-routable',
      message: `No routing on file for ${job.partNum}; cannot verify ${machine}.`,
    };
  }
  return {
    jobId: job.id,
    severity: 'warning',
    code: 'not-routable',
    message: `${job.partNum} is not routed to ${machine} (runs on: ${allowed.join(', ')}).`,
  };
}
