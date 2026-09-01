import { beforeEach, describe, expect, it } from 'vitest';
import { JobId } from '@/domain/ids';
import { usePlanStore, type ProductionEntry } from '@/store/planStore';

const entry = (complete: number): ProductionEntry => ({
  date: '2026-08-31',
  complete,
  reject: 1,
  rework: 2,
  shiftOutput: 3,
  paused: true,
  pauseReason: 'material-shortage',
  jobCompleted: false,
  notes: 'Foam awaiting delivery',
});

describe('ASSY_Production bookings', () => {
  beforeEach(() => {
    usePlanStore.setState({ production: {} });
  });

  it('upserts one production record per job and day', () => {
    const job = JobId('ASSY-101');
    usePlanStore.getState().recordProduction(job, entry(4));
    usePlanStore.getState().recordProduction(job, entry(7));

    expect(usePlanStore.getState().production[String(job)]).toEqual([entry(7)]);
  });
});

describe('weekend overtime approvals', () => {
  const job = JobId('ASSY-202');

  beforeEach(() => {
    usePlanStore.setState({ orderOvertime: {} });
  });

  it('is off until the supervisor approves it, and clears again', () => {
    const state = () => usePlanStore.getState();
    expect(state().orderOvertime[String(job)]).toBeUndefined();

    state().setOvertime(job, true);
    expect(state().orderOvertime[String(job)]).toBe(true);

    // Withdrawn approval leaves no trace, so nothing can read as "explicitly
    // not allowed" and be mistaken for an approval later.
    state().setOvertime(job, false);
    expect(String(job) in state().orderOvertime).toBe(false);
  });
});
