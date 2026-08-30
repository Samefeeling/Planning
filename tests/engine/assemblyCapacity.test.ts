import { describe, it, expect } from 'vitest';
import { areaLoad, availableHours } from '@/engine/assembly/capacity';
import { PRODUCTIVE_HOURS_PER_PERSON } from '@/domain/assembly';
import { JobId, PartId } from '@/domain/ids';
import type { Job } from '@/domain/types';

const job = (laborHrs: number): Job => ({
  id: JobId(`J${laborHrs}`),
  department: 'assembly',
  partNum: PartId('X'),
  description: '',
  remainingQty: 1,
  qtyPerHr: 1,
  laborHrs,
  dueDate: null,
  reqBy: null,
  released: true,
  priority: 3,
  materialPrep: 'ready',
  tool: null,
  preferredMachine: null,
  productType: 'A',
  currentStage: 'general-assembly',
});

describe('area capacity', () => {
  it('converts crew size into productive people-hours', () => {
    expect(availableHours(4)).toBeCloseTo(4 * PRODUCTIVE_HOURS_PER_PERSON);
    expect(availableHours(0)).toBe(0);
    expect(availableHours(-3)).toBe(0);
  });

  it('sums standard hours as the planned load', () => {
    const load = areaLoad([job(4), job(6)], 2);
    expect(load.plannedHours).toBe(10);
    expect(load.availableHours).toBeCloseTo(2 * PRODUCTIVE_HOURS_PER_PERSON);
  });

  it('flags an over-committed area', () => {
    // 3 people ≈ 21.75 h; 40 h queued is well over.
    const load = areaLoad([job(40)], 3);
    expect(load.level).toBe('over');
    expect(load.loadPct).toBeGreaterThan(100);
    expect(load.daysOfWork).toBeGreaterThan(1);
  });

  it('flags an under-committed area', () => {
    const load = areaLoad([job(2)], 4); // 2 h against ~29 h
    expect(load.level).toBe('under');
  });

  it('reads as idle when nothing is queued', () => {
    expect(areaLoad([], 5).level).toBe('idle');
  });

  it('treats queued work with no crew as over-committed, not idle', () => {
    const load = areaLoad([job(8)], 0);
    expect(load.level).toBe('over');
    expect(load.availableHours).toBe(0);
    expect(load.loadPct).toBe(0); // undefined ratio, reported as 0
  });
});
