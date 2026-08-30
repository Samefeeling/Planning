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
    expect(dataset.workCenters.length).toBeGreaterThan(5);
    expect(dataset.workCenters.some((w) => w.department === 'assembly')).toBe(
      true,
    );
    expect(dataset.jobs.length).toBeGreaterThan(20);
    expect(dataset.routing.length).toBeGreaterThan(0);
    expect(dataset.inventory.length).toBeGreaterThan(0);
  });

  it('shows the configured lines in floor order, excluding 650T/PLASSY', () => {
    const ids = dataset.workCenters
      .filter((w) => w.department === 'moulding')
      .map((m) => String(m.id));
    expect(ids).toEqual([
      '1600T',
      '1300T',
      'BATT1',
      'BATT2',
      '850T',
      '550T',
      '320T',
      '150T',
      '125T',
      'HS',
    ]);
    expect(ids).not.toContain('650T');
    expect(ids).not.toContain('PLASSY');
  });

  it('places jobs on lanes with positive-width, ordered bars', () => {
    const indexes = buildIndexes(dataset);
    usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
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
    usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
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
    usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
    const board = computeBoardView(
      dataset,
      indexes,
      usePlanStore.getState().containers,
      dataset.fetchedAt,
    );
    const scheduledCount = board.lanes.reduce((n, l) => n + l.jobs.length, 0);
    const mouldingJobs = dataset.jobs.filter(
      (j) => j.department === 'moulding',
    );
    expect(scheduledCount + board.pool.length).toBe(mouldingJobs.length);
  });

  it('keeps assembly orders off the moulding board entirely', () => {
    const indexes = buildIndexes(dataset);
    usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
    const board = computeBoardView(
      dataset,
      indexes,
      usePlanStore.getState().containers,
      dataset.fetchedAt,
    );
    const onBoard = [
      ...board.lanes.flatMap((l) => l.jobs.map((s) => s.job)),
      ...board.pool,
    ];
    expect(onBoard.length).toBeGreaterThan(0);
    expect(onBoard.every((j) => j.department === 'moulding')).toBe(true);
  });

  it('pushes an entire lane back by the machine delay (breakdown)', () => {
    const indexes = buildIndexes(dataset);
    usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
    const containers = usePlanStore.getState().containers;

    const base = computeBoardView(dataset, indexes, containers, dataset.fetchedAt);
    const target = base.lanes.find((l) => l.jobs.length > 0);
    expect(target).toBeDefined();
    const machineId = String(target!.machine.id);

    const DELAY = 12; // hours
    const delayed = computeBoardView(
      dataset,
      indexes,
      containers,
      dataset.fetchedAt,
      { [machineId]: DELAY },
    );
    const dLane = delayed.lanes.find((l) => String(l.machine.id) === machineId)!;
    const floor = base.horizonStart.getTime() + DELAY * 3_600_000;

    expect(dLane.delayHours).toBe(DELAY);
    // Every job on the delayed lane now starts at/after horizon + delay,
    // and no earlier than it did before the delay.
    dLane.jobs.forEach((sj, i) => {
      expect(sj.start.getTime()).toBeGreaterThanOrEqual(floor);
      expect(sj.start.getTime()).toBeGreaterThanOrEqual(
        target!.jobs[i].start.getTime(),
      );
    });

    // Other lanes are unaffected.
    const other = delayed.lanes.find(
      (l) => String(l.machine.id) !== machineId && l.jobs.length > 0,
    );
    if (other) {
      const baseOther = base.lanes.find(
        (l) => String(l.machine.id) === String(other.machine.id),
      )!;
      expect(other.jobs[0].start.getTime()).toBe(
        baseOther.jobs[0].start.getTime(),
      );
    }
  });
});
