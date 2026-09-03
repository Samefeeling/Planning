/**
 * A person's name in the board header, with their week of work behind it.
 *
 * The supervisor's question at the top of the board is "who has room?", which
 * the crew chips on the rows cannot answer — those show one order at a time.
 * Five squares beside the name answer it at a glance, one per working day in
 * the same green/orange/red bands as the day columns; clicking opens the full
 * view, the same hours totalled per day across every order the person is on.
 */

import { useEffect, useRef, useState } from 'react';
import type { Worker } from '@/domain/assembly';
import {
  LOAD_WINDOW_DAYS,
  dayBand,
  loadPreview,
  type WorkerLoad,
} from '@/engine/assembly/workload';

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
});

const hrs = (n: number): string => `${n.toFixed(1)} h`;

export function WorkerLoadChip({
  worker,
  load,
}: {
  worker: Worker;
  /** This person's week, computed once for the whole roster by the board. */
  load: WorkerLoad;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

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

  const pct = load.capacityHours
    ? Math.round((load.totalHours / load.capacityHours) * 100)
    : 0;
  const preview = loadPreview(load);

  /** What one square means, spelled out for the hover. */
  const dayTitle = (day: (typeof preview)[number]): string => {
    const when = DAY_FMT.format(day.date);
    if (day.capacity <= 0) {
      return day.hours > 0
        ? `${when} — ${hrs(day.hours)} booked on a day off`
        : `${when} — planned leave`;
    }
    if (day.hours <= 0) return `${when} — free`;
    // Spell out what the colour means: full is not the same as over, and the
    // board books a whole shift to anyone it puts on an order.
    const state =
      day.dot === 'red'
        ? 'more than a full shift'
        : day.dot === 'orange'
          ? 'full'
          : 'room for more';
    return (
      `${when} — ${hrs(day.hours)} of ${hrs(day.capacity)} ` +
      `(${Math.round(day.pct)}%, ${state})`
    );
  };

  return (
    <span className="worker-load-anchor" ref={wrap}>
      <button
        type="button"
        className={`worker-name ${open ? 'open' : ''}`}
        aria-expanded={open}
        aria-label={`${worker.name} — ${pct}% booked over ${preview.length} working days`}
        title={`${worker.name} — ${LOAD_WINDOW_DAYS}-day work load`}
        onClick={() => setOpen((o) => !o)}
      >
        {worker.name}
        {/* One square per working day. Decorative for a screen reader — the
            button's label already carries the number. */}
        <span className="wl-dots" aria-hidden="true">
          {preview.map((day) => (
            <i key={day.key} className={`wl-dot ${day.dot}`} title={dayTitle(day)} />
          ))}
        </span>
      </button>

      {open && (
        <div className="worker-load" role="dialog" aria-label={`${worker.name} work load`}>
          <header className="wl-head">
            <strong>{worker.name}</strong>
            <span className="wl-sub">
              {[
                worker.position,
                worker.skills.join(' · ') || 'no skill listed',
                // Which bench, where the line has more than one.
                worker.trades?.length ? worker.trades.join(' · ') : null,
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
              // Same bands as the squares, so the two views of one week can
              // never read differently.
              const band = dayBand(day);
              const fill = day.capacity
                ? Math.min(100, (day.hours / day.capacity) * 100)
                : day.hours > 0
                  ? 100
                  : 0;
              return (
                <li
                  key={day.key}
                  className={`${day.onLeave ? 'leave' : ''} ${
                    // A closed day recedes — unless work landed on it, which
                    // is the one weekend case worth looking at.
                    day.working ? '' : day.hours > 0 ? 'overtime' : 'closed'
                  }`}
                >
                  <span className="wl-day">{DAY_FMT.format(day.date)}</span>
                  <span className="wl-meter">
                    <i className={band} style={{ width: `${fill}%` }} />
                  </span>
                  <span className={`wl-hours ${over ? 'over' : ''}`}>
                    {day.hours > 0 ? hrs(day.hours) : '—'}
                  </span>
                  <span className="wl-orders">
                    {day.entries.length > 0
                      ? // The order number first: it is what the supervisor
                        // says out loud and what they look up. Two orders for
                        // the same part are told apart by nothing else.
                        day.entries
                          .map(
                            (e) =>
                              `${String(e.jobId)} · ${e.line} · ${e.description}`,
                          )
                          .join('  |  ')
                      : day.onLeave
                        ? 'planned leave'
                        : day.working
                          ? 'free'
                          : 'factory closed'}
                  </span>
                </li>
              );
            })}
          </ol>

          {load.overloadedDays > 0 && (
            <p className="wl-warn">
              Booked past a full shift on {load.overloadedDays} day
              {load.overloadedDays === 1 ? '' : 's'} — they are on more than one
              order at once, on leave, or at the weekend.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
