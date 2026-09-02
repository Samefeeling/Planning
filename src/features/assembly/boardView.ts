/** Pure view-only transforms for the assembly board. */

import type { OrderRow } from '@/engine/assembly/board';
import { addDays, isWeekend, startOfDay } from '@/engine/assembly/dates';
import { crewDayKey } from '@/engine/assembly/crewSchedule';

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

/** Today through the end of the fifth factory working day, end-exclusive. */
export function nextWorkingDaysWindow(
  today: Date,
  count = 5,
): { from: Date; toExclusive: Date } {
  const from = startOfDay(today);
  let cursor = from;
  let found = 0;
  while (found < Math.max(1, count)) {
    if (!isWeekend(cursor)) found++;
    if (found < Math.max(1, count)) cursor = startOfDay(addDays(cursor, 1));
  }
  return { from, toExclusive: startOfDay(addDays(cursor, 1)) };
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
