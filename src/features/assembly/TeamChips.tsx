/**
 * The crew on an order. Up to four people; click a chip to take someone off,
 * "+" to add from the qualified people on shift.
 */

import { useState } from 'react';
import type { OrderRow } from '@/engine/assembly/board';
import type { Worker } from '@/domain/assembly';
import { MAX_WORKERS_PER_ORDER } from '@/domain/assembly';
import { usePlanStore } from '@/store/planStore';

export function TeamChips({
  row,
  roster,
}: {
  row: OrderRow;
  roster: Worker[];
}) {
  const [picking, setPicking] = useState(false);
  const assign = usePlanStore((s) => s.assignWorker);
  const unassign = usePlanStore((s) => s.unassignWorker);

  const onIt = new Set(row.workers.map((w) => String(w.id)));
  const full = row.workers.length >= MAX_WORKERS_PER_ORDER;

  /** Roster detail for the hover title: "Sewer · reports to Mei". */
  const detail = (w: Worker): string =>
    [w.position, w.supervisor && `reports to ${w.supervisor}`]
      .filter(Boolean)
      .join(' · ');

  // Only people who are in today and qualified for this line.
  const candidates = roster.filter(
    (w) =>
      w.onShift && w.skills.includes(row.line.key) && !onIt.has(String(w.id)),
  );

  return (
    <div className="team">
      {row.workers.map((w) => (
        <button
          key={String(w.id)}
          className="chip"
          title={[`${w.name} — click to remove`, detail(w)]
            .filter(Boolean)
            .join('\n')}
          onClick={(e) => {
            e.stopPropagation();
            unassign(row.job.id, String(w.id));
          }}
        >
          {w.name}
        </button>
      ))}

      {row.workers.length === 0 && <span className="chip empty">no crew</span>}

      {!full && (
        <span className="chip-add-wrap">
          <button
            className="chip add"
            title={`Add someone (max ${MAX_WORKERS_PER_ORDER})`}
            onClick={(e) => {
              e.stopPropagation();
              setPicking((p) => !p);
            }}
          >
            +
          </button>
          {picking && (
            <div className="picker" onClick={(e) => e.stopPropagation()}>
              {candidates.length === 0 ? (
                <div className="picker-empty">
                  Nobody qualified for {row.line.name} is free
                </div>
              ) : (
                candidates.map((w) => (
                  <button
                    key={String(w.id)}
                    className="picker-item"
                    title={detail(w)}
                    onClick={() => {
                      assign(row.job.id, String(w.id));
                      setPicking(false);
                    }}
                  >
                    {w.name}
                    <span className="picker-skills">
                      {w.position ?? w.skills.join(' · ')}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </span>
      )}
    </div>
  );
}
