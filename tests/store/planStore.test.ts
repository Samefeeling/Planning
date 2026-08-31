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
