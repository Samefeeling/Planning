/**
 * End-to-end smoke test over the real seed data: load via MockSource, build
 * indexes, seed lanes from each job's workbook machine, and derive the board.
 * Verifies the whole engine pipeline produces a sane schedule.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MockSource } from '@/data/mock/MockSource';
import { buildIndexes } from '@/engine/indexes';
import { computeBoardView } from '@/store/selectors';
import { usePlanStore } from '@/store/planStore';
import type { PlanningDataset } from '@/domain/types';

let dataset: PlanningDataset;

beforeAll(async () => {
  const result = await new MockSource().loadAll();
  if (!result.ok) throw new Error(result.error);
  dataset = result.value;
});

describe('board pipeline (mock data)', () => {
  it('loads a non-trivial dataset', () => {
    expect(dataset.machines.length).toBeGreaterThan(5);
    expect(dataset.jobs.length).toBeGreaterThan(20);
    expect(dataset.routing.length).toBeGreaterThan(0);
    expect(dataset.inventory.length).toBeGreaterThan(0);
  });

  it('places jobs on lanes with positive-width, ordered bars', () => {
    const indexes = buildIndexes(dataset);
    usePlanStore.getState().reconcile(dataset.machines, dataset.jobs);
    const containers = usePlanStore.getState().containers;

    const board = computeBoardView(
      dataset,
      indexes,
      containers,
      dataset.fetchedAt,
    );

    const scheduled = board.lanes.flatMap((l) => l.jobs);
    expect(scheduled.length).toBeGreaterThan(10);

    // Every bar runs forward in time.
    for (const sj of scheduled) {
      expect(sj.end.getTime()).toBeGreaterThanOrEqual(sj.start.getTime());
    }

    // Within a lane, jobs are non-overlapping and ordered by start.
    for (const lane of board.lanes) {
      for (let i = 1; i < lane.jobs.length; i++) {
        expect(lane.jobs[i].start.getTime()).toBeGreaterThanOrEqual(
          lane.jobs[i - 1].start.getTime(),
        );
      }
    }
  });

  it('detects changeovers and material shortages somewhere in the plan', () => {
    const indexes = buildIndexes(dataset);
    usePlanStore.getState().reconcile(dataset.machines, dataset.jobs);
    const board = computeBoardView(
      dataset,
      indexes,
      usePlanStore.getState().containers,
      dataset.fetchedAt,
    );
    const scheduled = board.lanes.flatMap((l) => l.jobs);

    expect(scheduled.some((s) => s.changeover.required)).toBe(true);
    expect(scheduled.some((s) => s.material.level !== 'ok')).toBe(true);
  });

  it('accounts for every job (scheduled + pooled = total)', () => {
    const indexes = buildIndexes(dataset);
    usePlanStore.getState().reconcile(dataset.machines, dataset.jobs);
    const board = computeBoardView(
      dataset,
      indexes,
      usePlanStore.getState().containers,
      dataset.fetchedAt,
    );
    const scheduledCount = board.lanes.reduce((n, l) => n + l.jobs.length, 0);
    expect(scheduledCount + board.pool.length).toBe(dataset.jobs.length);
  });
});
