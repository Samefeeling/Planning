/**
 * Which order has to wait for which.
 *
 * `JobMaterialReq.csv` says what each order consumes, one component per row.
 * A component nobody is making is bought or already in stock and constrains
 * nothing; a component another open order is still building is the real
 * constraint, and that is the edge this module produces:
 *
 *   ASM80010 consumes PDSC00747U → ASM8002 builds PDSC00747U → ASM80010 waits
 *
 * The chain runs across departments, so a chair on ASSY can be held up by a
 * cover on UPL and a shell on a moulding press. Anything named directly in the
 * order export's `Predecessor` column is merged in on top.
 *
 * Pure. No React, no store.
 */

import type { JobId, PartId } from '@/domain/ids';
import type { Job, JobMaterialLink } from '@/domain/types';

/** One order waiting on another, and why. */
export interface Dependency {
  /** The order that has to wait. */
  jobId: JobId;
  /** The order it waits for. */
  onJobId: JobId;
  /** Component the wait is for; null when the export named the order itself. */
  part: PartId | null;
}

export interface DependencyGraph {
  /** Consuming job id → everything it waits on. */
  byJob: Map<string, Dependency[]>;
  /** Links that had to be dropped, in words the planner can act on. */
  warnings: string[];
}

/**
 * When an order is scheduled to run, for picking between batches of the same
 * part. Orders with no date at all sort last rather than first — an undated
 * order is not evidence that it will be ready sooner.
 */
const scheduledAt = (job: Job): number =>
  (job.startDate ?? job.dueDate)?.getTime() ?? Number.POSITIVE_INFINITY;

/**
 * Which open order supplies a part.
 *
 * Several batches of one part may be open at once. The consumer waits for the
 * one scheduled first — the earliest supply it could take — rather than for
 * all of them: a second run of the same shell booked for next month says
 * nothing about the chair being built this week. Ties break on job number so
 * the same export always yields the same schedule.
 */
function suppliersByPart(jobs: Job[]): Map<string, Job> {
  const out = new Map<string, Job>();
  for (const job of jobs) {
    // A finished order is not a constraint; its parts already exist.
    if (job.remainingQty <= 0) continue;
    const key = String(job.partNum);
    const held = out.get(key);
    if (
      !held ||
      scheduledAt(job) < scheduledAt(held) ||
      (scheduledAt(job) === scheduledAt(held) && String(job.id) < String(held.id))
    ) {
      out.set(key, job);
    }
  }
  return out;
}

/**
 * Drop the links that would make an order wait, however indirectly, on itself.
 *
 * A cycle is bad data — two orders each listing the other's part — and left in
 * place it would quietly cost one of them its constraint anyway. Breaking it
 * here does the same thing deliberately, in a fixed order, and says so.
 */
function breakCycles(byJob: Map<string, Dependency[]>, warnings: string[]): void {
  type Mark = 'open' | 'done';
  const mark = new Map<string, Mark>();

  const visit = (id: string, path: string[]): void => {
    if (mark.get(id) === 'done') return;
    mark.set(id, 'open');

    const deps = byJob.get(id) ?? [];
    const kept: Dependency[] = [];
    for (const dep of deps) {
      const on = String(dep.onJobId);
      if (mark.get(on) === 'open') {
        warnings.push(
          `Circular material link ignored: ${[...path, id, on].join(' → ')}`,
        );
        continue;
      }
      visit(on, [...path, id]);
      kept.push(dep);
    }
    if (kept.length !== deps.length) byJob.set(id, kept);
    mark.set(id, 'done');
  };

  // Sorted, so a file with a cycle in it breaks the same way every load.
  for (const id of [...byJob.keys()].sort()) visit(id, []);
}

/**
 * Build the wait-for graph over `jobs` from the material links.
 *
 * `jobs` should be every open order across both departments — the supplier of
 * a moulded component sits on a press, not on an assembly line.
 */
export function buildDependencies(
  jobs: Job[],
  links: readonly JobMaterialLink[],
): DependencyGraph {
  const byId = new Map(jobs.map((j) => [String(j.id), j]));
  const supplier = suppliersByPart(jobs);
  const byJob = new Map<string, Dependency[]>();
  const warnings: string[] = [];
  const seen = new Set<string>();

  const add = (jobId: JobId, onJobId: JobId, part: PartId | null): void => {
    const key = `${String(jobId)} ${String(onJobId)}`;
    const list = byJob.get(String(jobId));
    if (seen.has(key)) {
      // Both exports describe this pair. One edge is right, but take the part
      // from whichever source knows it: "waits on ASM8001 for PDSC00747" tells
      // the supervisor more than "waits on ASM8001".
      const held = list?.find((d) => String(d.onJobId) === String(onJobId));
      if (held && !held.part && part) held.part = part;
      return;
    }
    seen.add(key);
    if (list) list.push({ jobId, onJobId, part });
    else byJob.set(String(jobId), [{ jobId, onJobId, part }]);
  };

  // The order export's own column first, so an explicitly named predecessor
  // survives even when the material file says nothing about the pair.
  for (const job of jobs) {
    for (const pred of job.predecessors) {
      if (String(pred) !== String(job.id) && byId.has(String(pred))) {
        add(job.id, pred, null);
      }
    }
  }

  const mismatched = new Set<string>();
  for (const link of links) {
    const consumer = byId.get(String(link.jobNum));
    // A link for an order that is not open — already closed, or a department
    // this board does not plan. Nothing to hold up.
    if (!consumer) continue;
    if (
      String(link.parentPart) &&
      String(link.parentPart) !== String(consumer.partNum)
    ) {
      mismatched.add(String(link.jobNum));
    }

    const made = supplier.get(String(link.childPart));
    if (!made) continue; // bought in, or already on the shelf
    if (String(made.id) === String(consumer.id)) continue; // makes its own part
    add(consumer.id, made.id, link.childPart);
  }

  if (mismatched.size > 0) {
    const shown = [...mismatched].sort().slice(0, 3).join(', ');
    warnings.push(
      `JobMaterialReq.csv names a different part than Planning1.csv for ` +
        `${mismatched.size} order${mismatched.size === 1 ? '' : 's'} ` +
        `(${shown}${mismatched.size > 3 ? ', …' : ''}) — the links were still used.`,
    );
  }

  breakCycles(byJob, warnings);
  return { byJob, warnings };
}
