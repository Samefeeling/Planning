import { describe, expect, it } from 'vitest';
import {
  dependencyFocus,
  routeDependencies,
  type DependencyEdge,
  type RouteRect,
} from '@/features/assembly/dependencyRouter';

const rect = (
  id: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
): RouteRect => ({ id, left, top, right, bottom });

const edge = (
  key: string,
  source: RouteRect,
  target: RouteRect,
): DependencyEdge => ({
  key,
  sourceId: source.id,
  targetId: target.id,
  source,
  target,
});

describe('recursive dependency focus', () => {
  const chain = [
    { key: 'A-B', sourceId: 'A', targetId: 'B' },
    { key: 'B-C', sourceId: 'B', targetId: 'C' },
    { key: 'C-D', sourceId: 'C', targetId: 'D' },
    { key: 'D-E', sourceId: 'D', targetId: 'E' },
    { key: 'X-Y', sourceId: 'X', targetId: 'Y' },
  ];

  it('finds every parent and child beyond two levels', () => {
    const focus = dependencyFocus(chain, 'C');
    expect([...focus.edgeKeys].sort()).toEqual(['A-B', 'B-C', 'C-D', 'D-E']);
    expect([...focus.nodeIds].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('terminates safely if malformed data contains a cycle', () => {
    const focus = dependencyFocus(
      [...chain, { key: 'E-B', sourceId: 'E', targetId: 'B' }],
      'C',
    );
    expect(focus.edgeKeys.has('E-B')).toBe(true);
    expect(focus.nodeIds.size).toBe(5);
  });
});

describe('dependency route allocation', () => {
  it('chooses a vertical channel outside an intervening order block', () => {
    const source = rect('A', 0, 0, 20, 20);
    const target = rect('B', 180, 100, 220, 120);
    const obstacle = rect('BLOCK', 90, 35, 110, 80);
    const [route] = routeDependencies(
      [edge('A-B', source, target)],
      [source, target, obstacle],
      { minX: 0, maxX: 240 },
    );
    expect(
      route.channelX <= obstacle.left - 6 ||
        route.channelX >= obstacle.right + 6,
    ).toBe(true);
    expect(route.path.startsWith('M 10 20 V')).toBe(true);
    expect(route.path.endsWith('H 180')).toBe(true);
  });

  it('spreads parallel trunks over separate channels', () => {
    const source = rect('A', 0, 0, 20, 20);
    const target = rect('B', 180, 100, 220, 120);
    const routes = routeDependencies(
      [edge('one', source, target), edge('two', source, target)],
      [source, target],
      { minX: 0, maxX: 240 },
    );
    expect(routes).toHaveLength(2);
    expect(routes[0].channelX).not.toBe(routes[1].channelX);
  });
});
