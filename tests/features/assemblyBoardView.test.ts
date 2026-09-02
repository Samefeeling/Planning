import { describe, expect, it } from 'vitest';
import type { OrderRow } from '@/engine/assembly/board';
import {
  activeWorkerIdsOnDay,
  isInNextWorkingDays,
  nextWorkingDaysWindow,
  shiftTimelineDays,
  sortLineRows,
  timelineDayOffset,
} from '@/features/assembly/boardView';

const row = (
  id: string,
  dates: { start?: string; due?: string; ship?: string } = {},
): OrderRow =>
  ({
    job: {
      id,
      startDate: dates.start ? new Date(dates.start) : null,
      dueDate: dates.due ? new Date(dates.due) : null,
      shipDate: dates.ship ? new Date(dates.ship) : null,
    },
    line: { schedulable: true },
    workers: [],
    plannedStart: dates.start ? new Date(dates.start) : new Date('2026-09-30'),
    start: dates.start ? new Date(dates.start) : null,
    expectDate: dates.due ? new Date(dates.due) : null,
    completedToday: false,
  }) as unknown as OrderRow;

describe('assembly board view controls', () => {
  it('sorts within a line, toggles direction, and leaves missing dates last', () => {
    const rows = [
      row('B', { due: '2026-09-05' }),
      row('missing'),
      row('A', { due: '2026-09-03' }),
    ];
    expect(sortLineRows(rows, { key: 'due', direction: 'asc' }).map((r) => r.job.id))
      .toEqual(['A', 'B', 'missing']);
    expect(sortLineRows(rows, { key: 'due', direction: 'desc' }).map((r) => r.job.id))
      .toEqual(['B', 'A', 'missing']);
  });

  it('uses five working days and keeps bars that overlap the window', () => {
    const window = nextWorkingDaysWindow(new Date('2026-09-03T00:00:00'));
    expect(window.from).toEqual(new Date('2026-09-02T00:00:00'));
    expect(window.toExclusive).toEqual(new Date('2026-09-10T00:00:00'));

    const active = row('active', { start: '2026-09-01', due: '2026-09-04' });
    const later = row('later', { start: '2026-09-10', due: '2026-09-11' });
    expect(isInNextWorkingDays(active, new Date('2026-09-03'))).toBe(true);
    expect(isInNextWorkingDays(later, new Date('2026-09-03'))).toBe(false);
  });

  it('removes weekend width and drags by visible working-day columns', () => {
    const friday = new Date('2026-09-04T00:00:00');
    const monday = new Date('2026-09-07T00:00:00');
    expect(timelineDayOffset(monday, friday, false)).toBe(1);
    expect(timelineDayOffset(monday, friday, true)).toBe(3);
    expect(shiftTimelineDays(friday, 1, false)).toEqual(monday);
    expect(shiftTimelineDays(monday, -1, false)).toEqual(friday);
  });

  it('counts only the crew active today, not a later assignment', () => {
    const planned = row('SFM507569', { start: '2026-09-02' });
    planned.crewDays = [
      {
        day: '2026-09-02',
        date: new Date('2026-09-02'),
        workerIds: ['Bill'],
        hours: 7.25,
        perWorkerHours: 7.25,
      },
      {
        day: '2026-09-04',
        date: new Date('2026-09-04'),
        workerIds: ['Jones'],
        hours: 7.25,
        perWorkerHours: 7.25,
      },
    ];
    expect([...activeWorkerIdsOnDay([planned], new Date('2026-09-02'))]).toEqual([
      'Bill',
    ]);
  });
});
