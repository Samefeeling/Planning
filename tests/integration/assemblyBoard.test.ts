/**
 * End-to-end assembly board over the real seed data: assembly orders land in
 * the area their route stage runs in, material shortages propagate from the
 * moulded components, and area load reflects the crew.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MockSource } from '@/data/mock/MockSource';
import { buildIndexes } from '@/engine/indexes';
import { computeAssemblyBoard } from '@/engine/assembly/board';
import { usePlanStore } from '@/store/planStore';
import { AREAS } from '@/domain/assembly';
import type { PlanningDataset } from '@/domain/types';

let dataset: PlanningDataset;

beforeAll(async () => {
  const result = await new MockSource().loadAll();
  if (!result.ok) throw new Error(result.error);
  dataset = result.value;
});

const board = (headcounts: Record<string, number> = {}) => {
  const indexes = buildIndexes(dataset);
  usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
  return computeAssemblyBoard(
    dataset,
    indexes,
    usePlanStore.getState().containers,
    headcounts,
    dataset.fetchedAt,
  );
};

describe('assembly board (mock data)', () => {
  it('exposes exactly the four areas', () => {
    const b = board();
    expect(b.columns.map((c) => String(c.area.id))).toEqual(
      AREAS.map((a) => String(a.id)),
    );
  });

  it('accounts for every assembly order and shows no moulding jobs', () => {
    const b = board();
    const placed = b.columns.reduce((n, c) => n + c.orders.length, 0);
    const assemblyJobs = dataset.jobs.filter(
      (j) => j.department === 'assembly',
    );
    expect(assemblyJobs.length).toBeGreaterThan(10);
    expect(placed + b.pool.length).toBe(assemblyJobs.length);

    const onBoard = b.columns.flatMap((c) => c.orders.map((o) => o.job));
    expect(onBoard.every((j) => j.department === 'assembly')).toBe(true);
  });

  it('files each order into the area its current stage runs in', () => {
    const b = board();
    for (const col of b.columns) {
      for (const o of col.orders) {
        expect(o.stage).not.toBeNull();
        expect(String(o.stage!.defaultArea)).toBe(String(col.area.id));
        // and the stage is genuinely on the product's route
        expect(o.route).toContain(o.job.currentStage!);
        expect(o.stageIndex).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('propagates shortages from moulded components into the release gate', () => {
    const b = board();
    const all = b.columns.flatMap((c) => c.orders);
    const blocked = all.filter((o) => o.release.level === 'blocked');
    expect(blocked.length).toBeGreaterThan(0);

    // At least one blocked order is short because a moulded part is short —
    // the moulding→assembly link the shared material engine gives us.
    const mouldedParts = new Set(
      dataset.jobs
        .filter((j) => j.department === 'moulding')
        .map((j) => String(j.partNum)),
    );
    const fromMoulding = blocked.some((o) =>
      o.material.shortages.some((s) => mouldedParts.has(String(s.componentPart))),
    );
    expect(fromMoulding).toBe(true);
  });

  it('scales area load with the crew the supervisor allocates', () => {
    const busy = board().columns.find((c) => c.orders.length > 0);
    expect(busy).toBeDefined();
    const areaId = String(busy!.area.id);

    const small = board({ [areaId]: 1 }).columns.find(
      (c) => String(c.area.id) === areaId,
    )!;
    const large = board({ [areaId]: 8 }).columns.find(
      (c) => String(c.area.id) === areaId,
    )!;

    expect(small.load.plannedHours).toBeCloseTo(large.load.plannedHours);
    expect(large.load.availableHours).toBeGreaterThan(small.load.availableHours);
    expect(large.load.loadPct).toBeLessThan(small.load.loadPct);
  });

  it('totals the day across every area', () => {
    const b = board({ 'AREA-A': 7, 'AREA-SHARED': 4, 'AREA-B': 3, 'AREA-C': 4 });
    const sumPlanned = b.columns.reduce((s, c) => s + c.load.plannedHours, 0);
    expect(b.totals.plannedHours).toBeCloseTo(sumPlanned);
    expect(b.totals.availableHours).toBeGreaterThan(0);
    expect(b.totals.ready + b.totals.blocked).toBeLessThanOrEqual(
      b.totals.orders,
    );
  });
});
