/**
 * End-to-end assembly Gantt over the real seed data: orders group under their
 * line, crew size drives bar length and Expect Date, booking output pulls the
 * Expect Date in, and predecessors push successors out.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MockSource } from '@/data/mock/MockSource';
import { buildIndexes } from '@/engine/indexes';
import { computeAssemblyGantt, type OrderRow } from '@/engine/assembly/board';
import { workerLoad } from '@/engine/assembly/workload';
import { remainingHours } from '@/engine/assembly/duration';
import { usePlanStore } from '@/store/planStore';
import { DEFAULT_HORIZON_DAYS, LINES } from '@/domain/assembly';
import type { PlanningDataset } from '@/domain/types';
import type {
  ActualStartRecord,
  ProductionEntry,
  ProgressBaseline,
} from '@/store/planStore';

let dataset: PlanningDataset;

beforeAll(async () => {
  const result = await new MockSource().loadAll();
  if (!result.ok) throw new Error(result.error);
  dataset = result.value;
});

const TODAY = new Date('2026-09-11T00:00:00');

function build(over: {
  orderWorkers?: Record<string, string[]>;
  orderStarts?: Record<string, string>;
  orderActualStarts?: Record<string, ActualStartRecord>;
  progress?: Record<string, { date: string; qty: number }[]>;
  progressBaselines?: Record<string, ProgressBaseline>;
  production?: Record<string, ProductionEntry[]>;
} = {}) {
  const indexes = buildIndexes(dataset);
  usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
  const state = usePlanStore.getState();
  return computeAssemblyGantt({
    dataset,
    indexes,
    containers: state.containers,
    orderWorkers: over.orderWorkers ?? state.orderWorkers,
    orderStarts: over.orderStarts ?? {},
    orderActualStarts: over.orderActualStarts ?? {},
    progress: over.progress ?? {},
    progressBaselines: over.progressBaselines ?? {},
    production: over.production ?? {},
    workers: dataset.workers,
    today: TODAY,
  });
}

describe('assembly Gantt (mock data)', () => {
  it('loads a roster and shows the four line groups in order', () => {
    const b = build();
    expect(dataset.workers.length).toBeGreaterThan(10);
    expect(b.groups.map((g) => g.line.key)).toEqual(
      LINES.map((l) => l.key),
    );
    // PMD is context only.
    expect(b.groups[0].line.schedulable).toBe(false);
  });

  it('puts every assembly order on a schedulable line or in the pool', () => {
    const b = build();
    const scheduled = b.groups
      .filter((g) => g.line.schedulable)
      .flatMap((g) => g.rows);
    const assemblyJobs = dataset.jobs.filter((j) => j.department === 'assembly');
    expect(assemblyJobs.length).toBeGreaterThan(10);
    expect(scheduled.length + b.pool.length).toBe(assemblyJobs.length);
    for (const g of b.groups) {
      if (!g.line.schedulable) continue;
      for (const r of g.rows) {
        expect(r.job.department).toBe('assembly');
        expect(String(r.line.id)).toBe(String(g.line.id));
      }
    }
  });

  it('only ever allocates at most four people to an order', () => {
    const b = build();
    for (const g of b.groups) {
      for (const r of g.rows) expect(r.workers.length).toBeLessThanOrEqual(4);
    }
  });

  it('shortens the bar and pulls in Expect Date when people are added', () => {
    const base = build();
    const row = base.groups
      .flatMap((g) => g.rows)
      .find((r) => r.line.schedulable && r.workers.length === 1);
    expect(row).toBeDefined();
    const id = String(row!.job.id);

    const more = build({
      orderWorkers: { ...usePlanStore.getState().orderWorkers, [id]: ['W01', 'W03', 'W12'] },
    });
    const after = more.rowsByJob.get(id)!;

    // Measured across the bar's own span, not against the calendar: people
    // already on other orders bring their commitments with them, so putting
    // them on this one can start it later even as it shortens the work.
    const span = (r: OrderRow): number =>
      r.expectDate!.getTime() - r.start!.getTime();
    expect(after.days!).toBeLessThan(row!.days!);
    expect(span(after)).toBeLessThan(span(row!));
  });

  it('never has anyone on two orders at the same time', () => {
    const b = build();
    const rows = b.groups
      .filter((g) => g.line.schedulable)
      .flatMap((g) => g.rows)
      .filter((r) => r.start && r.expectDate && !r.completedToday);
    expect(rows.length).toBeGreaterThan(10);

    const clashes: string[] = [];
    for (const a of rows) {
      for (const c of rows) {
        if (String(a.job.id) >= String(c.job.id)) continue;
        const shared = a.workers.filter((w) =>
          c.workers.some((other) => String(other.id) === String(w.id)),
        );
        if (!shared.length) continue;
        if (a.start! < c.expectDate! && c.start! < a.expectDate!) {
          clashes.push(
            `${String(a.job.id)} and ${String(c.job.id)} both have ` +
              shared.map((w) => w.name).join(', '),
          );
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('hands a crew straight on to their next order', () => {
    // Every order that follows another with the same people on it begins on
    // the next shift going, not days later — allowing for the weekend and for
    // the bar the crew is waiting on ending part-way through a day.
    const b = build();
    const rows = b.groups
      .filter((g) => g.line.schedulable)
      .flatMap((g) => g.rows)
      .filter((r) => r.start && r.expectDate);

    let handovers = 0;
    for (const row of rows) {
      // The order this crew finished last before starting this one.
      const previous = rows
        .filter(
          (other) =>
            other !== row &&
            other.expectDate! <= row.start! &&
            other.workers.some((w) =>
              row.workers.some((mine) => String(mine.id) === String(w.id)),
            ) &&
            // Only a crew this order kept whole — a team that splits up waits
            // for its slowest member, which is a gap with a reason.
            row.workers.every((mine) =>
              rows.some(
                (o) =>
                  o !== row &&
                  o.expectDate! <= row.start! &&
                  o.workers.some((w) => String(w.id) === String(mine.id)),
              ),
            ),
        )
        .sort((x, y) => y.expectDate!.getTime() - x.expectDate!.getTime())[0];
      if (!previous || row.waitingOn) continue;
      handovers++;
      const gapDays =
        (row.start!.getTime() - previous.expectDate!.getTime()) / 86_400_000;
      expect(gapDays).toBeLessThanOrEqual(3.01); // ≤ a rounded shift + a weekend
    }
    expect(handovers).toBeGreaterThan(0);
  });

  it('leaves an order unschedulable when nobody is on it', () => {
    const b = build({ orderWorkers: {} });
    const rows = b.groups.filter((g) => g.line.schedulable).flatMap((g) => g.rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.days === null && r.expectDate === null)).toBe(
      true,
    );
  });

  it('pulls the Expect Date in when output is booked', () => {
    const base = build();
    const row = base.groups
      .flatMap((g) => g.rows)
      .find((r) => r.line.schedulable && r.expectDate && r.job.remainingQty > 10);
    expect(row).toBeDefined();
    const id = String(row!.job.id);

    const booked = build({
      progress: { [id]: [{ date: '2026-09-11', qty: Math.floor(row!.job.remainingQty / 2) }] },
    });
    const after = booked.rowsByJob.get(id)!;

    expect(after.job.completedQty).toBeGreaterThan(row!.job.completedQty);
    expect(after.days!).toBeLessThan(row!.days!);
  });

  it('does not deduct a local booking twice after the source catches up', () => {
    const base = build();
    const row = [...base.rowsByJob.values()].find((candidate) => candidate.job.remainingQty > 10)!;
    const id = String(row.job.id);
    const qty = 5;
    const baseline = {
      remainingQty: row.sourceRemainingQty!,
      completedQty: row.sourceCompletedQty!,
    };
    const refreshed: PlanningDataset = {
      ...dataset,
      jobs: dataset.jobs.map((job) =>
        String(job.id) === id
          ? {
              ...job,
              remainingQty: job.remainingQty - qty,
              completedQty: job.completedQty + qty,
            }
          : job,
      ),
    };
    const state = usePlanStore.getState();
    const after = computeAssemblyGantt({
      dataset: refreshed,
      indexes: buildIndexes(refreshed),
      containers: state.containers,
      orderWorkers: state.orderWorkers,
      orderStarts: {},
      progress: { [id]: [{ date: '2026-09-11', qty }] },
      progressBaselines: { [id]: baseline },
      production: {},
      workers: refreshed.workers,
      today: TODAY,
    });

    expect(after.rowsByJob.get(id)!.job.remainingQty).toBe(
      baseline.remainingQty - qty,
    );
  });

  it('uses the confirmed actual start and ignores later planned dragging', () => {
    const base = build();
    const row = [...base.rowsByJob.values()].find((candidate) => candidate.workers.length > 0)!;
    const id = String(row.job.id);
    const actual: ActualStartRecord = {
      startedAt: '2026-09-11T03:15:00.000Z',
      overrideReason: null,
      operatorIds: row.workers.map((worker) => String(worker.id)),
      operatorNames: row.workers.map((worker) => worker.name),
    };
    const after = build({
      orderStarts: { [id]: '2026-09-25T00:00:00.000Z' },
      orderActualStarts: { [id]: actual },
    });
    expect(after.rowsByJob.get(id)!.actualStart).toEqual(actual);
    expect(after.rowsByJob.get(id)!.start).toEqual(TODAY);
  });

  it('greys a completed job today and removes it the following day', () => {
    const base = build();
    const row = [...base.rowsByJob.values()][0];
    const completed: ProductionEntry = {
      date: '2026-09-11',
      shiftOutput: 8,
      complete: 8,
      reject: 0,
      rework: 0,
      paused: false,
      pauseReason: null,
      jobCompleted: true,
      notes: '',
    };
    const today = build({ production: { [String(row.job.id)]: [completed] } });
    expect(today.rowsByJob.get(String(row.job.id))?.completedToday).toBe(true);
    expect(today.rowsByJob.get(String(row.job.id))?.status.color).toBe('grey');

    const tomorrow = computeAssemblyGantt({
      dataset,
      indexes: buildIndexes(dataset),
      containers: usePlanStore.getState().containers,
      orderWorkers: usePlanStore.getState().orderWorkers,
      orderStarts: {},
      progress: {},
      production: { [String(row.job.id)]: [completed] },
      workers: dataset.workers,
      today: new Date('2026-09-12T00:00:00'),
    });
    expect(tomorrow.jobsById.has(String(row.job.id))).toBe(false);
  });

  it('starts a successor only after every predecessor finishes', () => {
    const b = build();
    const rows = b.groups.flatMap((g) => g.rows);
    const byId = new Map(rows.map((r) => [String(r.job.id), r]));
    const withPred = [...b.rowsByJob.values()].filter(
      (r) => r.predecessors.length > 0,
    );
    expect(withPred.length).toBeGreaterThan(0);

    for (const row of withPred) {
      for (const dep of row.predecessors) {
        const pred = byId.get(String(dep.onJobId));
        if (!pred?.expectDate || !row.start) continue;
        expect(row.start.getTime()).toBeGreaterThanOrEqual(
          pred.expectDate.getTime(),
        );
      }
    }
  });

  it('carries a work load on every line group and on the board total', () => {
    const b = build();
    const summed = b.groups
      .filter((g) => g.line.schedulable)
      .reduce((s, g) => s + g.load.hours, 0);

    expect(summed).toBeGreaterThan(0);
    expect(summed).toBeCloseTo(b.totals.remainingHours, 6);

    for (const g of b.groups) {
      if (!g.line.schedulable || g.rows.length === 0) continue;
      expect(g.load.crew).toBeGreaterThan(0);
      // Days to clear the queue = hours ÷ what the crew delivers in a day.
      expect(g.load.daysOfWork).toBeCloseTo(
        g.load.hours / g.load.capacityPerDay,
        6,
      );
    }
  });

  it('books a person’s week against the orders they are actually on', () => {
    const b = build();
    const row = [...b.rowsByJob.values()].find((r) => r.workers.length > 0)!;
    const person = row.workers[0];
    const load = workerLoad(
      person,
      b.groups.flatMap((g) => g.rows),
      b.horizonStart,
    );

    expect(load.orderCount).toBeGreaterThan(0);
    expect(load.totalHours).toBeGreaterThan(0);
    // Nobody can be booked for more hours than the orders they are on hold.
    const theirs = [...b.rowsByJob.values()].filter((r) =>
      r.workers.some((w) => String(w.id) === String(person.id)),
    );
    const ceiling = theirs.reduce(
      (s, r) => s + remainingHours(r.job) / r.workers.length,
      0,
    );
    expect(load.totalHours).toBeLessThanOrEqual(ceiling + 1e-6);
  });

  it('colours every scheduled row and the totals add up', () => {
    const b = build();
    const rows = [...b.rowsByJob.values()];
    for (const r of rows) {
      expect(['green', 'orange', 'red', 'grey']).toContain(r.status.color);
    }
    expect(b.totals.green + b.totals.orange + b.totals.red).toBeLessThanOrEqual(
      b.totals.orders,
    );
    expect(b.totals.orders).toBe(rows.length);
  });
});

describe('the board the planner laid out', () => {
  it('keeps the rows where they were put when a bar is dragged out', () => {
    const before = build();
    const line = before.groups.find(
      (g) => g.line.schedulable && g.rows.length >= 2,
    )!;
    const ids = line.rows.map((r) => String(r.job.id));

    // Push the first order a fortnight out — far enough that sorting by date
    // would drop it to the bottom of its line.
    const after = build({
      orderStarts: { [ids[0]]: new Date('2026-09-25T00:00:00').toISOString() },
    });
    const moved = after.groups.find((g) => g.line.key === line.line.key)!;

    expect(moved.rows.map((r) => String(r.job.id))).toEqual(ids);
    // …and the bar really did move; it is the row that stayed put.
    expect(moved.rows[0].start!.getTime()).toBeGreaterThan(
      line.rows[0].start!.getTime(),
    );
  });

  it('still lets a bar dragged earlier take a build position first', () => {
    // Row order is the planner's; the queue is by date. An order pulled to the
    // front of the week gets the free position even from the bottom row.
    const before = build();
    const line = before.groups.find(
      (g) => g.line.schedulable && g.rows.length >= 3,
    )!;
    const last = String(line.rows.at(-1)!.job.id);

    const after = build({
      orderStarts: { [last]: new Date('2026-09-11T00:00:00').toISOString() },
    });
    const row = after.rowsByJob.get(last)!;
    expect(row.start!.getTime()).toBe(after.today.getTime());
  });
});

describe('yesterday, still on the board', () => {
  it('opens on the previous working day', () => {
    const b = build();
    // TODAY is Friday 11 Sep 2026, so the board opens on the Thursday.
    expect(b.today).toEqual(new Date('2026-09-11T00:00:00'));
    expect(b.horizonStart).toEqual(new Date('2026-09-10T00:00:00'));
  });

  it('plans nothing into a day that has already gone', () => {
    const b = build();
    for (const r of b.rowsByJob.values()) {
      if (!r.start) continue;
      expect(r.start.getTime()).toBeGreaterThanOrEqual(b.today.getTime());
    }
  });

  it('still shows the usual run of days ahead', () => {
    // The history column is extra, not taken out of the planning window.
    const b = build();
    expect(b.horizonDays).toBeGreaterThanOrEqual(DEFAULT_HORIZON_DAYS + 1);
  });

  it('carries the shift log on the row, valued in hours', () => {
    const base = build();
    const row = [...base.rowsByJob.values()].find(
      (r) => r.line.schedulable && r.job.remainingQty > 4,
    )!;
    const id = String(row.job.id);
    const qty = 2;

    const booked = build({ progress: { [id]: [{ date: '2026-09-10', qty }] } });
    const after = booked.rowsByJob.get(id)!;

    expect(after.booked).toHaveLength(1);
    expect(after.booked[0].day).toBe('2026-09-10');
    expect(after.booked[0].qty).toBe(qty);
    // Two units of an order worth `laborHrs` over its whole quantity.
    const total = row.job.remainingQty + row.job.completedQty;
    expect(after.booked[0].hours).toBeCloseTo((row.job.laborHrs / total) * qty, 6);
  });
});
