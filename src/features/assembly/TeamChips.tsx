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

import { useEffect, useRef, useState } from 'react';
import type { OrderRow } from '@/engine/assembly/board';
import type { Worker } from '@/domain/assembly';
import { MAX_WORKERS_PER_ORDER, SHIFT_END_HOUR } from '@/domain/assembly';
import {
  clashesFor,
  freeCrewWindow,
  preferredCrewOrder,
  type FreeCrewWindow,
} from '@/engine/assembly/crew';
import { crewDayKey } from '@/engine/assembly/crewSchedule';
import { usePlanStore } from '@/store/planStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { useUiStore } from '@/store/uiStore';
import { formatDay } from '@/lib/time';

/** "ASM8002 · UPL · 4 Sep – 8 Sep" — enough to go and look at it. */
const describe = (row: OrderRow): string =>
  `${String(row.job.id)} · ${row.line.name} · ` +
  `${row.start ? formatDay(row.start) : '—'} – ` +
  `${row.expectDate ? formatDay(row.expectDate) : '—'}`;

const parseDay = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};

const moveDay = (day: string, amount: number): string => {
  const date = parseDay(day);
  date.setDate(date.getDate() + amount);
  return crewDayKey(date);
};

const shortDay = (day: string): string => formatDay(parseDay(day));

const compactDay = (day: string): string => {
  const date = parseDay(day);
  return `${date.getDate()}/${date.getMonth() + 1}`;
};

const clockTime = (hour: number): string =>
  `${String(Math.floor(hour)).padStart(2, '0')}:${String(
    Math.round((hour % 1) * 60),
  ).padStart(2, '0')}`;

export interface CrewPickerStatus {
  primary: string;
  secondary: string | null;
  tone: 'free' | 'busy' | 'neutral';
}

/** Compact, operational wording for the employee picker. */
export function crewPickerStatus(
  free: FreeCrewWindow | null,
  busyJobIds: string[],
  fallback: string,
): CrewPickerStatus {
  if (free?.toDayExclusive) {
    return {
      primary: `Free to ${clockTime(SHIFT_END_HOUR)} ${compactDay(
        moveDay(free.toDayExclusive, -1),
      )}`,
      secondary:
        free.nextJobIds.length > 0
          ? `Then ${free.nextJobIds.join(', ')}`
          : null,
      tone: 'free',
    };
  }
  if (busyJobIds.length > 0) {
    return {
      primary: `On ${busyJobIds.join(', ')}`,
      secondary: null,
      tone: 'busy',
    };
  }
  if (free) {
    return {
      primary: 'Free for full order',
      secondary: fallback || null,
      tone: 'free',
    };
  }
  return { primary: fallback, secondary: null, tone: 'neutral' };
}

interface WindowDraft {
  worker: Worker;
  fromDay: string;
  /** Inclusive last day in the form; blank means until completion. */
  throughDay: string;
}

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
  const [draft, setDraft] = useState<WindowDraft | null>(null);
  const assign = usePlanStore((s) => s.assignWorker);
  const assignWindow = usePlanStore((s) => s.assignWorkerWindow);
  const unassign = usePlanStore((s) => s.unassignWorker);
  const approved = usePlanStore((s) => s.orderDoubleBooked);
  const askClash = useUiStore((s) => s.askClash);
  const unlocked = useSupervisorStore((s) => s.unlocked);

  useEffect(() => {
    if (!picking) {
      setDraft(null);
      return;
    }
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
  const full =
    (row.crewDays?.length ?? 0) > 0 &&
    row.crewDays!.every(
      (day) => day.workerIds.length >= MAX_WORKERS_PER_ORDER,
    );
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
  // may know something the schedule does not, but not offered first. Among
  // those free, the same order the board fills a crew in: best skill for this
  // line, then straight down the roster, which is written as a priority list.
  const prefer = preferredCrewOrder(roster, row.line.key);
  const candidates = roster
    .filter(
      (w) =>
        w.onShift && w.skills.includes(row.line.key) && !onIt.has(String(w.id)),
    )
    .map((w) => ({
      worker: w,
      busy: clashes(String(w.id)),
      free: freeCrewWindow(rows, row, String(w.id)),
    }))
    .sort(
      (a, b) =>
        a.busy.length - b.busy.length || prefer(a.worker, b.worker),
    );

  const add = (
    worker: Worker,
    busy: OrderRow[],
    free: ReturnType<typeof freeCrewWindow>,
  ) => {
    if (busy.length === 0) {
      setCrewPicker(null);
      assign(row.job.id, String(worker.id));
      return;
    }
    if (free?.toDayExclusive) {
      setDraft({
        worker,
        fromDay: free.fromDay,
        throughDay: moveDay(free.toDayExclusive, -1),
      });
      return;
    }
    setCrewPicker(null);
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

  const saveWindow = () => {
    const window = draft;
    if (!window?.fromDay) return;
    const toDayExclusive = window.throughDay
      ? moveDay(window.throughDay, 1)
      : null;
    if (toDayExclusive && window.fromDay >= toDayExclusive) return;
    const workerId = String(window.worker.id);
    const busy = rows.filter(
      (other) =>
        String(other.job.id) !== jobId &&
        !other.completedToday &&
        (other.crewDays ?? []).some(
          (day) =>
            day.workerIds.includes(workerId) &&
            window.fromDay <= day.day &&
            (toDayExclusive === null || day.day < toDayExclusive),
        ),
    );
    setCrewPicker(null);
    if (busy.length === 0) {
      assignWindow(row.job.id, workerId, window.fromDay, toDayExclusive);
      return;
    }
    askClash({
      jobId,
      workerId,
      workerName: window.worker.name,
      withJobIds: busy.map((other) => String(other.job.id)),
      withLabels: busy.map(describe),
      fromDay: window.fromDay,
      toDayExclusive,
    });
  };

  const assignmentLabel = (workerId: string): string => {
    const windows = (row.crewAssignments ?? []).filter(
      (assignment) => assignment.workerId === workerId,
    );
    if (
      windows.length === 0 ||
      windows.some(
        (assignment) =>
          assignment.fromDay === null && assignment.toDayExclusive === null,
      )
    ) return 'whole order';
    return windows
      .map((assignment) => {
        const from = assignment.fromDay ?? crewDayKey(row.plannedStart);
        const through = assignment.toDayExclusive
          ? shortDay(moveDay(assignment.toDayExclusive, -1))
          : 'completion';
        return `${shortDay(from)}–${through}`;
      })
      .join(', ');
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
              `Allocated: ${assignmentLabel(String(w.id))}`,
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
              {draft ? (
                <div className="crew-window-editor">
                  <strong>{draft.worker.name}</strong>
                  <span className="picker-skills">
                    Set when they join and leave this order
                  </span>
                  <label>
                    Join
                    <input
                      type="date"
                      value={draft.fromDay}
                      onChange={(event) =>
                        setDraft({ ...draft, fromDay: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Last day
                    <input
                      type="date"
                      value={draft.throughDay}
                      onChange={(event) =>
                        setDraft({ ...draft, throughDay: event.target.value })
                      }
                    />
                  </label>
                  <span className="picker-skills">
                    They leave automatically after the last day.
                  </span>
                  <div className="crew-window-actions">
                    <button onClick={saveWindow}>Allocate gap</button>
                    <button onClick={() => setDraft(null)}>Back</button>
                  </div>
                </div>
              ) : candidates.length === 0 ? (
                <div className="picker-empty">
                  Nobody qualified for {row.line.name} is free
                </div>
              ) : (
                candidates.map(({ worker: w, busy, free }) => {
                  const status = crewPickerStatus(
                    free,
                    busy.map((other) => String(other.job.id)),
                    w.position ?? w.skills.join(' · '),
                  );
                  return (
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
                      onClick={() => add(w, busy, free)}
                    >
                      <span className="picker-name">{w.name}</span>
                      <span className={`picker-status ${status.tone}`}>
                        <span>{status.primary}</span>
                        {status.secondary && (
                          <span className="picker-next">{status.secondary}</span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </span>
      )}
    </div>
  );
}
