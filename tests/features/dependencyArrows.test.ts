import { describe, expect, it } from 'vitest';
import { dependencyPath } from '@/features/assembly/DependencyArrows';

describe('dependency arrows', () => {
  it('routes forward from predecessor finish to successor start', () => {
    expect(dependencyPath({ x: 100, y: 20 }, { x: 200, y: 60 })).toBe(
      'M 100 20 H 150 V 60 H 200',
    );
  });

  it('routes around overlapping dates instead of drawing through the bars', () => {
    expect(dependencyPath({ x: 200, y: 20 }, { x: 140, y: 60 })).toBe(
      'M 200 20 H 218 V 60 H 140',
    );
  });
});
