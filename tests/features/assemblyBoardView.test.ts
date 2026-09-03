import { describe, expect, it } from 'vitest';
import type { OrderRow } from '@/engine/assembly/board';
import { WorkerId } from '@/domain/ids';
import {
  PRODUCTIVE_HOURS_PER_PERSON,
  type LineKey,
  type Worker,
} from '@/domain/assembly';
import { crewDayKey } from '@/engine/assembly/crewSchedule';
import {
  activeWorkerIdsOnDay,
  barTag,
  lineOfWorkerToday,
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
        from: 0,
        used: 1,
        workerIds: ['Bill'],
        hours: PRODUCTIVE_HOURS_PER_PERSON,
        perWorkerHours: PRODUCTIVE_HOURS_PER_PERSON,
      },
      {
        day: '2026-09-04',
        date: new Date('2026-09-04'),
        from: 0,
        used: 1,
        workerIds: ['Jones'],
        hours: PRODUCTIVE_HOURS_PER_PERSON,
        perWorkerHours: PRODUCTIVE_HOURS_PER_PERSON,
      },
    ];
    expect([...activeWorkerIdsOnDay([planned], new Date('2026-09-02'))]).toEqual([
      'Bill',
    ]);
  });
});

/**
 * Where an order's label goes. A couple of hours of work is a few pixels of
 * bar, and a label crammed into those came out as one clipped character.
 */
describe('barTag', () => {
  const bar = (over: Partial<Parameters<typeof barTag>[0]> = {}) =>
    barTag({
      jobId: 'ASM80013',
      hours: 12,
      spanDays: 2,
      width: 184,
      left: 0,
      gridWidth: 1400,
      overtime: false,
      ...over,
    });

  it('keeps the label inside a bar with room for it', () => {
    const tag = bar();
    expect(tag.text).toBe('ASM80013');
    expect(tag.outside).toBe(false);
    expect(tag.stub).toBe(false);
  });

  it('puts it outside when the bar is narrower than the name', () => {
    // Eight characters need about 69px with the padding; 63 is not enough.
    expect(bar({ width: 63 }).outside).toBe(true);
    expect(bar({ width: 80 }).outside).toBe(false);
  });

  it('says how long a few hours of work is', () => {
    // The block has bottomed out at its minimum width, so its length is not
    // telling anyone anything — the hours have to.
    const tag = bar({ spanDays: 0.11, width: 20, hours: 0.8 });
    expect(tag.stub).toBe(true);
    expect(tag.text).toBe('ASM80013 · 0.8 h');
    expect(tag.outside).toBe(true);
  });

  it('leaves the hours off an order with none left to run', () => {
    expect(bar({ spanDays: 0.1, width: 20, hours: 0 }).text).toBe('ASM80013');
  });

  it('flips to the left where the grid runs out to the right', () => {
    expect(bar({ width: 20, left: 100 }).flip).toBe(false);
    expect(bar({ width: 20, left: 1340 }).flip).toBe(true);
  });

  it('makes room for the overtime marker', () => {
    // Wide enough for the name alone, not once a marker sits beside it.
    expect(bar({ width: 76 }).outside).toBe(false);
    expect(bar({ width: 76, overtime: true }).outside).toBe(true);
  });
});

/**
 * One person, one line. Somebody trained on two is qualified for both, but at
 * any one moment they are standing at one of them.
 */
describe('lineOfWorkerToday', () => {
  const TODAY = new Date(2026, 8, 10);
  const person = (id: string, skills: LineKey[]): Worker => ({
    id: WorkerId(id),
    name: id,
    skills,
    onShift: true,
  });
  const onLine = (
    jobId: string,
    line: LineKey,
    day: Date,
    workerIds: string[],
  ): OrderRow =>
    ({
      job: { id: jobId },
      line: { key: line, schedulable: true },
      completedToday: false,
      workers: workerIds.map((id) => ({ id })),
      crewDays: [
        { day: crewDayKey(day), date: day, from: 0, used: 1, workerIds },
      ],
    }) as unknown as OrderRow;

  it('puts them on the line their work today is on', () => {
    const bill = person('W1', ['UPL', 'ASSY']);
    const at = lineOfWorkerToday(
      [bill],
      [onLine('J1', 'ASSY', TODAY, ['W1'])],
      TODAY,
    );
    expect(at.get('W1')).toBe('ASSY');
  });

  it('falls back to the line they normally work', () => {
    const bill = person('W1', ['UPL', 'ASSY']);
    // Work, but not today — so today they are at their usual bench.
    const at = lineOfWorkerToday(
      [bill],
      [onLine('J1', 'ASSY', new Date(2026, 8, 14), ['W1'])],
      TODAY,
    );
    expect(at.get('W1')).toBe('UPL');
  });

  it('uses the supervisor drag placement ahead of legacy skills and work', () => {
    const bill = person('Bill', ['UPL', 'ASSY']);
    const rows = [onLine('OLD', 'UPL', TODAY, ['Bill'])];
    expect(
      lineOfWorkerToday([bill], rows, TODAY, { Bill: 'TABLE' }).get('Bill'),
    ).toBe('TABLE');
  });

  it('never lands anyone on two lines at once', () => {
    const mary = person('W3', ['UPL', 'ASSY', 'TABLE']);
    const at = lineOfWorkerToday(
      [mary],
      [
        onLine('J1', 'UPL', TODAY, ['W3']),
        onLine('J2', 'TABLE', TODAY, ['W3']),
      ],
      TODAY,
    );
    // An approved double-booking is still one row on the board; the chips on
    // the orders themselves are what say they are on both.
    expect([...at.values()]).toHaveLength(1);
    expect(at.get('W3')).toBe('UPL');
  });

  it('ignores a line the board does not schedule', () => {
    const ken = person('W9', ['TABLE']);
    const pmd = onLine('SFM1', 'PMD', TODAY, ['W9']);
    (pmd.line as { schedulable: boolean }).schedulable = false;
    expect(lineOfWorkerToday([ken], [pmd], TODAY).get('W9')).toBe('TABLE');
  });
});
