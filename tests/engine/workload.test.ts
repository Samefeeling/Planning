/**
 * Work load — per person over a week, and per line.
 *
 * The unit is the remaining standard hours of an order
 * (`Calculated_RemainingLaborHrs`), shared by the crew and spread over the days
 * the bar covers.
 */

import { describe, it, expect } from 'vitest';
import { JobId, PartId, WorkerId } from '@/domain/ids';
import { LINES, PRODUCTIVE_HOURS_PER_PERSON, type Worker } from '@/domain/assembly';
import type { Job } from '@/domain/types';
import type { OrderRow } from '@/engine/assembly/board';
import { addDays, addWorkingDays } from '@/engine/assembly/dates';
import {
  LOAD_PREVIEW_DAYS,
  boardDayLoads,
  dayBand,
  lineLoad,
  loadBand,
  loadPreview,
  rosterLoad,
  workerLoad,
} from '@/engine/assembly/workload';

const UPL = LINES.find((l) => l.key === 'UPL')!;
const PMD = LINES.find((l) => l.key === 'PMD')!;
const MON = new Date(2026, 8, 14); // Mon 14 Sep 2026, local midnight

const worker = (id: string, leave: string[] = []): Worker => ({
  id: WorkerId(id),
  name: id,
  skills: ['UPL'],
  onShift: true,
  plannedLeave: leave,
});

const job = (id: string, laborHrs: number, done = 0): Job => ({
  id: JobId(id),
  department: 'assembly',
  partNum: PartId('P'),
  description: `part ${id}`,
  remainingQty: 10,
  qtyPerHr: null,
  laborHrs,
  dueDate: null,
  startDate: null,
  reqBy: null,
  released: true,
  priority: 3,
  materialPrep: 'ready',
  tool: null,
  preferredMachine: null,
  orderType: 'upholstery',
  line: null,
  shipDate: null,
  completedQty: done,
  predecessors: [],
  assignedWorkers: [],
});

/**
 * A scheduled row: `days` of work from `startDay`, worked by `workers`.
 *
 * The Expect Date is built the way the board builds it — stepping over the
 * weekend unless the order is approved for overtime — so the hours a day
 * carries still add back up to the order's remaining hours.
 */
const row = (
  j: Job,
  workers: Worker[],
  startDay: number,
  days: number,
  over: Partial<OrderRow> = {},
): OrderRow => ({
  job: j,
  line: UPL,
  workers,
  start: addDays(MON, startDay),
  expectDate: over.overtime
    ? addDays(MON, startDay + days)
    : addWorkingDays(addDays(MON, startDay), days),
  days,
  slot: 0,
  overtime: false,
  dailyTarget: 0,
  status: { color: 'green', shipSlackDays: null, dueSlackDays: null, reason: '' },
  material: { level: 'ok', earliestStart: null, shortages: [] },
  release: { level: 'ready', releasable: true, needsOverride: false, reason: '' },
  predecessors: [],
  waitingOn: null,
  booked: [],
  crewToHitShip: null,
  completedToday: false,
  ...over,
});

describe('workerLoad', () => {
  it('spreads an order’s hours over the days its bar covers', () => {
    // 14.5 h with one person = exactly two days at 7.25 h.
    const w = worker('W1');
    const load = workerLoad(w, [row(job('A', 14.5), [w], 0, 2)], MON);

    expect(load.days).toHaveLength(7);
    expect(load.days[0].hours).toBeCloseTo(7.25, 6);
    expect(load.days[1].hours).toBeCloseTo(7.25, 6);
    expect(load.days[2].hours).toBe(0);
    expect(load.totalHours).toBeCloseTo(14.5, 6);
  });

  it('splits the hours between the crew on the order', () => {
    const [a, b] = [worker('W1'), worker('W2')];
    const r = row(job('A', 29), [a, b], 0, 2);
    expect(workerLoad(a, [r], MON).totalHours).toBeCloseTo(14.5, 6);
    expect(workerLoad(b, [r], MON).totalHours).toBeCloseTo(14.5, 6);
  });

  it('keeps a sub-day order inside the one day it runs', () => {
    const w = worker('W1');
    const load = workerLoad(w, [row(job('A', 2.9), [w], 1, 0.4)], MON);
    expect(load.days[0].hours).toBe(0);
    expect(load.days[1].hours).toBeCloseTo(2.9, 6);
    expect(load.days[1].entries).toHaveLength(1);
  });

  it('counts only the part of a bar that falls inside the window', () => {
    const w = worker('W1');
    // Ten days of work starting Monday; the popup covers seven calendar days,
    // of which only the five weekdays are worked.
    const load = workerLoad(w, [row(job('A', 72.5), [w], 0, 10)], MON);
    expect(load.totalHours).toBeCloseTo(5 * 7.25, 6);
  });

  it('discounts the hours already booked as complete', () => {
    const w = worker('W1');
    // 40 h total, 25% of the units finished → 30 h left to spread.
    const partly = { ...job('A', 40), remainingQty: 30, completedQty: 10 };
    const load = workerLoad(w, [row(partly, [w], 0, 4)], MON);
    expect(load.totalHours).toBeCloseTo(30, 6);
  });

  it('does not call a day sized to the crew overtime', () => {
    // A bar fitted to its crew lands on 7.25 h through a chain of divisions;
    // floating-point dust below a minute must not read as over-booked.
    const w = worker('W1');
    const load = workerLoad(w, [row(job('A', 7.25 * 3), [w], 0, 3)], MON);
    expect(load.days[0].hours).toBeCloseTo(7.25, 6);
    expect(load.days.some((d) => d.over)).toBe(false);
    expect(load.overloadedDays).toBe(0);
  });

  it('flags a day booked past a full shift when someone is on two orders', () => {
    const w = worker('W1');
    const load = workerLoad(
      w,
      [row(job('A', 7.25), [w], 0, 1), row(job('B', 7.25), [w], 0, 1)],
      MON,
    );
    expect(load.days[0].hours).toBeCloseTo(14.5, 6);
    expect(load.days[0].entries).toHaveLength(2);
    expect(load.overloadedDays).toBe(1);
    expect(load.orderCount).toBe(2);
    // Utilisation is over the whole window, so a clash on one day does not
    // hide the fact that the rest of the week is free — `overloadedDays` is
    // what flags the clash. The window is seven days but only five of them
    // are worked, so that is what the person can deliver.
    expect(load.utilisation).toBeCloseTo(14.5 / (5 * 7.25), 6);
  });

  it('gives a day of planned leave no capacity', () => {
    const w = worker('W1', ['2026-09-15']);
    const load = workerLoad(w, [], MON);
    expect(load.days[1].onLeave).toBe(true);
    expect(load.days[1].capacity).toBe(0);
    // Five working days in the window, one of them taken as leave.
    expect(load.capacityHours).toBeCloseTo(4 * PRODUCTIVE_HOURS_PER_PERSON, 6);
  });

  it('charges nothing to the closed weekend a bar spans', () => {
    const w = worker('W1');
    // Seven days of work from Monday runs into the following week; Saturday
    // and Sunday carry none of it.
    const load = workerLoad(w, [row(job('A', 7.25 * 7), [w], 0, 7)], MON);

    for (const i of [0, 1, 2, 3, 4]) {
      expect(load.days[i].hours).toBeCloseTo(7.25, 6);
    }
    expect(load.days[5].hours).toBe(0); // Sat 19 Sep
    expect(load.days[6].hours).toBe(0); // Sun 20 Sep
    expect(load.totalHours).toBeCloseTo(5 * 7.25, 6);
  });

  it('books the weekend once the order is approved for overtime', () => {
    const w = worker('W1');
    const load = workerLoad(
      w,
      [row(job('A', 7.25 * 7), [w], 0, 7, { overtime: true })],
      MON,
    );

    expect(load.days[5].hours).toBeCloseTo(7.25, 6);
    expect(load.days[6].hours).toBeCloseTo(7.25, 6);
    expect(load.totalHours).toBeCloseTo(7 * 7.25, 6);
  });

  it('ignores orders the person is not on, and ones closed today', () => {
    const [a, b] = [worker('W1'), worker('W2')];
    const closed = row(job('C', 7.25), [a], 0, 1, { completedToday: true });
    const load = workerLoad(a, [row(job('A', 7.25), [b], 0, 1), closed], MON);
    expect(load.totalHours).toBe(0);
    expect(load.orderCount).toBe(0);
  });
});

describe('the squares beside a name', () => {
  it('draws one per working day, never the closed weekend', () => {
    const w = worker('W1');
    const preview = loadPreview(workerLoad(w, [], MON));

    expect(preview).toHaveLength(LOAD_PREVIEW_DAYS);
    expect(preview.map((d) => d.date.getDay())).toEqual([1, 2, 3, 4, 5]);
  });

  it('bands a day the same way the day columns do', () => {
    const w = worker('W1');
    // Monday full (100%), Tuesday a little over half (58%), the rest free.
    const load = workerLoad(
      w,
      [row(job('A', 7.25), [w], 0, 1), row(job('B', 4.25), [w], 1, 1)],
      MON,
    );
    const preview = loadPreview(load);

    expect(preview[0].dot).toBe('red');
    expect(preview[1].dot).toBe('green');
    expect(Math.round(preview[1].pct)).toBe(59);
  });

  it('draws an empty day hollow rather than green', () => {
    // 0% passes `loadBand` as green, which would read as "comfortably
    // loaded" — the opposite of what an idle day means to a supervisor.
    const preview = loadPreview(workerLoad(worker('W1'), [], MON));
    expect(preview.every((d) => d.dot === 'idle')).toBe(true);
    expect(loadBand(0)).toBe('green');
  });

  it('marks planned leave, and calls work booked over it over', () => {
    const off = worker('W1', ['2026-09-15']);
    expect(loadPreview(workerLoad(off, [], MON))[1].dot).toBe('leave');

    const booked = workerLoad(off, [row(job('A', 7.25), [off], 1, 1)], MON);
    expect(loadPreview(booked)[1].dot).toBe('red');
  });

  it('bands the popup exactly as it bands the squares', () => {
    // Two views of one week must never disagree about a day's colour.
    const w = worker('W1');
    const load = workerLoad(
      w,
      [row(job('A', 7.25), [w], 0, 1), row(job('B', 4.25), [w], 1, 1)],
      MON,
    );
    const preview = loadPreview(load);
    expect(load.days.filter((d) => d.working).slice(0, 5).map(dayBand)).toEqual(
      preview.map((d) => d.dot),
    );
  });

  it('does the whole roster in one pass, keyed by id', () => {
    const [a, b] = [worker('W1'), worker('W2')];
    const loads = rosterLoad([a, b], [row(job('A', 7.25), [a], 0, 1)], MON);

    expect([...loads.keys()]).toEqual(['W1', 'W2']);
    expect(loads.get('W1')!.totalHours).toBeCloseTo(7.25, 6);
    expect(loads.get('W2')!.totalHours).toBe(0);
  });
});

describe('loadBand', () => {
  it('splits at 80 and 90, with no gap and no overlap', () => {
    expect(loadBand(0)).toBe('green');
    expect(loadBand(79.9)).toBe('green');
    expect(loadBand(80)).toBe('orange');
    expect(loadBand(90)).toBe('orange');
    expect(loadBand(90.1)).toBe('red');
    expect(loadBand(140)).toBe('red');
  });
});

describe('boardDayLoads', () => {
  const crew = [worker('W1'), worker('W2')];

  it('measures hours booked against the hours the shift can deliver', () => {
    // 14.5 h of work on Monday; two people can deliver 14.5 h. That is 100%.
    const loads = boardDayLoads([row(job('A', 14.5), crew, 0, 1)], crew, MON, 3);
    expect(loads).toHaveLength(3);
    expect(loads[0].hours).toBeCloseTo(14.5, 6);
    expect(loads[0].capacity).toBeCloseTo(14.5, 6);
    expect(loads[0].pct).toBeCloseTo(100, 6);
    expect(loads[0].band).toBe('red');
    expect(loads[1].hours).toBe(0);
    expect(loads[1].band).toBe('green');
  });

  it('counts everyone available, not only the people on an order', () => {
    // One of the two is working; the other is idle but still capacity.
    const loads = boardDayLoads(
      [row(job('A', 7.25), [crew[0]], 0, 1)],
      crew,
      MON,
      1,
    );
    expect(loads[0].available).toBe(2);
    expect(loads[0].pct).toBeCloseTo(50, 6);
    expect(loads[0].band).toBe('green');
  });

  it('drops a day’s capacity for planned leave', () => {
    const off = [worker('W1'), worker('W2', ['2026-09-14'])];
    const loads = boardDayLoads([row(job('A', 7.25), [off[0]], 0, 1)], off, MON, 1);
    expect(loads[0].available).toBe(1);
    expect(loads[0].pct).toBeCloseTo(100, 6);
  });

  it('counts only who is actually in today, but everyone later', () => {
    const absent = [worker('W1'), { ...worker('W2'), onShift: false }];
    const loads = boardDayLoads([], absent, MON, 2);
    expect(loads[0].available).toBe(1); // today: attendance is known
    expect(loads[1].available).toBe(2); // tomorrow: assume everyone in
  });

  it('ignores the PMD context lane, which is not scheduled here', () => {
    const pmd = row(job('A', 29), [], 0, 2, { line: PMD });
    expect(boardDayLoads([pmd], crew, MON, 1)[0].hours).toBe(0);
  });

  it('reads zero, not NaN, on a day with nobody in', () => {
    const loads = boardDayLoads([], [], MON, 1);
    expect(loads[0].pct).toBe(0);
    expect(loads[0].band).toBe('green');
  });

  it('leaves the closed weekend empty, and marks it closed', () => {
    // A week of work from Monday spans the Saturday without loading it.
    const loads = boardDayLoads(
      [row(job('A', 7.25 * 7), [crew[0]], 0, 7)],
      crew,
      MON,
      7,
    );
    expect(loads[5].working).toBe(false); // Sat 19 Sep
    expect(loads[6].working).toBe(false); // Sun 20 Sep
    expect(loads[5].hours).toBe(0);
    expect(loads[5].pct).toBe(0);
    expect(loads[0].hours).toBeCloseTo(7.25, 6);
  });

  it('shows the load an approved weekend actually carries', () => {
    // A Saturday bar the supervisor signed off: still a closed day, but the
    // column has to say what is being asked of the crew.
    const saturday = row(job('A', 7.25), [crew[0]], 5, 1, { overtime: true });
    const loads = boardDayLoads([saturday], crew, MON, 7);

    expect(loads[5].working).toBe(false);
    expect(loads[5].hours).toBeCloseTo(7.25, 6);
    expect(loads[5].pct).toBeCloseTo(50, 6);
  });
});

describe('the columns behind today', () => {
  const crew = [worker('W1'), worker('W2')];
  // Board opens on the Friday, plans from the Monday: one column of history.
  const FRI = new Date(2026, 8, 11);

  it('marks which columns are past and which one is today', () => {
    const loads = boardDayLoads([], crew, FRI, 4, MON);
    expect(loads.map((l) => l.past)).toEqual([true, true, true, false]);
    expect(loads.map((l) => l.isToday)).toEqual([false, false, false, true]);
  });

  it('shows what the shift booked, not what was planned for it', () => {
    // 20 units of a 10-unit-a-day order were booked on the Friday. The plan
    // for that day is irrelevant now: it happened, or it did not.
    const j = job('A', 29); // 29 h over 10 remaining + 0 done = 2.9 h a unit
    const bar = row(j, crew, 0, 2, {
      booked: [{ day: '2026-09-11', qty: 5, hours: 5 * 2.9 }],
    });
    const loads = boardDayLoads([bar], crew, FRI, 4, MON);

    expect(loads[0].actual).toBe(true);
    expect(loads[0].hours).toBeCloseTo(14.5, 6);
    expect(loads[0].pct).toBeCloseTo(100, 6);
    // …while the days ahead still read as plan.
    expect(loads[3].actual).toBe(false);
  });

  it('reads an unbooked day as nothing done, not as the plan', () => {
    // The bar covers the Friday, but nobody entered any output against it.
    const loads = boardDayLoads([row(job('A', 29), crew, 0, 2)], crew, FRI, 4, MON);
    expect(loads[0].hours).toBe(0);
    expect(loads[0].pct).toBe(0);
  });

  it('treats the first column as today when the board is not looking back', () => {
    const loads = boardDayLoads([], crew, MON, 2);
    expect(loads[0].isToday).toBe(true);
    expect(loads[0].past).toBe(false);
  });
});

describe('lineLoad', () => {
  it('totals the remaining hours and how long the crew needs', () => {
    const [a, b] = [worker('W1'), worker('W2')];
    // 29 h + 14.5 h = 43.5 h; two distinct people = 14.5 h/day.
    const load = lineLoad([
      row(job('A', 29), [a, b], 0, 2),
      row(job('B', 14.5), [a], 0, 2),
    ]);
    expect(load.hours).toBeCloseTo(43.5, 6);
    expect(load.crew).toBe(2);
    expect(load.capacityPerDay).toBeCloseTo(14.5, 6);
    expect(load.daysOfWork).toBeCloseTo(3, 6);
    expect(load.needsCrew).toBe(0);
  });

  it('has no completion date and counts the orders with nobody on them', () => {
    const load = lineLoad([row(job('A', 29), [], 0, 2)]);
    expect(load.hours).toBeCloseTo(29, 6);
    expect(load.crew).toBe(0);
    expect(load.daysOfWork).toBeNull();
    expect(load.needsCrew).toBe(1);
  });

  it('does not ask the PMD context row for a crew it never has', () => {
    const load = lineLoad([row(job('A', 29), [], 0, 2, { line: PMD })]);
    expect(load.hours).toBeCloseTo(29, 6);
    expect(load.needsCrew).toBe(0);
  });
});
