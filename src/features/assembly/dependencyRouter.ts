export interface RoutePoint {
  x: number;
  y: number;
}

export interface RouteRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DependencyEdge {
  key: string;
  sourceId: string;
  targetId: string;
  source: RouteRect;
  target: RouteRect;
}

export interface RoutedDependency extends DependencyEdge {
  channelX: number;
  points: RoutePoint[];
  path: string;
}

export interface DependencyFocus {
  edgeKeys: Set<string>;
  nodeIds: Set<string>;
}

interface GraphEdge {
  key: string;
  sourceId: string;
  targetId: string;
}

/**
 * Every ancestor and descendant of one job, found iteratively so a deep BOM
 * cannot exhaust the call stack. The visited sets also make bad cyclic data
 * harmless even though the data engine normally removes cycles first.
 */
export function dependencyFocus(
  edges: readonly GraphEdge[],
  focusId: string | null,
): DependencyFocus {
  const edgeKeys = new Set<string>();
  const nodeIds = new Set<string>();
  if (!focusId) return { edgeKeys, nodeIds };
  nodeIds.add(focusId);

  const incoming = new Map<string, GraphEdge[]>();
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const ins = incoming.get(edge.targetId) ?? [];
    ins.push(edge);
    incoming.set(edge.targetId, ins);
    const outs = outgoing.get(edge.sourceId) ?? [];
    outs.push(edge);
    outgoing.set(edge.sourceId, outs);
  }

  const walk = (
    adjacency: Map<string, GraphEdge[]>,
    next: (edge: GraphEdge) => string,
  ) => {
    const visited = new Set<string>();
    const pending = [focusId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const edge of adjacency.get(id) ?? []) {
        edgeKeys.add(edge.key);
        const related = next(edge);
        nodeIds.add(related);
        if (!visited.has(related)) pending.push(related);
      }
    }
  };
  walk(incoming, (edge) => edge.sourceId);
  walk(outgoing, (edge) => edge.targetId);
  return { edgeKeys, nodeIds };
}

interface Segment {
  a: RoutePoint;
  b: RoutePoint;
}

const segments = (points: RoutePoint[]): Segment[] =>
  points.slice(1).map((point, index) => ({ a: points[index], b: point }));

const between = (n: number, a: number, b: number): boolean =>
  n >= Math.min(a, b) && n <= Math.max(a, b);

const crossesRect = (segment: Segment, rect: RouteRect): boolean => {
  if (segment.a.x === segment.b.x) {
    return (
      between(segment.a.x, rect.left, rect.right) &&
      Math.max(Math.min(segment.a.y, segment.b.y), rect.top) <=
        Math.min(Math.max(segment.a.y, segment.b.y), rect.bottom)
    );
  }
  return (
    between(segment.a.y, rect.top, rect.bottom) &&
    Math.max(Math.min(segment.a.x, segment.b.x), rect.left) <=
      Math.min(Math.max(segment.a.x, segment.b.x), rect.right)
  );
};

const crossing = (a: Segment, b: Segment): boolean => {
  const aVertical = a.a.x === a.b.x;
  const bVertical = b.a.x === b.b.x;
  if (aVertical === bVertical) return false;
  const vertical = aVertical ? a : b;
  const horizontal = aVertical ? b : a;
  return (
    between(vertical.a.x, horizontal.a.x, horizontal.b.x) &&
    between(horizontal.a.y, vertical.a.y, vertical.b.y)
  );
};

const tidy = (n: number): number => Math.round(n * 10) / 10;

export const routePath = (points: RoutePoint[]): string => {
  const [first, ...rest] = points;
  return rest.reduce((path, point, index) => {
    const previous = points[index];
    return (
      path +
      (point.x === previous.x
        ? ` V ${tidy(point.y)}`
        : ` H ${tidy(point.x)}`)
    );
  }, `M ${tidy(first.x)} ${tidy(first.y)}`);
};

const pointsFor = (
  edge: DependencyEdge,
  channelX: number,
  clearance: number,
): RoutePoint[] => {
  const downward = edge.source.top <= edge.target.top;
  const sourceX = (edge.source.left + edge.source.right) / 2;
  const sourceY = downward ? edge.source.bottom : edge.source.top;
  const targetY = (edge.target.top + edge.target.bottom) / 2;
  const sourceGutter = downward
    ? edge.source.bottom + clearance
    : edge.source.top - clearance;
  const targetGutter = downward
    ? edge.target.top - clearance
    : edge.target.bottom + clearance;
  return [
    { x: sourceX, y: sourceY },
    { x: sourceX, y: sourceGutter },
    { x: channelX, y: sourceGutter },
    { x: channelX, y: targetGutter },
    { x: edge.target.left - clearance, y: targetGutter },
    { x: edge.target.left - clearance, y: targetY },
    { x: edge.target.left, y: targetY },
  ];
};

/**
 * Orthogonal obstacle-aware routing. It prefers the natural gap between jobs,
 * then the edges of visible obstacles, while spreading long parallel trunks
 * across separate channels. A white casing in the SVG handles the few
 * crossings that remain when the chart has no completely empty time column.
 */
export function routeDependencies(
  edges: readonly DependencyEdge[],
  obstacles: readonly RouteRect[],
  options: { clearance?: number; minX?: number; maxX?: number } = {},
): RoutedDependency[] {
  const clearance = options.clearance ?? 6;
  const minX = options.minX ?? 0;
  const maxX = options.maxX ?? Number.POSITIVE_INFINITY;
  const routed: RoutedDependency[] = [];
  const usedSegments: Segment[] = [];
  const usedChannels: number[] = [];

  const ordered = [...edges].sort(
    (a, b) =>
      Math.abs(b.target.top - b.source.top) -
        Math.abs(a.target.top - a.source.top) ||
      a.key.localeCompare(b.key),
  );
  for (const edge of ordered) {
    const naturalLeft = edge.source.right + clearance * 2;
    const naturalRight = edge.target.left - clearance * 2;
    const candidates = new Set<number>([
      naturalLeft,
      naturalRight,
      (naturalLeft + naturalRight) / 2,
    ]);
    for (const obstacle of obstacles) {
      candidates.add(obstacle.left - clearance * 2);
      candidates.add(obstacle.right + clearance * 2);
    }

    let best: { channel: number; points: RoutePoint[]; score: number } | null = null;
    for (const raw of candidates) {
      const channel = Math.max(minX, Math.min(raw, maxX));
      const points = pointsFor(edge, channel, clearance);
      const pathSegments = segments(points);
      const blocked = obstacles
        .filter(
          (obstacle) =>
            obstacle.id !== edge.sourceId && obstacle.id !== edge.targetId,
        )
        .reduce(
          (count, obstacle) => {
            const padded = {
              ...obstacle,
              left: obstacle.left - clearance,
              top: obstacle.top - clearance,
              right: obstacle.right + clearance,
              bottom: obstacle.bottom + clearance,
            };
            return (
              count +
              pathSegments.filter((segment) => crossesRect(segment, padded)).length
            );
          },
          0,
        );
      const crossings = pathSegments.reduce(
        (count, segment) =>
          count + usedSegments.filter((used) => crossing(segment, used)).length,
        0,
      );
      const channelPenalty = usedChannels.reduce((penalty, used) => {
        const gap = Math.abs(channel - used);
        return penalty + (gap < clearance * 2 ? (clearance * 2 - gap) * 40 : 0);
      }, 0);
      const length = pathSegments.reduce(
        (sum, segment) =>
          sum + Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y),
        0,
      );
      const score = blocked * 100_000 + crossings * 800 + channelPenalty + length;
      if (!best || score < best.score) best = { channel, points, score };
    }
    if (!best) continue;
    const result: RoutedDependency = {
      ...edge,
      channelX: best.channel,
      points: best.points,
      path: routePath(best.points),
    };
    routed.push(result);
    usedChannels.push(best.channel);
    usedSegments.push(...segments(best.points));
  }
  return routed;
}
