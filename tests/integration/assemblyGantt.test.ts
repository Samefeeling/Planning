/**
 * End-to-end assembly Gantt over the real seed data: orders group under their
 * line, crew size drives bar length and Expect Date, booking output pulls the
 * Expect Date in, and predecessors push successors out.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MockSource } from '@/data/mock/MockSource';
import { buildIndexes } from '@/engine/indexes';
import { computeAssemblyGantt } from '@/engine/assembly/board';
import { workerLoad } from '@/engine/assembly/workload';
import { remainingHours } from '@/engine/assembly/duration';
import { usePlanStore } from '@/store/planStore';
import { LINES } from '@/domain/assembly';
import type { PlanningDataset } from '@/domain/types';
import type { ProductionEntry } from '@/store/planStore';

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
  progress?: Record<string, { date: string; qty: number }[]>;
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
    progress: over.progress ?? {},
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

    expect(after.days!).toBeLessThan(row!.days!);
    expect(after.expectDate!.getTime()).toBeLessThan(
      row!.expectDate!.getTime(),
    );
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
