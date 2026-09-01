/**
 * How a line places its orders in time.
 *
 * A line has three build positions, so three orders run side by side and a
 * fourth waits for the first to clear. Within that, an order keeps the day it
 * was dragged to — which is what makes every bar movable rather than only the
 * first on the line. Bars step over Saturday and Sunday unless the supervisor
 * has approved overtime, and nothing here ever touches a Due Date.
 */

import { describe, it, expect } from 'vitest';
import { computeAssemblyGantt } from '@/engine/assembly/board';
import { buildIndexes } from '@/engine/indexes';
import { JobId, PartId, WorkCenterId, WorkerId } from '@/domain/ids';
import {
  LINES,
  PARALLEL_ORDERS_PER_LINE,
  PRODUCTIVE_HOURS_PER_PERSON,
  type Worker,
} from '@/domain/assembly';
import { isWeekend } from '@/engine/assembly/dates';
import type { Job, PlanningDataset } from '@/domain/types';

const UPL = LINES.find((l) => l.key === 'UPL')!;

/** Thursday 10 Sep 2026 — two working days before the weekend. */
const THU = new Date(2026, 8, 10);
const day = (n: number) => new Date(2026, 8, n);

const worker = (id: string): Worker => ({
  id: WorkerId(id),
  name: id,
  skills: ['UPL'],
  onShift: true,
});

/** An order needing exactly `days` of work from one person. */
const job = (id: string, days: number, over: Partial<Job> = {}): Job => ({
  id: JobId(id),
  department: 'assembly',
  partNum: PartId('P1'),
  description: `order ${id}`,
  remainingQty: 10,
  qtyPerHr: null,
  laborHrs: days * PRODUCTIVE_HOURS_PER_PERSON,
  dueDate: day(30),
  startDate: null,
  reqBy: null,
  released: true,
  priority: 3,
  materialPrep: 'ready',
  tool: null,
  preferredMachine: null,
  orderType: 'upholstery',
  line: UPL.id,
  shipDate: null,
  completedQty: 0,
  predecessor: null,
  assignedWorkers: [],
  ...over,
});

function board(
  jobs: Job[],
  over: {
    orderStarts?: Record<string, string>;
    orderOvertime?: Record<string, boolean>;
    today?: Date;
  } = {},
) {
  const workers = jobs.map((_, i) => worker(`W${i}`));
  const dataset: PlanningDataset = {
    workCenters: [
      {
        id: WorkCenterId(String(UPL.id)),
        kind: 'area',
        name: 'UPL',
        department: 'assembly',
        sortIndex: 1,
      },
    ],
    jobs,
    routing: [],
    inventory: [],
    bom: [],
    po: [],
    demand: [],
    workers,
    fetchedAt: THU,
  };

  return computeAssemblyGantt({
    dataset,
    indexes: buildIndexes(dataset),
    containers: { [String(UPL.id)]: jobs.map((j) => j.id) },
    // One person each, so a bar is exactly as long as the order's days.
    orderWorkers: Object.fromEntries(
      jobs.map((j, i) => [String(j.id), [`W${i}`]]),
    ),
    orderStarts: over.orderStarts ?? {},
    orderOvertime: over.orderOvertime ?? {},
    progress: {},
    production: {},
    workers,
    today: over.today ?? THU,
  });
}

describe('parallel build positions', () => {
  it('runs three orders side by side rather than queueing them', () => {
    const b = board([job('A', 1), job('B', 1), job('C', 1)]);
    const rows = ['A', 'B', 'C'].map((id) => b.rowsByJob.get(id)!);

    for (const row of rows) expect(row.start).toEqual(THU);
    // Each took a different position on the line.
    expect(new Set(rows.map((r) => r.slot)).size).toBe(
      PARALLEL_ORDERS_PER_LINE,
    );
  });

  it('queues the fourth order behind whichever position frees first', () => {
    // A finishes after one day, B and C after two — so D follows A.
    const b = board([job('A', 1), job('B', 2), job('C', 2), job('D', 1)]);
    const a = b.rowsByJob.get('A')!;
    const d = b.rowsByJob.get('D')!;

    expect(d.start).toEqual(a.expectDate);
    expect(d.slot).toBe(a.slot);
  });

  it('keeps the day an order was dragged to while a position is free', () => {
    const b = board([job('A', 1), job('B', 1)], {
      orderStarts: { B: day(16).toISOString() },
    });
    expect(b.rowsByJob.get('A')!.start).toEqual(THU);
    expect(b.rowsByJob.get('B')!.start).toEqual(day(16));
  });

  it('moves any order on the line, not only the first', () => {
    // Four orders, so one is genuinely queued; dragging the last one earlier
    // used to be ignored, because the line had a single moving cursor and a
    // start before it simply lost.
    const jobs = [job('A', 2), job('B', 2), job('C', 2), job('D', 2)];
    const before = board(jobs);
    expect(before.rowsByJob.get('D')!.start).toEqual(day(14)); // queued to Mon

    const after = board(jobs, { orderStarts: { D: day(11).toISOString() } });
    expect(after.rowsByJob.get('D')!.start).toEqual(day(11));
    // The three it joined stay where they were: a drag over-commits the line
    // rather than shuffling everyone else around behind the planner's back.
    for (const id of ['A', 'B', 'C']) {
      expect(after.rowsByJob.get(id)!.start).toEqual(THU);
    }
  });

  it('leaves the queue behind a pinned order intact', () => {
    // E is not dragged, so it still waits for a position — and the position D
    // was pinned over does not come free early just because D sits on it.
    const jobs = [
      job('A', 2),
      job('B', 2),
      job('C', 2),
      job('D', 4),
      job('E', 1),
    ];
    const b = board(jobs, { orderStarts: { D: day(11).toISOString() } });

    expect(b.rowsByJob.get('D')!.start).toEqual(day(11));
    // A, B and C free their positions on Monday; E takes the first of them.
    expect(b.rowsByJob.get('E')!.start).toEqual(day(14));
  });

  it('starts a bar the day Epicor scheduled it when nothing was dragged', () => {
    const b = board([job('A', 1, { startDate: new Date(2026, 8, 16, 7, 30) })]);
    // The hour is Epicor's; the board plans in whole days.
    expect(b.rowsByJob.get('A')!.start).toEqual(day(16));
  });

  it('never starts before the board opens, however old the export is', () => {
    const b = board([job('A', 1, { startDate: day(1) })]);
    expect(b.rowsByJob.get('A')!.start).toEqual(THU);
  });
});

describe('the closed weekend', () => {
  it('steps a bar over Saturday and Sunday', () => {
    // Three days from Thursday: Thu, Fri, then Monday.
    const b = board([job('A', 3)]);
    const row = b.rowsByJob.get('A')!;
    expect(row.start).toEqual(THU);
    expect(row.expectDate).toEqual(day(15));
    expect(row.overtime).toBe(false);
  });

  it('pushes a start pinned to a weekend on to the Monday', () => {
    const b = board([job('A', 1)], {
      orderStarts: { A: day(12).toISOString() }, // Saturday
    });
    const start = b.rowsByJob.get('A')!.start!;
    expect(isWeekend(start)).toBe(false);
    expect(start).toEqual(day(14));
  });

  it('honours a weekend once the supervisor approves overtime', () => {
    const b = board([job('A', 2)], {
      orderStarts: { A: day(12).toISOString() },
      orderOvertime: { A: true },
    });
    const row = b.rowsByJob.get('A')!;
    expect(row.start).toEqual(day(12)); // Saturday, as dropped
    expect(row.expectDate).toEqual(day(14)); // straight through Sunday
    expect(row.overtime).toBe(true);
  });

  it('turns red when the weekend pushes the finish past the due date', () => {
    // Two days of work from Friday would finish Saturday if the factory ran;
    // it does not, so the order lands on Tuesday and misses a Monday due date.
    const jobs = [job('A', 2, { dueDate: day(14) })];
    const b = board(jobs, { orderStarts: { A: day(11).toISOString() } });
    const row = b.rowsByJob.get('A')!;

    expect(row.expectDate).toEqual(day(15));
    expect(row.status.color).toBe('red');
    // The commitment itself is untouched — only the expectation moved.
    expect(row.job.dueDate).toEqual(day(14));
  });
});
