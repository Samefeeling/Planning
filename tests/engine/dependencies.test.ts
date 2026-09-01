/**
 * Turning material lines into an order-waits-for-order graph.
 *
 * The rule the shop floor works to: an order cannot start until every
 * component another open order is still making has been finished.
 */

import { describe, it, expect } from 'vitest';
import { JobId, PartId } from '@/domain/ids';
import type { Job, JobMaterialLink } from '@/domain/types';
import { buildDependencies } from '@/engine/assembly/dependencies';

/** An open order making `part`, optionally scheduled on `startDay`. */
const job = (
  id: string,
  part: string,
  over: Partial<Job> = {},
): Job => ({
  id: JobId(id),
  department: 'assembly',
  partNum: PartId(part),
  description: part,
  remainingQty: 10,
  qtyPerHr: null,
  laborHrs: 8,
  dueDate: null,
  startDate: null,
  reqBy: null,
  released: true,
  priority: 3,
  materialPrep: 'ready',
  tool: null,
  preferredMachine: null,
  orderType: null,
  line: null,
  shipDate: null,
  completedQty: 0,
  predecessors: [],
  assignedWorkers: [],
  ...over,
});

const link = (jobNum: string, parent: string, child: string): JobMaterialLink => ({
  jobNum: JobId(jobNum),
  parentPart: PartId(parent),
  childPart: PartId(child),
  requiredQty: 1,
});

/** `A→B` pairs, sorted, so an expectation reads as the graph itself. */
const edges = (g: ReturnType<typeof buildDependencies>): string[] =>
  [...g.byJob.values()]
    .flat()
    .map((d) => `${String(d.jobId)}→${String(d.onJobId)}`)
    .sort();

describe('buildDependencies', () => {
  it('makes the parent wait for the order that builds its component', () => {
    const jobs = [job('ASSY1', 'CHAIR'), job('UPL1', 'COVER')];
    const g = buildDependencies(jobs, [link('ASSY1', 'CHAIR', 'COVER')]);

    expect(edges(g)).toEqual(['ASSY1→UPL1']);
    expect(String(g.byJob.get('ASSY1')![0].part)).toBe('COVER');
  });

  it('waits for every component, not just the first', () => {
    const jobs = [
      job('ASSY1', 'CHAIR'),
      job('UPL1', 'COVER'),
      job('PMD1', 'SHELL'),
    ];
    const g = buildDependencies(jobs, [
      link('ASSY1', 'CHAIR', 'COVER'),
      link('ASSY1', 'CHAIR', 'SHELL'),
    ]);
    expect(edges(g)).toEqual(['ASSY1→PMD1', 'ASSY1→UPL1']);
  });

  it('crosses departments — a chair waits on a press', () => {
    const jobs = [
      job('ASSY1', 'CHAIR'),
      job('SFM1', 'SHELL', { department: 'moulding' }),
    ];
    const g = buildDependencies(jobs, [link('ASSY1', 'CHAIR', 'SHELL')]);
    expect(edges(g)).toEqual(['ASSY1→SFM1']);
  });

  it('chains through several stages', () => {
    const jobs = [
      job('CUT', 'FABRIC'),
      job('UPL', 'COVER'),
      job('ASSY', 'CHAIR'),
    ];
    const g = buildDependencies(jobs, [
      link('UPL', 'COVER', 'FABRIC'),
      link('ASSY', 'CHAIR', 'COVER'),
    ]);
    expect(edges(g)).toEqual(['ASSY→UPL', 'UPL→CUT']);
  });

  it('ignores a component nobody is making — it is bought or in stock', () => {
    const jobs = [job('ASSY1', 'TABLE')];
    const g = buildDependencies(jobs, [link('ASSY1', 'TABLE', 'MDF-TOP')]);
    expect(edges(g)).toEqual([]);
  });

  it('ignores a component whose order is already finished', () => {
    const jobs = [
      job('ASSY1', 'CHAIR'),
      job('PMD1', 'SHELL', { remainingQty: 0, completedQty: 100 }),
    ];
    const g = buildDependencies(jobs, [link('ASSY1', 'CHAIR', 'SHELL')]);
    expect(edges(g)).toEqual([]);
  });

  it('takes the earliest of several batches of the same part', () => {
    // Two runs of the same shell are open. The chair needs one lot of shells,
    // not both, so it waits for the run that comes first.
    const early = new Date(2026, 8, 10);
    const late = new Date(2026, 8, 24);
    const jobs = [
      job('ASSY1', 'CHAIR'),
      job('PMD-LATE', 'SHELL', { startDate: late }),
      job('PMD-EARLY', 'SHELL', { startDate: early }),
    ];
    const g = buildDependencies(jobs, [link('ASSY1', 'CHAIR', 'SHELL')]);
    expect(edges(g)).toEqual(['ASSY1→PMD-EARLY']);
  });

  it('breaks a tie on job number, so the same file always schedules the same', () => {
    const jobs = [job('ASSY1', 'CHAIR'), job('PMD-B', 'SHELL'), job('PMD-A', 'SHELL')];
    const g = buildDependencies(jobs, [link('ASSY1', 'CHAIR', 'SHELL')]);
    expect(edges(g)).toEqual(['ASSY1→PMD-A']);
  });

  it('keeps a predecessor named directly in the order export', () => {
    const jobs = [
      job('ASSY1', 'CHAIR', { predecessors: [JobId('UPL1')] }),
      job('UPL1', 'COVER'),
    ];
    const g = buildDependencies(jobs, []);
    expect(edges(g)).toEqual(['ASSY1→UPL1']);
    expect(g.byJob.get('ASSY1')![0].part).toBeNull();
  });

  it('does not list the same pair twice when both sources agree', () => {
    const jobs = [
      job('ASSY1', 'CHAIR', { predecessors: [JobId('UPL1')] }),
      job('UPL1', 'COVER'),
    ];
    const g = buildDependencies(jobs, [link('ASSY1', 'CHAIR', 'COVER')]);
    expect(edges(g)).toEqual(['ASSY1→UPL1']);
    // …and keeps the component, which only the material file knows.
    expect(String(g.byJob.get('ASSY1')![0].part)).toBe('COVER');
  });

  it('never makes an order wait for itself', () => {
    // A rework line where the job consumes its own part number.
    const jobs = [job('ASSY1', 'CHAIR')];
    const g = buildDependencies(jobs, [link('ASSY1', 'CHAIR', 'CHAIR')]);
    expect(edges(g)).toEqual([]);
  });

  it('skips a link for an order that is not open', () => {
    const jobs = [job('UPL1', 'COVER')];
    const g = buildDependencies(jobs, [link('GONE', 'CHAIR', 'COVER')]);
    expect(edges(g)).toEqual([]);
  });

  it('breaks a circular pair and says which one it dropped', () => {
    const jobs = [job('A', 'PA'), job('B', 'PB')];
    const g = buildDependencies(jobs, [
      link('A', 'PA', 'PB'),
      link('B', 'PB', 'PA'),
    ]);

    // One edge survives — waiting both ways is not a schedule.
    expect(edges(g)).toHaveLength(1);
    expect(g.warnings).toHaveLength(1);
    expect(g.warnings[0]).toMatch(/Circular material link/);
  });

  it('flags an order whose two exports disagree about the part it builds', () => {
    const jobs = [job('ASSY1', 'CHAIR'), job('UPL1', 'COVER')];
    const g = buildDependencies(jobs, [link('ASSY1', 'STOOL', 'COVER')]);

    // Still used: the job number is what matters, the part is a cross-check.
    expect(edges(g)).toEqual(['ASSY1→UPL1']);
    expect(g.warnings[0]).toMatch(/different part/);
    expect(g.warnings[0]).toMatch(/ASSY1/);
  });
});
