/**
 * Day-scale crew capacity for one order.
 *
 * Assembly reports once per shift, so a date-bounded assignment is the
 * smallest honest planning unit. Each open day consumes up to 7.25 standard
 * hours per active person; a person can therefore help an earlier order for a
 * few days and leave automatically when their next assignment begins.
 */

import {
  MAX_WORKERS_PER_ORDER,
  PRODUCTIVE_HOURS_PER_PERSON,
  type CrewAssignment,
} from '@/domain/assembly';
import { addDays, isWeekend, startOfDay } from './dates';

export interface CrewDayPlan {
  day: string;
  date: Date;
  workerIds: string[];
  /** Total standard hours removed from the order on this day. */
  hours: number;
  /** Equal share charged to each active worker. */
  perWorkerHours: number;
}

export interface VariableCrewPlan {
  start: Date | null;
  expectDate: Date | null;
  /** End of the capacity that is actually covered, even if work remains. */
  coveredUntil: Date | null;
  /** Worked-day equivalents, including a fractional final day. */
  days: number | null;
  crewDays: CrewDayPlan[];
  /** Work still uncovered after the bounded planning horizon. */
  uncoveredHours: number;
}

const MAX_PLAN_DAYS = 730;
const EPSILON = 1e-8;

export const crewDayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

export function assignmentActiveOnDay(
  assignment: CrewAssignment,
  day: string,
  orderStartDay: string,
): boolean {
  const from = assignment.fromDay ?? orderStartDay;
  return from <= day &&
    (assignment.toDayExclusive === null || day < assignment.toDayExclusive);
}

export function crewIdsOnDay(
  assignments: CrewAssignment[],
  day: string,
  orderStartDay: string,
): string[] {
  const ids = assignments
    .filter((assignment) =>
      assignmentActiveOnDay(assignment, day, orderStartDay),
    )
    .map((assignment) => assignment.workerId);
  return [...new Set(ids)].slice(0, MAX_WORKERS_PER_ORDER);
}

export function planVariableCrew(
  from: Date,
  requiredHours: number,
  assignments: CrewAssignment[],
  overtime: boolean,
): VariableCrewPlan {
  const orderStart = startOfDay(from);
  const orderStartDay = crewDayKey(orderStart);
  let remaining = Math.max(0, requiredHours);
  let cursor = orderStart;
  let first: Date | null = null;
  let workedDays = 0;
  const crewDays: CrewDayPlan[] = [];

  if (remaining <= EPSILON) {
    return {
      start: orderStart,
      expectDate: orderStart,
      coveredUntil: orderStart,
      days: 0,
      crewDays,
      uncoveredHours: 0,
    };
  }

  for (let i = 0; i < MAX_PLAN_DAYS && remaining > EPSILON; i++) {
    if (!overtime && isWeekend(cursor)) {
      cursor = addDays(cursor, 1);
      continue;
    }
    const day = crewDayKey(cursor);
    const workerIds = crewIdsOnDay(assignments, day, orderStartDay);
    if (workerIds.length === 0) {
      cursor = addDays(cursor, 1);
      continue;
    }

    first ??= cursor;
    const capacity = workerIds.length * PRODUCTIVE_HOURS_PER_PERSON;
    const hours = Math.min(remaining, capacity);
    const fraction = hours / capacity;
    crewDays.push({
      day,
      date: cursor,
      workerIds,
      hours,
      perWorkerHours: hours / workerIds.length,
    });
    workedDays += fraction;
    remaining -= hours;

    if (remaining <= EPSILON) {
      return {
        start: first,
        expectDate: addDays(cursor, fraction),
        coveredUntil: addDays(cursor, fraction),
        days: workedDays,
        crewDays,
        uncoveredHours: 0,
      };
    }
    cursor = addDays(cursor, 1);
  }

  return {
    start: first,
    expectDate: null,
    coveredUntil: crewDays.length > 0
      ? addDays(
          crewDays.at(-1)!.date,
          crewDays.at(-1)!.hours /
            (crewDays.at(-1)!.workerIds.length * PRODUCTIVE_HOURS_PER_PERSON),
        )
      : null,
    days: first ? workedDays : null,
    crewDays,
    uncoveredHours: remaining,
  };
}
