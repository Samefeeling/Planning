import { useLayoutEffect, useState, type RefObject } from 'react';
import type { OrderRow } from '@/engine/assembly/board';
import type { DependencyDisplayMode } from '@/store/uiStore';
import {
  dependencyFocus,
  routeDependencies,
  type DependencyEdge,
  type RouteRect,
  type RoutedDependency,
} from './dependencyRouter';

interface Drawing {
  width: number;
  height: number;
  arrows: (RoutedDependency & { focused: boolean })[];
}

const EMPTY: Drawing = { width: 0, height: 0, arrows: [] };

const boxOf = (
  element: HTMLElement,
  host: DOMRect,
  id: string,
): RouteRect => {
  const box = element.getBoundingClientRect();
  return {
    id,
    left: box.left - host.left,
    top: box.top - host.top,
    right: box.right - host.left,
    bottom: box.bottom - host.top,
  };
};

export function DependencyArrows({
  root,
  rows,
  mode,
  focusJobId,
}: {
  root: RefObject<HTMLDivElement | null>;
  rows: OrderRow[];
  mode: DependencyDisplayMode;
  focusJobId: string | null;
}) {
  const [drawing, setDrawing] = useState<Drawing>(EMPTY);

  useLayoutEffect(() => {
    const host = root.current;
    if (!host || mode === 'off') {
      setDrawing(EMPTY);
      return;
    }
    let frame = 0;

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const bars = new Map<string, RouteRect>();
      const obstacles: RouteRect[] = [];
      host.querySelectorAll<HTMLElement>('[data-job-id]').forEach((element) => {
        const id = element.dataset.jobId;
        if (!id) return;
        const box = boxOf(element, hostRect, id);
        bars.set(id, box);
        obstacles.push(box);
      });
      // Only outside labels need their own obstacle; an inside label is already
      // protected by its bar rectangle.
      host
        .querySelectorAll<HTMLElement>('.bar.tagged [data-job-label]')
        .forEach((element) => {
          const id = element.dataset.jobLabel;
          if (id) obstacles.push(boxOf(element, hostRect, `${id}:label`));
        });

      const edges: DependencyEdge[] = [];
      for (const row of rows) {
        const targetId = String(row.job.id);
        const target = bars.get(targetId);
        if (!target) continue;
        for (const dependency of row.predecessors) {
          const sourceId = String(dependency.onJobId);
          const source = bars.get(sourceId);
          if (!source) continue;
          edges.push({
            key: `${sourceId}->${targetId}`,
            sourceId,
            targetId,
            source,
            target,
          });
        }
      }

      // Iterative traversal expands every ancestor and descendant, not just
      // the first two levels visible around the selected job.
      const focus = dependencyFocus(edges, focusJobId);
      const visible =
        mode === 'all'
          ? edges
          : edges.filter((edge) => focus.edgeKeys.has(edge.key));
      const left = bars.size > 0
        ? Math.min(...[...bars.values()].map((bar) => bar.left))
        : 0;
      const arrows = routeDependencies(visible, obstacles, {
        minX: left + 2,
        maxX: host.scrollWidth - 8,
      }).map((arrow) => ({
        ...arrow,
        focused: mode === 'focus' || focus.edgeKeys.has(arrow.key),
      }));
      setDrawing({
        width: host.scrollWidth,
        height: host.scrollHeight,
        arrows,
      });
    };
    const queueMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    queueMeasure();
    const observer = new ResizeObserver(queueMeasure);
    observer.observe(host);
    host
      .querySelectorAll<HTMLElement>('[data-job-id], [data-job-label]')
      .forEach((element) => observer.observe(element));
    window.addEventListener('resize', queueMeasure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', queueMeasure);
    };
  }, [focusJobId, mode, root, rows]);

  if (drawing.arrows.length === 0) return null;
  return (
    <svg
      className="dependency-layer"
      width={drawing.width}
      height={drawing.height}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="dependency-arrowhead"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path className="dependency-marker" d="M 0 0 L 7 3.5 L 0 7 z" />
        </marker>
        <marker
          id="dependency-arrowhead-focus"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path className="dependency-marker-focus" d="M 0 0 L 7 3.5 L 0 7 z" />
        </marker>
      </defs>
      {drawing.arrows.map((arrow) => (
        <g
          key={arrow.key}
          className={`dependency-link ${arrow.focused ? 'focused' : ''}`}
        >
          <path className="dependency-casing" d={arrow.path} />
          <path
            className="dependency-arrow"
            d={arrow.path}
            markerEnd={
              arrow.focused
                ? 'url(#dependency-arrowhead-focus)'
                : 'url(#dependency-arrowhead)'
            }
          />
        </g>
      ))}
    </svg>
  );
}
