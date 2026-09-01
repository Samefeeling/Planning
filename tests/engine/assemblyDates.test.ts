import { describe, it, expect } from 'vitest';
import {
  addWorkingDays,
  isWeekend,
  nextWorkingDay,
  scheduleStatus,
  wholeDaysBetween,
} from '@/engine/assembly/dates';

const d = (s: string) => new Date(`${s}T00:00:00`);

// Ship Date is the booked departure; Due Date is the later customer date.
const SHIP = d('2026-09-11');
const DUE = d('2026-09-15');

describe('schedule colour bands', () => {
  it('is green when the order makes the ship date', () => {
    expect(scheduleStatus(d('2026-09-09'), SHIP, DUE).color).toBe('green');
    // Exactly on the ship date still ships.
    expect(scheduleStatus(SHIP, SHIP, DUE).color).toBe('green');
  });

  it('is orange between the ship date and the due date', () => {
    expect(scheduleStatus(d('2026-09-12'), SHIP, DUE).color).toBe('orange');
    expect(scheduleStatus(d('2026-09-14'), SHIP, DUE).color).toBe('orange');
  });

  it('is red once the customer due date is reached', () => {
    expect(scheduleStatus(DUE, SHIP, DUE).color).toBe('red');
    expect(scheduleStatus(d('2026-09-20'), SHIP, DUE).color).toBe('red');
  });

  it('bands are exhaustive and never overlap', () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 25; i++) {
      const expect_ = d(`2026-09-${String(i).padStart(2, '0')}`);
      const s = scheduleStatus(expect_, SHIP, DUE);
      expect(['green', 'orange', 'red']).toContain(s.color);
      seen.add(s.color);
    }
    expect(seen).toEqual(new Set(['green', 'orange', 'red']));
  });

  it('reports slack against both commitments', () => {
    const s = scheduleStatus(d('2026-09-13'), SHIP, DUE);
    expect(s.shipSlackDays).toBe(2); // 2 days past ship
    expect(s.dueSlackDays).toBe(-2); // 2 days before due
  });

  it('classifies on the due date alone when no ship date exists', () => {
    expect(scheduleStatus(d('2026-09-20'), null, DUE).color).toBe('red');
    expect(scheduleStatus(d('2026-09-01'), null, DUE).color).toBe('green');
  });

  it('is grey when it cannot be judged', () => {
    expect(scheduleStatus(null, SHIP, DUE).color).toBe('grey');
    expect(scheduleStatus(d('2026-09-12'), null, null).color).toBe('grey');
  });

  it('counts whole days regardless of time of day', () => {
    expect(
      wholeDaysBetween(new Date('2026-09-13T23:00:00'), new Date('2026-09-11T01:00:00')),
    ).toBe(2);
  });
});

/**
 * The shift calendar. Mon 14 Sep 2026 … Fri 18, then Sat 19 / Sun 20 closed,
 * Mon 21 open again.
 */
describe('the working week', () => {
  const MON = d('2026-09-14');
  const FRI = d('2026-09-18');
  const SAT = d('2026-09-19');
  const SUN = d('2026-09-20');
  const NEXT_MON = d('2026-09-21');

  it('knows which days the factory is shut', () => {
    expect(isWeekend(FRI)).toBe(false);
    expect(isWeekend(SAT)).toBe(true);
    expect(isWeekend(SUN)).toBe(true);
    expect(isWeekend(NEXT_MON)).toBe(false);
  });

  it('leaves a weekday alone and pulls a weekend to the Monday', () => {
    expect(nextWorkingDay(FRI)).toEqual(FRI);
    expect(nextWorkingDay(SAT)).toEqual(NEXT_MON);
    expect(nextWorkingDay(SUN)).toEqual(NEXT_MON);
    // Part-way through a closed Saturday still means Monday morning.
    expect(nextWorkingDay(new Date('2026-09-19T14:30:00'))).toEqual(NEXT_MON);
  });

  it('steps a duration over the weekend', () => {
    // Five days from Monday fills the week exactly.
    expect(addWorkingDays(MON, 5)).toEqual(SAT);
    // Three days from Thursday: Thu, Fri, then Monday.
    expect(addWorkingDays(d('2026-09-17'), 3)).toEqual(d('2026-09-22'));
    // A whole week of work is seven weekdays, so it lands on the Wednesday.
    expect(addWorkingDays(MON, 7)).toEqual(d('2026-09-23'));
  });

  it('carries a part-day over the closed days rather than into them', () => {
    // Friday noon leaves half a day of Friday: work needing more than that
    // resumes on the Monday, not on the Saturday.
    const overrun = addWorkingDays(new Date('2026-09-18T12:00:00'), 0.75);
    expect(overrun).toEqual(new Date('2026-09-21T06:00:00'));
    // Work that fits in what is left of Friday ends where Friday ends.
    expect(addWorkingDays(new Date('2026-09-18T12:00:00'), 0.5)).toEqual(SAT);
    // A quarter of a day started Friday morning stays on the Friday.
    expect(addWorkingDays(FRI, 0.25)).toEqual(new Date('2026-09-18T06:00:00'));
  });

  it('treats a zero or negative duration as no time at all', () => {
    expect(addWorkingDays(SAT, 0)).toEqual(SAT);
    expect(addWorkingDays(MON, -3)).toEqual(MON);
  });
});
