import { describe, expect, it } from 'vitest';
import { planVariableCrew } from '@/engine/assembly/crewSchedule';

describe('date-bounded crew capacity', () => {
  it('lets Bill help an earlier order for 2/9–3/9, then leave for the next job', () => {
    const plan = planVariableCrew(
      new Date('2026-09-02T00:00:00'),
      58,
      [
        { workerId: 'Mary', fromDay: null, toDayExclusive: null },
        {
          workerId: 'Bill',
          fromDay: '2026-09-02',
          toDayExclusive: '2026-09-04',
        },
        {
          workerId: 'Jones',
          fromDay: '2026-09-04',
          toDayExclusive: null,
        },
      ],
      false,
    );

    expect(plan.expectDate).not.toBeNull();
    expect(
      plan.crewDays
        .filter((day) => day.workerIds.includes('Bill'))
        .map((day) => day.day),
    ).toEqual(['2026-09-02', '2026-09-03']);
    expect(
      plan.crewDays
        .filter((day) => day.workerIds.includes('Jones'))
        .map((day) => day.day),
    ).toContain('2026-09-04');
    expect(plan.uncoveredHours).toBe(0);
  });

  it('pauses with no Expect Date when a bounded helper leaves work uncovered', () => {
    const plan = planVariableCrew(
      new Date('2026-09-02T00:00:00'),
      20,
      [
        {
          workerId: 'Bill',
          fromDay: '2026-09-02',
          toDayExclusive: '2026-09-04',
        },
      ],
      false,
    );

    expect(plan.crewDays.map((day) => day.day)).toEqual([
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(plan.expectDate).toBeNull();
    expect(plan.uncoveredHours).toBeCloseTo(5.5, 6);
    expect(plan.coveredUntil).toEqual(new Date('2026-09-04T00:00:00'));
  });
});
