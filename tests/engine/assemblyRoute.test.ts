import { describe, it, expect } from 'vitest';
import {
  areaForJob,
  isFinalStage,
  nextStage,
  routeFor,
  stageIndex,
} from '@/engine/assembly/route';
import { AREA_A, AREA_B, AREA_C, AREA_SHARED } from '@/domain/assembly';
import type { ProductType, StageId } from '@/domain/assembly';
import { JobId, PartId } from '@/domain/ids';
import type { Job } from '@/domain/types';

const job = (
  productType: ProductType | null,
  currentStage: StageId | null,
): Job => ({
  id: JobId('ASM1'),
  department: 'assembly',
  partNum: PartId('X'),
  description: '',
  remainingQty: 10,
  qtyPerHr: 2,
  laborHrs: 5,
  dueDate: null,
  reqBy: null,
  released: true,
  priority: 3,
  materialPrep: 'ready',
  tool: null,
  preferredMachine: null,
  productType,
  currentStage,
});

describe('assembly routes', () => {
  it('gives A a single general-assembly stage', () => {
    expect(routeFor('A')).toEqual(['general-assembly']);
  });

  it('gives B three stages and C three stages', () => {
    expect(routeFor('B')).toEqual([
      'cutting-sewing',
      'frame-foam',
      'upholstery-final',
    ]);
    expect(routeFor('C')).toEqual([
      'cutting-sewing',
      'chair-upholstery',
      'final-assembly',
    ]);
  });

  it('returns an empty route for an unknown product type', () => {
    expect(routeFor(null)).toEqual([]);
  });

  it('locates the current stage in the route', () => {
    expect(stageIndex(job('B', 'frame-foam'))).toBe(1);
    expect(stageIndex(job('B', 'chair-upholstery'))).toBe(-1); // not on B's route
    expect(stageIndex(job('B', null))).toBe(-1);
  });

  it('advances through the route and stops at the end', () => {
    expect(nextStage(job('C', 'cutting-sewing'))).toBe('chair-upholstery');
    expect(nextStage(job('C', 'chair-upholstery'))).toBe('final-assembly');
    expect(nextStage(job('C', 'final-assembly'))).toBeNull();
    expect(isFinalStage(job('C', 'final-assembly'))).toBe(true);
    expect(isFinalStage(job('C', 'cutting-sewing'))).toBe(false);
  });

  it('maps each stage to the area that runs it', () => {
    expect(areaForJob(job('B', 'cutting-sewing'))).toBe(AREA_SHARED);
    expect(areaForJob(job('B', 'frame-foam'))).toBe(AREA_B);
    expect(areaForJob(job('C', 'chair-upholstery'))).toBe(AREA_C);
    expect(areaForJob(job('A', 'general-assembly'))).toBe(AREA_A);
    // Final assembly defaults to A; the supervisor may move it to C.
    expect(areaForJob(job('C', 'final-assembly'))).toBe(AREA_A);
  });

  it('falls back to the route head, then to general assembly', () => {
    expect(areaForJob(job('B', null))).toBe(AREA_SHARED); // head of B's route
    expect(areaForJob(job(null, null))).toBe(AREA_A); // nothing known
  });
});
