/**
 * Post-placement validation → a list of warnings for a scheduled job.
 *
 * Pulls together the cross-cutting checks the board surfaces as badges and in
 * the inspector: missing labour hours, material shortfalls, and due-date risk.
 * Routing warnings come from `constraints.ts`; this composes everything.
 */

import type { Job, MaterialStatus, PlanWarning } from '@/domain/types';
import { DUE_DATE_RISK_DAYS } from '@/domain/constants';
import { MS_PER_DAY } from '@/lib/time';

export function laborWarning(job: Job): PlanWarning | null {
  if (job.laborHrs > 0) return null;
  return {
    jobId: job.id,
    severity: 'warning',
    code: 'no-labor-hours',
    message: `${job.id} has no labour hours; bar length is unknown.`,
  };
}

export function materialWarning(
  job: Job,
  status: MaterialStatus,
): PlanWarning | null {
  if (status.level === 'ok' || status.level === 'unknown') return null;
  if (status.level === 'short') {
    return {
      jobId: job.id,
      severity: 'error',
      code: 'material-short',
      message: `Material short with no incoming PO: ${status.shortages
        .map((s) => s.componentPart)
        .join(', ')}.`,
    };
  }
  // covered: a PO clears the shortfall on a known date
  const when = status.earliestStart
    ? status.earliestStart.toLocaleDateString()
    : 'a future PO';
  return {
    jobId: job.id,
    severity: 'warning',
    code: 'material-short',
    message: `Material short; earliest start ${when} once POs arrive.`,
  };
}

export function dueDateWarning(
  job: Job,
  end: Date,
  now: Date,
): PlanWarning | null {
  if (!job.dueDate) return null;
  if (end > job.dueDate) {
    return {
      jobId: job.id,
      severity: 'error',
      code: 'due-date-risk',
      message: `Finishes ${end.toLocaleDateString()}, after due ${job.dueDate.toLocaleDateString()}.`,
    };
  }
  const slackDays = (job.dueDate.getTime() - now.getTime()) / MS_PER_DAY;
  if (slackDays <= DUE_DATE_RISK_DAYS) {
    return {
      jobId: job.id,
      severity: 'warning',
      code: 'due-date-risk',
      message: `Due ${job.dueDate.toLocaleDateString()} — little slack.`,
    };
  }
  return null;
}

/** All non-routing warnings for a placed job. */
export function computeWarnings(args: {
  job: Job;
  material: MaterialStatus;
  end: Date;
  now: Date;
}): PlanWarning[] {
  const out: PlanWarning[] = [];
  const labor = laborWarning(args.job);
  if (labor) out.push(labor);
  const mat = materialWarning(args.job, args.material);
  if (mat) out.push(mat);
  const due = dueDateWarning(args.job, args.end, args.now);
  if (due) out.push(due);
  return out;
}
