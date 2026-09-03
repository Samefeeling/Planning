import { useLayoutEffect, useState, type RefObject } from 'react';
import type { OrderRow } from '@/engine/assembly/board';

interface Point {
  x: number;
  y: number;
}

interface Arrow {
  key: string;
  path: string;
}

/** Orthogonal finish-to-start route, including the case where dates overlap. */
export function dependencyPath(from: Point, to: Point): string {
  const routeX =
    to.x >= from.x + 24
      ? from.x + (to.x - from.x) / 2
      : Math.max(from.x, to.x) + 18;
  return `M ${from.x} ${from.y} H ${routeX} V ${to.y} H ${to.x}`;
}

export function DependencyArrows({
  root,
  rows,
}: {
  root: RefObject<HTMLDivElement | null>;
  rows: OrderRow[];
}) {
  const [drawing, setDrawing] = useState({
    width: 0,
    height: 0,
    arrows: [] as Arrow[],
  });

  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    let frame = 0;

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const bars = new Map<string, HTMLElement>();
      host.querySelectorAll<HTMLElement>('[data-job-id]').forEach((bar) => {
        const jobId = bar.dataset.jobId;
        if (jobId) bars.set(jobId, bar);
      });
      const arrows: Arrow[] = [];
      for (const row of rows) {
        const childId = String(row.job.id);
        const child = bars.get(childId);
        if (!child) continue;
        const childRect = child.getBoundingClientRect();
        for (const dependency of row.predecessors) {
          const parentId = String(dependency.onJobId);
          const parent = bars.get(parentId);
          if (!parent) continue;
          const parentRect = parent.getBoundingClientRect();
          arrows.push({
            key: `${parentId}->${childId}`,
            path: dependencyPath(
              {
                x: parentRect.right - hostRect.left,
                y: parentRect.top - hostRect.top + parentRect.height / 2,
              },
              {
                x: childRect.left - hostRect.left,
                y: childRect.top - hostRect.top + childRect.height / 2,
              },
            ),
          });
        }
      }
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
      .querySelectorAll<HTMLElement>('[data-job-id]')
      .forEach((bar) => observer.observe(bar));
    window.addEventListener('resize', queueMeasure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', queueMeasure);
    };
  }, [root, rows]);

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
          <path d="M 0 0 L 7 3.5 L 0 7 z" />
        </marker>
      </defs>
      {drawing.arrows.map((arrow) => (
        <path
          key={arrow.key}
          className="dependency-arrow"
          d={arrow.path}
          markerEnd="url(#dependency-arrowhead)"
        />
      ))}
    </svg>
  );
}
