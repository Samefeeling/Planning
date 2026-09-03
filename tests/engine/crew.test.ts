/**
 * A first crew for an imported export.
 *
 * `Planning1.csv` never says who builds an order, so the whole board arrives
 * unstaffed — and an unstaffed order has no bar. This fills the gaps without
 * ever touching an allocation somebody has already made.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MockSource } from '@/data/mock/MockSource';
import { buildIndexes } from '@/engine/indexes';
import { computeAssemblyGantt, type OrderRow } from '@/engine/assembly/board';
import {
  clashesFor,
  preferredCrewOrder,
  suggestCrew,
} from '@/engine/assembly/crew';
import {
  addDays,
  nextWorkingDay,
  prevWorkingDay,
  startOfDay,
} from '@/engine/assembly/dates';
import { usePlanStore } from '@/store/planStore';
import {
  MAX_WORKERS_PER_ORDER,
  canWorkKind,
  type Worker,
} from '@/domain/assembly';
import { WorkerId } from '@/domain/ids';
import type { PlanningDataset } from '@/domain/types';

let dataset: PlanningDataset;

beforeAll(async () => {
  const result = await new MockSource().loadAll();
  if (!result.ok) throw new Error(result.error);
  dataset = result.value;
});

const TODAY = new Date('2026-09-11T00:00:00');

/** The board as it comes off an import: orders on lines, nobody on them. */
function board(
  orderWorkers: Record<string, string[]> = {},
  orderStarts: Record<string, string> = {},
) {
  const indexes = buildIndexes(dataset);
  usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
  return computeAssemblyGantt({
    dataset,
    indexes,
    containers: usePlanStore.getState().containers,
    orderWorkers,
    orderStarts,
    progress: {},
    production: {},
    workers: dataset.workers,
    today: TODAY,
  });
}

/**
 * How the button uses it: each wave is applied *on top of* the plan as it
 * stands and the board re-derived, so every span after the first is one the
 * scheduler worked out rather than one the suggestion guessed.
 */
const settleOn =
  (base: Record<string, string[]> = {}) =>
  (alloc: Record<string, string[]>) =>
    board({ ...base, ...alloc });
const settle = settleOn();

describe('suggestCrew', () => {
  it('gives every unstaffed order somebody who can do the work', () => {
    const b = board();
    const { allocations, staffed } = suggestCrew(b, settle);

    expect(staffed).toBeGreaterThan(10);
    const byId = new Map(b.workers.map((w) => [String(w.id), w]));
    for (const group of b.groups) {
      if (!group.line.schedulable) continue;
      for (const row of group.rows) {
        const crew = allocations[String(row.job.id)];
        if (!crew) continue;
        expect(crew.length).toBeGreaterThan(0);
        expect(crew.length).toBeLessThanOrEqual(MAX_WORKERS_PER_ORDER);
        expect(new Set(crew).size).toBe(crew.length); // nobody twice
        for (const id of crew) {
          const w = byId.get(id)!;
          expect(w.onShift).toBe(true);
          expect(w.skills).toContain(group.line.key);
        }
      }
    }
  });

  it('turns an unschedulable board into a scheduled one', () => {
    const before = board();
    const bare = [...before.rowsByJob.values()].filter((r) => r.days === null);
    expect(bare.length).toBeGreaterThan(0); // nothing has a bar yet

    const after = board(suggestCrew(before, settle).allocations);
    const scheduled = [...after.rowsByJob.values()].filter((r) => r.days !== null);
    // Most of the board gets a bar. What it cannot place without putting
    // somebody on two orders at once it leaves alone, on purpose.
    expect(scheduled.length).toBeGreaterThan(bare.length / 2);
    for (const row of scheduled) expect(row.expectDate).not.toBeNull();
  });

  it('does not double-book anyone, measured on the board it produces', () => {
    // The suggestion is made against spans it works out itself; this checks
    // them against the schedule that actually comes back.
    const before = board();
    const after = board(suggestCrew(before, settle).allocations);
    const rows = [...after.rowsByJob.values()].filter(
      (r) => r.start && r.expectDate && !r.completedToday,
    );

    const clashes: string[] = [];
    for (const row of rows) {
      for (const w of row.workers) {
        for (const other of clashesFor(rows, row, String(w.id))) {
          clashes.push(
            `${w.name}: ${String(row.job.id)} vs ${String(other.job.id)}`,
          );
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('leaves an allocation the supervisor already made', () => {
    const b = board();
    const first = String(
      b.groups.find((g) => g.line.schedulable)!.rows[0].job.id,
    );
    const mine = { [first]: ['W01'] };

    const { allocations } = suggestCrew(board(mine), settleOn(mine));
    expect(allocations[first]).toBeUndefined();
  });

  it('moves a team on to the next order once they are free', () => {
    // Reusing people is right — that is what a team is. The rule is about the
    // same *day*, not the same names, and the clash test above holds them to
    // it. What must not happen is one person carrying the whole line.
    const b = board();
    const { allocations } = suggestCrew(b, settle);
    const jobsPerPerson = new Map<string, number>();
    for (const crew of Object.values(allocations)) {
      for (const id of crew) {
        jobsPerPerson.set(id, (jobsPerPerson.get(id) ?? 0) + 1);
      }
    }

    expect(jobsPerPerson.size).toBeGreaterThan(4); // the work is spread about
    const counts = [...jobsPerPerson.values()].sort((x, y) => y - x);
    // Nobody is carrying more than twice the average.
    const average =
      counts.reduce((s, n) => s + n, 0) / Math.max(1, counts.length);
    expect(counts[0]).toBeLessThanOrEqual(Math.ceil(average * 2));
  });

  it('counts the orders it cannot crew instead of inventing one', () => {
    // Nobody in today: every order is left alone and reported.
    const noRoster = { ...dataset, workers: dataset.workers.map((w) => ({ ...w, onShift: false })) };
    const indexes = buildIndexes(noRoster);
    const b = computeAssemblyGantt({
      dataset: noRoster,
      indexes,
      containers: usePlanStore.getState().containers,
      orderWorkers: {},
      orderStarts: {},
      progress: {},
      production: {},
      workers: noRoster.workers,
      today: TODAY,
    });

    const { allocations, staffed, unstaffed } = suggestCrew(b, settle);
    expect(allocations).toEqual({});
    expect(staffed).toBe(0);
    expect(unstaffed).toBeGreaterThan(0);
  });
});

describe('nobody does two jobs at once', () => {
  /** The row for one order, once the board has scheduled it. */
  const rowOf = (b: ReturnType<typeof board>, id: string) => b.rowsByJob.get(id)!;
  const allRows = (b: ReturnType<typeof board>) =>
    b.groups.flatMap((g) => g.rows);

  /**
   * Two orders on the same line that do not wait for each other — one of them
   * needing a component the other builds would hold it back for a reason that
   * has nothing to do with the crew.
   */
  const twoOrders = (line: 'UPL' | 'ASSY' | 'TABLE') => {
    const b = board();
    const rows = b.groups.find((g) => g.line.key === line)!.rows;
    const first = rows[0];
    const linked = (a: OrderRow, other: OrderRow) =>
      a.predecessors.some((d) => String(d.onJobId) === String(other.job.id));
    const second = rows.find(
      (r) =>
        String(r.job.id) !== String(first.job.id) &&
        r.predecessors.length === 0 &&
        !linked(first, r),
    );
    expect(second).toBeDefined();
    return [String(first.job.id), String(second!.job.id)] as const;
  };

  it('sees the clash when someone is put on an order running at the same time', () => {
    const [first, second] = twoOrders('UPL');
    // Both pinned to the same Monday, so whatever else happens their bars
    // cover the same days.
    const day = new Date('2026-09-14T00:00:00').toISOString();
    const b = board({ [first]: ['W01'] }, { [first]: day, [second]: day });

    // Nothing else moved them, so they really are on the same days.
    expect(rowOf(b, second).plannedStart).toEqual(new Date(day));
    const clashes = clashesFor(allRows(b), rowOf(b, second), 'W01');
    expect(clashes.map((r) => String(r.job.id))).toEqual([first]);
  });

  it('says nothing about someone who is free across those days', () => {
    const [first] = twoOrders('UPL');
    const b = board({ [first]: ['W01'] });
    // W03 is on nothing at all.
    expect(clashesFor(allRows(b), rowOf(b, first), 'W03')).toEqual([]);
  });

  it('does not count an order against itself', () => {
    const [first] = twoOrders('UPL');
    const b = board({ [first]: ['W01'] });
    const clashes = clashesFor(allRows(b), rowOf(b, first), 'W01');
    expect(clashes.map((r) => String(r.job.id))).not.toContain(first);
  });

  it('answers for an order nobody is on yet', () => {
    // The whole point: the supervisor is deciding *who* to put on it, so the
    // check has to work before anyone is on it.
    const [first, second] = twoOrders('UPL');
    const b = board({ [first]: ['W01'] });
    expect(rowOf(b, second).start).toBeNull(); // no crew, no bar
    expect(rowOf(b, second).plannedStart).toBeInstanceOf(Date);
    // Whatever the answer, it is computed rather than skipped.
    expect(Array.isArray(clashesFor(allRows(b), rowOf(b, second), 'W01'))).toBe(
      true,
    );
  });

  it('lets bars that merely touch pass', () => {
    // One ending exactly as the next begins is a hand-over, not a clash, so
    // the boundary is tested exactly rather than hoping the seed lines up.
    const [first, second] = twoOrders('UPL');
    const b = board({ [first]: ['W01'] });
    const done = rowOf(b, first).expectDate!;
    // The board plans in whole shifts, so the hand-over is the next shift
    // going: a bar finishing mid-afternoon still owns the whole of that day,
    // and anything starting on it would be a second full shift.
    const handover = nextWorkingDay(
      done.getTime() === startOfDay(done).getTime()
        ? done
        : startOfDay(addDays(done, 1)),
    );
    const after = { ...rowOf(b, second), plannedStart: handover, workers: [] };

    expect(clashesFor([rowOf(b, first), after], after, 'W01')).toEqual([]);
    // …and the shift before it is a clash.
    const overlapping = {
      ...after,
      plannedStart: prevWorkingDay(handover),
    };
    expect(
      clashesFor([rowOf(b, first), overlapping], overlapping, 'W01'),
    ).toHaveLength(1);
  });

  it('ignores an order that has been closed', () => {
    const [first] = twoOrders('UPL');
    const b = board({ [first]: ['W01'] });
    const closed = allRows(b).map((r) =>
      String(r.job.id) === first ? { ...r, completedToday: true } : r,
    );
    const other = closed.find(
      (r) => r.line.key === 'UPL' && String(r.job.id) !== first,
    )!;
    expect(clashesFor(closed, other, 'W01')).toEqual([]);
  });
});

/**
 * Who gets reached for first. `ASSY_Operator` is a priority list — the row at
 * the top is the first name the supervisor wants — and the Skills column is
 * written in order, so a line someone has first is one they lead on.
 */
describe('preferredCrewOrder', () => {
  const person = (id: string, skills: Worker['skills']): Worker => ({
    id: WorkerId(id),
    name: id,
    skills,
    onShift: true,
  });

  it('takes whoever leads on the line before anyone helping out', () => {
    // Second in the list, but UPL is what they do; the first name is an ASSY
    // hand who can cover UPL.
    const roster = [person('cover', ['ASSY', 'UPL']), person('lead', ['UPL'])];
    const sorted = [...roster].sort(preferredCrewOrder(roster, 'UPL'));
    expect(sorted.map((w) => String(w.id))).toEqual(['lead', 'cover']);
  });

  it('reads the roster in the order it is written', () => {
    const roster = ['first', 'second', 'third'].map((id) => person(id, ['UPL']));
    const shuffled = [roster[2], roster[0], roster[1]];
    const sorted = shuffled.sort(preferredCrewOrder(roster, 'UPL'));
    expect(sorted.map((w) => String(w.id))).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('puts the top of the list on the first order it crews', () => {
    const b = board();
    const { allocations } = suggestCrew(b, settle);

    // The earliest order on each line should hold the highest-priority people
    // free to take it — which, with nothing booked yet, is the top of the list
    // *of those who work that bench*. A cutter is no use on a softie however
    // near the top of the roster they sit.
    for (const group of b.groups) {
      if (!group.line.schedulable) continue;
      const first = [...group.rows]
        .filter((row) => allocations[String(row.job.id)])
        .sort((a, c) => a.plannedStart.getTime() - c.plannedStart.getTime())[0];
      if (!first) continue;

      const qualified = b.workers.filter(
        (w) =>
          w.onShift &&
          w.skills.includes(group.line.key) &&
          canWorkKind(w, first.kind),
      );
      if (qualified.length === 0) continue;

      const crew = allocations[String(first.job.id)];
      const best = [...qualified]
        .sort(preferredCrewOrder(b.workers, group.line.key))
        .slice(0, crew.length)
        .map((w) => String(w.id));
      expect(crew).toEqual(best);
    }
  });
});
