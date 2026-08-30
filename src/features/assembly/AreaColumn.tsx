/**
 * One assembly area column: crew stepper, people-hours load, and the orders
 * queued there. Dropping an order in re-assigns it to that area.
 */

import { useDroppable } from '@dnd-kit/core';
import type { AreaColumnView } from '@/engine/assembly/board';
import { usePlanStore } from '@/store/planStore';
import { LoadMeter } from './LoadMeter';
import { OrderCard } from './OrderCard';

export function AreaColumn({
  column,
  selectedJobId,
  onSelect,
}: {
  column: AreaColumnView;
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
}) {
  const { area, orders, load } = column;
  const { setNodeRef, isOver } = useDroppable({
    id: String(area.id),
    data: { type: 'area', areaId: String(area.id) },
  });
  const setHeadcount = usePlanStore((s) => s.setAreaHeadcount);

  const suggested = area.suggested;
  const offSuggestion =
    suggested &&
    (load.headcount < suggested.min || load.headcount > suggested.max);

  return (
    <section className={`area ${isOver ? 'drop-active' : ''}`}>
      <header className="area-head">
        <div className="area-title">
          <span className="area-name">{area.short ?? area.name}</span>
          <span className="area-count">{orders.length}</span>
        </div>

        <div className="crew">
          <button
            className="mini"
            aria-label="Remove one person"
            disabled={load.headcount <= 0}
            onClick={() => setHeadcount(area.id, load.headcount - 1)}
          >
            −
          </button>
          <span
            className={`crew-n ${offSuggestion ? 'off' : ''}`}
            title={
              suggested
                ? `Suggested crew ${suggested.min}–${suggested.max}`
                : undefined
            }
          >
            👥 {load.headcount}
          </span>
          <button
            className="mini"
            aria-label="Add one person"
            onClick={() => setHeadcount(area.id, load.headcount + 1)}
          >
            +
          </button>
        </div>

        <LoadMeter load={load} />
      </header>

      <div ref={setNodeRef} className="area-list">
        {orders.length === 0 ? (
          <div className="area-empty">Drag an order here</div>
        ) : (
          orders.map((o) => (
            <OrderCard
              key={String(o.job.id)}
              order={o}
              selected={selectedJobId === String(o.job.id)}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  );
}
