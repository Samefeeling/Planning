/** Pure view-only transforms for the assembly board. */

import type { OrderRow } from '@/engine/assembly/board';
import {
  addDays,
  isWeekend,
  prevWorkingDay,
  startOfDay,
  wholeDaysBetween,
} from '@/engine/assembly/dates';
import { crewDayKey } from '@/engine/assembly/crewSchedule';
import { MS_PER_DAY } from '@/lib/time';

export type OrderSortKey = 'start' | 'due' | 'ship';
export type SortDirection = 'asc' | 'desc';

export interface OrderSort {
  key: OrderSortKey;
  direction: SortDirection;
}

const sortDate = (row: OrderRow, key: OrderSortKey): Date | null => {
  if (key === 'start') return row.job.startDate;
  if (key === 'due') return row.job.dueDate;
  return row.job.shipDate;
};

/** Stable, line-local date sort. Missing source dates always stay at the end. */
export function sortLineRows(
  rows: OrderRow[],
  sort: OrderSort | null,
): OrderRow[] {
  if (!sort) return rows;
  return rows
    .map((row, index) => ({ row, index, date: sortDate(row, sort.key) }))
    .sort((a, b) => {
      if (!a.date && !b.date) return a.index - b.index;
      if (!a.date) return 1;
      if (!b.date) return -1;
      const delta = a.date.getTime() - b.date.getTime();
      return (sort.direction === 'asc' ? delta : -delta) || a.index - b.index;
    })
    .map(({ row }) => row);
}

/** Previous working day through the end of today's fifth working day. */
export function nextWorkingDaysWindow(
  today: Date,
  count = 5,
): { from: Date; toExclusive: Date } {
  const todayStart = startOfDay(today);
  const from = prevWorkingDay(todayStart);
  let cursor = todayStart;
  let found = 0;
  while (found < Math.max(1, count)) {
    if (!isWeekend(cursor)) found++;
    if (found < Math.max(1, count)) cursor = startOfDay(addDays(cursor, 1));
  }
  return { from, toExclusive: startOfDay(addDays(cursor, 1)) };
}

/**
 * Horizontal day position on the timeline. When weekends are hidden their
 * width is zero, so Friday and Monday meet without leaving empty columns.
 */
export function timelineDayOffset(
  date: Date,
  horizonStart: Date,
  showWeekends: boolean,
): number {
  const origin = startOfDay(horizonStart);
  const target = startOfDay(date);
  const fraction = (date.getTime() - target.getTime()) / MS_PER_DAY;
  if (showWeekends) return wholeDaysBetween(target, origin) + fraction;

  let offset = 0;
  if (target >= origin) {
    for (
      let cursor = origin;
      cursor < target;
      cursor = startOfDay(addDays(cursor, 1))
    ) {
      if (!isWeekend(cursor)) offset++;
    }
  } else {
    for (
      let cursor = target;
      cursor < origin;
      cursor = startOfDay(addDays(cursor, 1))
    ) {
      if (!isWeekend(cursor)) offset--;
    }
  }
  return offset + (isWeekend(target) ? 0 : fraction);
}

/** Move a dragged bar by what the user sees as timeline columns. */
export function shiftTimelineDays(
  from: Date,
  days: number,
  showWeekends: boolean,
): Date {
  if (showWeekends || days === 0) return startOfDay(addDays(from, days));
  const direction = days < 0 ? -1 : 1;
  let cursor = startOfDay(from);
  for (let left = Math.abs(days); left > 0; ) {
    cursor = startOfDay(addDays(cursor, direction));
    if (!isWeekend(cursor)) left--;
  }
  return cursor;
}

/** An order remains visible when any part of its planned bar touches the window. */
export function isInNextWorkingDays(
  row: OrderRow,
  today: Date,
  count = 5,
): boolean {
  const window = nextWorkingDaysWindow(today, count);
  const from = row.start ?? row.plannedStart ?? row.job.startDate;
  if (!from) return false;
  const to = row.expectDate ?? row.planThrough ?? from;
  return from < window.toExclusive && to >= window.from;
}

/** Workers actually allocated on one day; future allocations do not count. */
export function activeWorkerIdsOnDay(
  rows: OrderRow[],
  day: Date,
): Set<string> {
  const key = crewDayKey(day);
  const active = new Set<string>();
  for (const row of rows) {
    if (!row.line.schedulable || row.completedToday) continue;
    if (row.crewDays) {
      row.crewDays
        .find((crewDay) => crewDay.day === key)
        ?.workerIds.forEach((workerId) => active.add(workerId));
    } else {
      row.workers.forEach((worker) => active.add(String(worker.id)));
    }
  }
  return active;
}
