import { describe, it, expect } from 'vitest';
import { scheduleStatus, wholeDaysBetween } from '@/engine/assembly/dates';

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
