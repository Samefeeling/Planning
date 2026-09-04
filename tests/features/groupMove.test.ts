import { describe, expect, it } from 'vitest';
import {
  planGroupMove,
  type MarkedMove,
} from '@/features/assembly/groupMove';

/** Mon 1 Sept 2025 is the Monday every case below counts from. */
const day = (date: string): string => new Date(`${date}T00:00:00`).toISOString();
const landed = (
  moves: { jobId: string; startISO: string }[],
): Record<string, string> =>
  Object.fromEntries(
    moves.map((move) => [
      move.jobId,
      new Date(move.startISO).toISOString().slice(0, 10),
    ]),
  );

const order = (
  jobId: string,
  start: string,
  floor: string | null = null,
): MarkedMove => ({ jobId, startISO: day(start), floorISO: floor && day(floor) });

describe('moving a marked set', () => {
  it('shifts every order by the same number of columns', () => {
    const moves = planGroupMove(
      [order('A', '2025-09-01'), order('B', '2025-09-03'), order('C', '2025-09-08')],
      2,
      false,
    );
    expect(landed(moves)).toEqual({
      A: '2025-09-03',
      B: '2025-09-05',
      C: '2025-09-10',
    });
  });

  it('counts columns rather than days when weekends are hidden', () => {
    // Thursday plus two working columns is the following Monday, not Saturday.
    expect(landed(planGroupMove([order('A', '2025-09-04')], 2, false))).toEqual({
      A: '2025-09-08',
    });
  });

  it('steps off a weekend a visible-weekend axis would have landed on', () => {
    // The column arithmetic includes Saturday when weekend columns are showing,
    // but nobody is in on Saturday and a bulk move is not where overtime gets
    // decided, so the bar opens on the Monday.
    expect(landed(planGroupMove([order('A', '2025-09-04')], 2, true))).toEqual({
      A: '2025-09-08',
    });
  });

  it('gives an empty set nothing to do', () => {
    expect(planGroupMove([], 3, false)).toEqual([]);
  });
});

describe('the earliest days the set may take', () => {
  it('butts the whole run up against today, keeping its spacing', () => {
    // Dragged a fortnight into the past. Moved one at a time the first two
    // would pile up on today and the run would come out shorter than it went in.
    const moves = planGroupMove(
      [
        order('A', '2025-09-15', '2025-09-08'),
        order('B', '2025-09-17', '2025-09-08'),
        order('C', '2025-09-19', '2025-09-08'),
      ],
      -10,
      false,
    );
    expect(landed(moves)).toEqual({
      A: '2025-09-08',
      B: '2025-09-10',
      C: '2025-09-12',
    });
  });

  it('moves the set only as far as its most constrained order can go', () => {
    // B waits on a press job outside the set that finishes on the 12th. The
    // drag asks for five columns earlier; B can only give three, so all of
    // them give three and the run holds its shape.
    const moves = planGroupMove(
      [order('A', '2025-09-15', '2025-09-01'), order('B', '2025-09-17', '2025-09-12')],
      -5,
      false,
    );
    expect(landed(moves)).toEqual({ A: '2025-09-10', B: '2025-09-12' });
  });

  it('refuses to move a set already hard against its wall', () => {
    // A is drawn on the day its predecessor finishes. Nothing in the set can
    // go earlier, so nothing does — rather than moving the others and leaving
    // the run in a shape nobody chose. Nothing is written either: pinning an
    // order that is not moving would still change how it runs.
    const moves = planGroupMove(
      [order('A', '2025-09-15', '2025-09-15'), order('B', '2025-09-18')],
      -3,
      false,
    );
    expect(moves).toEqual([]);
  });

  it('still gives ground where the wall is only part of the way over', () => {
    // B is held on the 17th, so the run can give one column of the two asked
    // for. Both take that one column and the gap between them is unchanged.
    const moves = planGroupMove(
      [order('A', '2025-09-16'), order('B', '2025-09-18', '2025-09-17')],
      -2,
      false,
    );
    expect(landed(moves)).toEqual({ A: '2025-09-15', B: '2025-09-17' });
  });

  it('lets a set held back from moving earlier still move later', () => {
    const moves = planGroupMove(
      [order('A', '2025-09-15', '2025-09-15'), order('B', '2025-09-18')],
      3,
      false,
    );
    expect(landed(moves)).toEqual({ A: '2025-09-18', B: '2025-09-23' });
  });

  it('leaves a set alone when every day it asks for is already legal', () => {
    const moves = planGroupMove(
      [order('A', '2025-09-15', '2025-09-01'), order('B', '2025-09-17', '2025-09-01')],
      1,
      false,
    );
    expect(landed(moves)).toEqual({ A: '2025-09-16', B: '2025-09-18' });
  });

  it('never lands anything on a Saturday or a Sunday', () => {
    for (let shift = -6; shift <= 6; shift++) {
      const moves = planGroupMove(
        [
          order('A', '2025-09-11', '2025-09-08'),
          order('B', '2025-09-12'),
          order('C', '2025-09-16'),
        ],
        shift,
        true,
      );
      for (const move of moves) {
        expect(new Date(move.startISO).getDay()).not.toBe(0);
        expect(new Date(move.startISO).getDay()).not.toBe(6);
      }
    }
  });
});
