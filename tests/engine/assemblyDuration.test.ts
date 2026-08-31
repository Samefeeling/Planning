import { describe, it, expect } from 'vitest';
import {
  completedFraction,
  crewNeededFor,
  dailyTargetQty,
  durationDays,
  remainingHours,
} from '@/engine/assembly/duration';
import {
  MAX_WORKERS_PER_ORDER,
  PRODUCTIVE_HOURS_PER_PERSON,
} from '@/domain/assembly';
import { JobId, PartId } from '@/domain/ids';
import type { Job } from '@/domain/types';

const job = (laborHrs: number, remaining: number, done = 0): Job => ({
  id: JobId('ASM1'),
  department: 'assembly',
  partNum: PartId('X'),
  description: '',
  remainingQty: remaining,
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
  predecessor: null,
  assignedWorkers: [],
});

describe('assembly duration', () => {
  it('halves the duration when the crew doubles', () => {
    const j = job(29, 60);
    const one = durationDays(j, 1)!;
    const two = durationDays(j, 2)!;
    expect(two).toBeCloseTo(one / 2);
    expect(one).toBeCloseTo(29 / PRODUCTIVE_HOURS_PER_PERSON);
  });

  it('cannot be scheduled with nobody on it', () => {
    expect(durationDays(job(29, 60), 0)).toBeNull();
  });

  it('ignores crew beyond the four-person cap', () => {
    const j = job(40, 100);
    expect(durationDays(j, 9)).toBeCloseTo(
      durationDays(j, MAX_WORKERS_PER_ORDER)!,
    );
  });

  it('shrinks the remaining work as output is booked', () => {
    // 40 of 100 done → 60% of the hours left.
    const j = job(50, 60, 40);
    expect(completedFraction(j)).toBeCloseTo(0.4);
    expect(remainingHours(j)).toBeCloseTo(30);
  });

  it('is finished when nothing is left', () => {
    const j = job(50, 0, 100);
    expect(remainingHours(j)).toBe(0);
    expect(durationDays(j, 2)).toBe(0);
  });

  it('derives the daily target from the crew', () => {
    const j = job(29, 60);
    const perDay = dailyTargetQty(j, 2);
    const days = durationDays(j, 2)!;
    expect(perDay * days).toBeCloseTo(60);
  });

  it('says how many people would hit a deadline', () => {
    const j = job(29, 60); // ~4 person-days of work
    expect(crewNeededFor(j, 4)).toBe(1);
    expect(crewNeededFor(j, 1)).toBe(4);
    // Not reachable inside the cap.
    expect(crewNeededFor(job(200, 400), 1)).toBeNull();
  });
});
