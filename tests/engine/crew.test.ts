/**
 * A first crew for an imported export.
 *
 * `Planning1.csv` never says who builds an order, so the whole board arrives
 * unstaffed — and an unstaffed order has no bar. This fills the gaps without
 * ever touching an allocation somebody has already made.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MockSource } from '@/data/mock/MockSource';
import { buildIndexes } from '@/engine/indexes';
import { computeAssemblyGantt } from '@/engine/assembly/board';
import { suggestCrew } from '@/engine/assembly/crew';
import { usePlanStore } from '@/store/planStore';
import { MAX_WORKERS_PER_ORDER } from '@/domain/assembly';
import type { PlanningDataset } from '@/domain/types';

let dataset: PlanningDataset;

beforeAll(async () => {
  const result = await new MockSource().loadAll();
  if (!result.ok) throw new Error(result.error);
  dataset = result.value;
});

const TODAY = new Date('2026-09-11T00:00:00');

/** The board as it comes off an import: orders on lines, nobody on them. */
function board(orderWorkers: Record<string, string[]> = {}) {
  const indexes = buildIndexes(dataset);
  usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
  return computeAssemblyGantt({
    dataset,
    indexes,
    containers: usePlanStore.getState().containers,
    orderWorkers,
    orderStarts: {},
    progress: {},
    production: {},
    workers: dataset.workers,
    today: TODAY,
  });
}

describe('suggestCrew', () => {
  it('gives every unstaffed order somebody who can do the work', () => {
    const b = board();
    const { allocations, staffed } = suggestCrew(b);

    expect(staffed).toBeGreaterThan(10);
    const byId = new Map(b.workers.map((w) => [String(w.id), w]));
    for (const group of b.groups) {
      if (!group.line.schedulable) continue;
      for (const row of group.rows) {
        const crew = allocations[String(row.job.id)];
        if (!crew) continue;
        expect(crew.length).toBeGreaterThan(0);
        expect(crew.length).toBeLessThanOrEqual(MAX_WORKERS_PER_ORDER);
        expect(new Set(crew).size).toBe(crew.length); // nobody twice
        for (const id of crew) {
          const w = byId.get(id)!;
          expect(w.onShift).toBe(true);
          expect(w.skills).toContain(group.line.key);
        }
      }
    }
  });

  it('turns an unschedulable board into a scheduled one', () => {
    const before = board();
    const bare = [...before.rowsByJob.values()].filter((r) => r.days === null);
    expect(bare.length).toBeGreaterThan(0); // nothing has a bar yet

    const after = board(suggestCrew(before).allocations);
    for (const row of after.rowsByJob.values()) {
      expect(row.days).not.toBeNull();
      expect(row.expectDate).not.toBeNull();
    }
  });

  it('leaves an allocation the supervisor already made', () => {
    const b = board();
    const first = String(
      b.groups.find((g) => g.line.schedulable)!.rows[0].job.id,
    );
    const mine = { [first]: ['W01'] };

    const { allocations } = suggestCrew(board(mine));
    expect(allocations[first]).toBeUndefined();
  });

  it('shares the line’s people out rather than piling onto one order', () => {
    const b = board();
    const { allocations } = suggestCrew(b);
    const upl = b.groups.find((g) => g.line.key === 'UPL')!;
    const rows = upl.rows.map((r) => allocations[String(r.job.id)]).filter(Boolean);
    expect(rows.length).toBeGreaterThan(1);
    // Consecutive orders draw different people, so the first two teams are
    // not the same two names.
    expect(rows[0].join()).not.toBe(rows[1].join());
  });

  it('counts the orders it cannot crew instead of inventing one', () => {
    // Nobody in today: every order is left alone and reported.
    const noRoster = { ...dataset, workers: dataset.workers.map((w) => ({ ...w, onShift: false })) };
    const indexes = buildIndexes(noRoster);
    const b = computeAssemblyGantt({
      dataset: noRoster,
      indexes,
      containers: usePlanStore.getState().containers,
      orderWorkers: {},
      orderStarts: {},
      progress: {},
      production: {},
      workers: noRoster.workers,
      today: TODAY,
    });

    const { allocations, staffed, unstaffed } = suggestCrew(b);
    expect(allocations).toEqual({});
    expect(staffed).toBe(0);
    expect(unstaffed).toBeGreaterThan(0);
  });
});
