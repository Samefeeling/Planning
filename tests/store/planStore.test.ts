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
    usePlanStore.setState({
      production: {},
      progress: {},
      progressBaselines: {},
      orderWorkers: {},
      orderDoubleBooked: {},
      orderActualStarts: {},
    });
  });

  it('saves progress and releases crew atomically only on completion', () => {
    const job = JobId('ASSY-102');
    usePlanStore.setState({
      orderWorkers: { [String(job)]: ['W01', 'W02'] },
      orderDoubleBooked: { [String(job)]: ['W02'] },
    });
    usePlanStore.getState().startOrder(job, {
      startedAt: '2026-08-31T00:00:00.000Z',
      overrideReason: null,
      operatorIds: ['W01', 'W02'],
      operatorNames: ['Lee', 'Gate'],
    });

    usePlanStore.getState().saveProductionEntry(
      job,
      {
        ...entry(7),
        paused: false,
        pauseReason: null,
        jobCompleted: true,
        operatorIds: ['W01', 'W02'],
        operatorNames: ['Lee', 'Gate'],
        completedAt: '2026-08-31T05:30:00.000Z',
      },
      { remainingQty: 7, completedQty: 93 },
    );

    const state = usePlanStore.getState();
    expect(state.progress[String(job)]).toEqual([{ date: '2026-08-31', qty: 7 }]);
    expect(state.orderWorkers[String(job)]).toBeUndefined();
    expect(state.orderDoubleBooked[String(job)]).toBeUndefined();
    expect(state.production[String(job)][0].operatorIds).toEqual(['W01', 'W02']);
  });

  it('keeps the crew allocated after a normal save', () => {
    const job = JobId('ASSY-103');
    usePlanStore.setState({ orderWorkers: { [String(job)]: ['W01'] } });
    usePlanStore.getState().startOrder(job, {
      startedAt: '2026-08-31T00:00:00.000Z',
      overrideReason: null,
      operatorIds: ['W01'],
      operatorNames: ['Lee'],
    });
    usePlanStore.getState().saveProductionEntry(
      job,
      entry(2),
      { remainingQty: 10, completedQty: 0 },
    );
    expect(usePlanStore.getState().orderWorkers[String(job)]).toEqual(['W01']);
  });

  it('records the first actual start once and preserves its crew snapshot', () => {
    const job = JobId('ASSY-104');
    const first = {
      startedAt: '2026-08-31T00:00:00.000Z',
      overrideReason: null,
      operatorIds: ['W01'],
      operatorNames: ['Lee'],
    };
    usePlanStore.getState().startOrder(job, first);
    usePlanStore.getState().startOrder(job, { ...first, startedAt: '2026-09-01T00:00:00.000Z' });
    expect(usePlanStore.getState().orderActualStarts[String(job)]).toEqual(first);
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
