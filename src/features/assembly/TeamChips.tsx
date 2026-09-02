/**
 * The crew on an order. Up to four people; click a chip to take someone off,
 * "+" to add from the qualified people on shift.
 *
 * Only a supervisor decides who works an order, so both actions are behind the
 * supervisor unlock (`store/supervisorStore`). Booking the shift's output in
 * the inspector is deliberately *not* gated — that is the shift's own number.
 *
 * Nobody does two jobs at once, so the picker also knows who is already busy
 * across these days: those names are offered last, adding one asks first, and
 * a chip for someone on two orders at the same time is marked either way.
 */

import { useEffect, useRef } from 'react';
import type { OrderRow } from '@/engine/assembly/board';
import type { Worker } from '@/domain/assembly';
import { MAX_WORKERS_PER_ORDER } from '@/domain/assembly';
import { clashesFor } from '@/engine/assembly/crew';
import { usePlanStore } from '@/store/planStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { useUiStore } from '@/store/uiStore';
import { formatDay } from '@/lib/time';

/** "ASM8002 · UPL · 4 Sep – 8 Sep" — enough to go and look at it. */
const describe = (row: OrderRow): string =>
  `${String(row.job.id)} · ${row.line.name} · ` +
  `${row.start ? formatDay(row.start) : '—'} – ` +
  `${row.expectDate ? formatDay(row.expectDate) : '—'}`;

export function TeamChips({
  row,
  roster,
  rows,
  disabled = false,
}: {
  row: OrderRow;
  roster: Worker[];
  /** Every row on the board — an overlap on another line counts too. */
  rows: OrderRow[];
  disabled?: boolean;
}) {
  const jobId = String(row.job.id);
  const pickerJobId = useUiStore((s) => s.crewPickerJobId);
  const setCrewPicker = useUiStore((s) => s.setCrewPicker);
  const picking = pickerJobId === jobId;
  const root = useRef<HTMLDivElement>(null);
  const assign = usePlanStore((s) => s.assignWorker);
  const unassign = usePlanStore((s) => s.unassignWorker);
  const approved = usePlanStore((s) => s.orderDoubleBooked);
  const askClash = useUiStore((s) => s.askClash);
  const unlocked = useSupervisorStore((s) => s.unlocked);

  useEffect(() => {
    if (!picking) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setCrewPicker(null);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCrewPicker(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [picking, setCrewPicker]);

  const onIt = new Set(row.workers.map((w) => String(w.id)));
  const full = row.workers.length >= MAX_WORKERS_PER_ORDER;
  const LOCKED = 'Unlock Supervisor in the header to change the crew';

  const clashes = (workerId: string): OrderRow[] =>
    clashesFor(rows, row, workerId);

  /** Was this overlap put there on purpose? Either order may hold the note. */
  const isApproved = (workerId: string, other: OrderRow): boolean =>
    (approved[String(row.job.id)] ?? []).includes(workerId) ||
    (approved[String(other.job.id)] ?? []).includes(workerId);

  /** Roster detail for the hover title: "Sewer · reports to Mei". */
  const detail = (w: Worker): string =>
    [w.position, w.supervisor && `reports to ${w.supervisor}`]
      .filter(Boolean)
      .join(' · ');

  // Only people who are in today and qualified for this line. Those already
  // busy across these days come last — still offered, because a supervisor
  // may know something the schedule does not, but not offered first.
  const candidates = roster
    .filter(
      (w) =>
        w.onShift && w.skills.includes(row.line.key) && !onIt.has(String(w.id)),
    )
    .map((w) => ({ worker: w, busy: clashes(String(w.id)) }))
    .sort((a, b) => a.busy.length - b.busy.length);

  const add = (worker: Worker, busy: OrderRow[]) => {
    setCrewPicker(null);
    if (busy.length === 0) {
      assign(row.job.id, String(worker.id));
      return;
    }
    // Two jobs at once is the supervisor's call, not ours. Nothing is written
    // until they answer — see ClashPrompt.
    askClash({
      jobId: String(row.job.id),
      workerId: String(worker.id),
      workerName: worker.name,
      withJobIds: busy.map((r) => String(r.job.id)),
      withLabels: busy.map(describe),
    });
  };

  return (
    <div className="team" ref={root}>
      {row.workers.map((w) => {
        const busy = clashes(String(w.id));
        const ok = busy.every((other) => isApproved(String(w.id), other));
        return (
          <button
            key={String(w.id)}
            className={`chip ${unlocked ? '' : 'locked'} ${
              busy.length === 0 ? '' : ok ? 'shared' : 'clash'
            }`}
            disabled={!unlocked || disabled}
            title={[
              unlocked && !disabled
                ? `${w.name} — click to remove`
                : `${w.name} — ${disabled ? 'completed order' : LOCKED}`,
              detail(w),
              busy.length > 0 &&
                `${ok ? 'Splitting their day with' : 'Also on'}: ${busy
                  .map(describe)
                  .join('\n  ')}`,
            ]
              .filter(Boolean)
              .join('\n')}
            onClick={(e) => {
              e.stopPropagation();
              unassign(row.job.id, String(w.id));
            }}
          >
            {w.name}
            {busy.length > 0 && (
              <span className="chip-clash" aria-hidden="true">
                {ok ? '≡' : '!'}
              </span>
            )}
          </button>
        );
      })}

      {row.workers.length === 0 && <span className="chip empty">no crew</span>}

      {!full && !disabled && (
        <span className="chip-add-wrap">
          <button
            className={`chip add ${unlocked ? '' : 'locked'}`}
            disabled={!unlocked}
            title={
              unlocked ? `Add someone (max ${MAX_WORKERS_PER_ORDER})` : LOCKED
            }
            onClick={(e) => {
              e.stopPropagation();
              setCrewPicker(picking ? null : jobId);
            }}
          >
            {unlocked ? '+' : '🔒'}
          </button>
          {picking && (
            <div className="picker" onClick={(e) => e.stopPropagation()}>
              {candidates.length === 0 ? (
                <div className="picker-empty">
                  Nobody qualified for {row.line.name} is free
                </div>
              ) : (
                candidates.map(({ worker: w, busy }) => (
                  <button
                    key={String(w.id)}
                    className={`picker-item ${busy.length > 0 ? 'busy' : ''}`}
                    title={[
                      detail(w),
                      busy.length > 0 &&
                        `Already on: ${busy.map(describe).join('\n  ')}`,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                    onClick={() => add(w, busy)}
                  >
                    {w.name}
                    <span className="picker-skills">
                      {busy.length > 0
                        ? `on ${busy.map((r) => String(r.job.id)).join(', ')}`
                        : (w.position ?? w.skills.join(' · '))}
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
