/**
 * A person's name in the board header, with their week of work behind it.
 *
 * The supervisor's question at the top of the board is "who has room?", which
 * the crew chips on the rows cannot answer — those show one order at a time.
 * Clicking a name here opens the other view: the same hours, totalled per day
 * across every order the person is on, against a shift's worth of capacity.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Worker } from '@/domain/assembly';
import type { OrderRow } from '@/engine/assembly/board';
import { LOAD_WINDOW_DAYS, workerLoad } from '@/engine/assembly/workload';

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});

const hrs = (n: number): string => `${n.toFixed(1)} h`;

export function WorkerLoadChip({
  worker,
  rows,
  from,
}: {
  worker: Worker;
  /** Every scheduled row on the board — an order counts wherever it sits. */
  rows: OrderRow[];
  from: Date;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // Only worth computing for the one person whose panel is open.
  const load = useMemo(
    () => (open ? workerLoad(worker, rows, from) : null),
    [open, worker, rows, from],
  );

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      // The button lives inside the wrapper too, so clicking it again toggles
      // rather than closing and immediately reopening.
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pct = load?.capacityHours
    ? Math.round((load.totalHours / load.capacityHours) * 100)
    : 0;

  return (
    <span className="worker-load-anchor" ref={wrap}>
      <button
        type="button"
        className={`worker-name ${open ? 'open' : ''}`}
        aria-expanded={open}
        title={`${worker.name} — ${LOAD_WINDOW_DAYS}-day work load`}
        onClick={() => setOpen((o) => !o)}
      >
        {worker.name}
      </button>

      {open && load && (
        <div className="worker-load" role="dialog" aria-label={`${worker.name} work load`}>
          <header className="wl-head">
            <strong>{worker.name}</strong>
            <span className="wl-sub">
              {[
                worker.position,
                worker.skills.join(' · ') || 'no skill listed',
                worker.supervisor && `reports to ${worker.supervisor}`,
              ]
                .filter(Boolean)
                .join(' — ')}
            </span>
            <button
              type="button"
              className="wl-close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="wl-summary">
            <span>
              <b>{hrs(load.totalHours)}</b> booked
            </span>
            <span>of {hrs(load.capacityHours)}</span>
            <span className={`wl-pct ${pct > 100 ? 'over' : ''}`}>{pct}%</span>
            <span>
              {load.orderCount} order{load.orderCount === 1 ? '' : 's'}
            </span>
          </div>

          <ol className="wl-days">
            {load.days.map((day) => {
              const over = day.over;
              const fill = day.capacity
                ? Math.min(100, (day.hours / day.capacity) * 100)
                : day.hours > 0
                  ? 100
                  : 0;
              return (
                <li key={day.key} className={day.onLeave ? 'leave' : ''}>
                  <span className="wl-day">{DAY_FMT.format(day.date)}</span>
                  <span className="wl-meter">
                    <i
                      className={over ? 'over' : ''}
                      style={{ width: `${fill}%` }}
                    />
                  </span>
                  <span className={`wl-hours ${over ? 'over' : ''}`}>
                    {day.hours > 0 ? hrs(day.hours) : '—'}
                  </span>
                  <span className="wl-orders">
                    {day.onLeave
                      ? 'planned leave'
                      : day.entries.length === 0
                        ? 'free'
                        : day.entries
                            .map((e) => `${e.line} · ${e.description}`)
                            .join('  |  ')}
                  </span>
                </li>
              );
            })}
          </ol>

          {load.overloadedDays > 0 && (
            <p className="wl-warn">
              Booked past a full shift on {load.overloadedDays} day
              {load.overloadedDays === 1 ? '' : 's'} — they are on more than one
              order at once.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
