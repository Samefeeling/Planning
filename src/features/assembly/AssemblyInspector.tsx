/**
 * Detail panel for the selected assembly order.
 *
 * This is where the supervisor books the shift: enter what was finished today
 * and the Expect Date moves on its own — short of target it slips out, ahead of
 * target it pulls in. Also shows what crew size would be needed to hold the
 * ship date, and the material picture behind the release gate.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import { findOrderRow } from '@/store/assemblySelectors';
import { usePlanStore } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import {
  MAX_WORKERS_PER_ORDER,
  type MaterialPrepStatus,
} from '@/domain/assembly';
import { remainingQty } from '@/engine/assembly/duration';
import { startEligibility } from '@/engine/assembly/release';
import { formatDay } from '@/lib/time';
import { Badge, Button } from '@/ui';
import type { PauseReason, ProductionEntry } from '@/store/planStore';
import { useSupervisorStore } from '@/store/supervisorStore';

const PREP_LABEL: Record<MaterialPrepStatus, string> = {
  unknown: 'Unknown',
  'not-prepared': 'Not prepared',
  preparing: 'Preparing',
  ready: 'Ready',
  shortage: 'Shortage',
};

const NO_PRODUCTION: ProductionEntry[] = [];

const PAUSE_REASONS: { value: PauseReason; label: string }[] = [
  { value: 'material-shortage', label: 'Material Shortage' },
  { value: 'waiting-previous-stage', label: 'Waiting Previous Stage' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'quality', label: 'Quality' },
  { value: 'labour-reallocated', label: 'Labour Reallocated' },
];

/** Space between the pointer and the panel, and from the window's edges. */
const PANEL_GAP = 12;
/**
 * Widths to try, narrowest first: three sections side by side at 680, then
 * wider if this order will not fit the window's height at that. Wider sections
 * wrap less — a description, a badge row and a dependency list each come back
 * off a second line — so the panel gets shorter as it gets broader.
 */
const PANEL_WIDTHS = [680, 900, 1120, 1360];

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(n, Math.max(lo, hi)));

/** Where and how big the panel is, once measured against the window. */
interface Place {
  left: number;
  top: number;
  width: number;
  /** `auto` whenever the order fits the window — which is nearly all of them. */
  height: number | 'auto';
}

const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

export function AssemblyInspector({ board }: { board: AssemblyGanttView }) {
  const selectedJobId = useUiStore((s) => s.selectedJobId);
  const selectedAt = useUiStore((s) => s.selectedAt);
  const select = useUiStore((s) => s.select);
  const row = findOrderRow(board, selectedJobId);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

  // Size the panel to this order and put it beside the click. Measured rather
  // than assumed: an order with a dependency list and short components is much
  // taller than one with neither, and a fixed height either hangs off the
  // bottom or hides half of what the supervisor opened the panel to read. So
  // it takes the height it needs; if that is more than the window can show it
  // widens instead, and only a window too small for even the widest scrolls.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !selectedAt) return setPlace(null);

    const roomW = window.innerWidth - PANEL_GAP * 2;
    const roomH = window.innerHeight - PANEL_GAP * 2;

    // Try each width in turn, measuring free of the fit worked out for the
    // last order — the panel is still wearing that until React renders.
    el.style.height = 'auto';
    let width = Math.min(PANEL_WIDTHS[0], roomW);
    el.style.width = `${width}px`;
    for (const wider of PANEL_WIDTHS) {
      if (el.offsetHeight <= roomH) break;
      if (wider <= width || wider > roomW) continue;
      width = wider;
      el.style.width = `${width}px`;
    }

    // Settle the winning fit on the node as well as in state: two orders that
    // measure alike give React nothing to diff, and it would then leave
    // whatever the trials above wrote here in place.
    const height: number | 'auto' = el.offsetHeight > roomH ? roomH : 'auto';
    el.style.height = height === 'auto' ? 'auto' : `${height}px`;

    const boxH = el.offsetHeight;
    setPlace({
      width,
      height,
      left: clamp(selectedAt.x + PANEL_GAP, PANEL_GAP, roomW + PANEL_GAP - width),
      top: clamp(selectedAt.y - PANEL_GAP * 3, PANEL_GAP, roomH + PANEL_GAP - boxH),
    });
  }, [selectedAt, selectedJobId, row]);

  // Escape closes, like every other transient thing on the board.
  useEffect(() => {
    if (!selectedJobId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedJobId, select]);
  // Every row on the board, moulding included — an order can be waiting on a
  // press job, which is not among the scheduled assembly rows.
  const rowsById = useMemo(
    () =>
      new Map(
        board.groups.flatMap((g) => g.rows).map((r) => [String(r.job.id), r]),
      ),
    [board],
  );
  const startOrder = usePlanStore((s) => s.startOrder);
  const saveProductionEntry = usePlanStore((s) => s.saveProductionEntry);
  const unlocked = useSupervisorStore((s) => s.unlocked);
  const [draft, setDraft] = useState('');
  const productionByJob = usePlanStore((s) => s.production);
  const productionEntries = selectedJobId
    ? (productionByJob[selectedJobId] ?? NO_PRODUCTION)
    : NO_PRODUCTION;
  const [reject, setReject] = useState('0');
  const [rework, setRework] = useState('0');
  const [shiftOutput, setShiftOutput] = useState('0');
  const [paused, setPaused] = useState(false);
  const [jobCompleted, setJobCompleted] = useState(false);
  const [pauseReason, setPauseReason] = useState<PauseReason>('material-shortage');
  const [notes, setNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [startMessage, setStartMessage] = useState('');
  const [entryMessage, setEntryMessage] = useState('');
  const today = isoDay(new Date());

  useEffect(() => {
    const existing = productionEntries.find((entry) => entry.date === today);
    setDraft(existing ? String(existing.complete) : '');
    setReject(String(existing?.reject ?? 0));
    setRework(String(existing?.rework ?? 0));
    setShiftOutput(String(existing?.shiftOutput ?? 0));
    setPaused(Boolean(existing?.paused));
    setJobCompleted(Boolean(existing?.jobCompleted));
    setPauseReason(existing?.pauseReason ?? 'material-shortage');
    setNotes(existing?.notes ?? '');
    setOverrideReason('');
    setStartMessage('');
    setEntryMessage('');
  }, [selectedJobId, productionEntries, today]);

  const close = (
    <button
      type="button"
      className="inspector-close"
      aria-label="Close"
      title="Close"
      onClick={() => select(null)}
    >
      ×
    </button>
  );

  // Nothing picked: the panel is simply not there. It opens on a click and
  // closes again, rather than sitting in a column asking to be filled.
  if (!row) return null;

  const { job, status } = row;
  const left = remainingQty(job);
  const existingToday = productionEntries.find((entry) => entry.date === today);
  const maxComplete = left + (existingToday?.complete ?? 0);
  // Closed by the supervisor: the bar greys out and there is nothing left to
  // book, but the history stays readable.
  const closed = row.completedToday;
  const activeCrewIds =
    row.crewDays?.find((day) => day.day === today)?.workerIds ??
    (row.crewDays ? [] : row.workers.map((worker) => String(worker.id)));
  const activeCrew = row.workers.filter((worker) =>
    activeCrewIds.includes(String(worker.id)),
  );

  const eligibility = startEligibility(
    job.released,
    row.release,
    activeCrew.length,
  );

  const beginProduction = () => {
    if (row.actualStart) return;
    const reason = overrideReason.trim();
    if (!eligibility.allowed) {
      if (!eligibility.canOverride) {
        setStartMessage(eligibility.reasons.join(' · '));
        return;
      }
      if (!unlocked) {
        setStartMessage('Unlock Supervisor to override the start gate.');
        return;
      }
      if (!reason) {
        setStartMessage('Enter an override reason before starting production.');
        return;
      }
    }
    startOrder(job.id, {
      startedAt: new Date().toISOString(),
      overrideReason: eligibility.allowed ? null : reason,
      operatorIds: activeCrew.map((worker) => String(worker.id)),
      operatorNames: activeCrew.map((worker) => worker.name),
    });
    setStartMessage('Production start confirmed.');
  };

  const book = () => {
    if (closed) {
      setEntryMessage('Completed entries are locked.');
      return;
    }
    const qty = Number(draft || 0);
    const numbers = [qty, Number(reject), Number(rework), Number(shiftOutput)];
    if (!numbers.every((n) => Number.isFinite(n) && n >= 0)) {
      setEntryMessage('All production quantities must be zero or greater.');
      return;
    }
    if (qty > maxComplete) {
      setEntryMessage(`Complete cannot exceed the ${maxComplete} units available.`);
      return;
    }
    if (!row.actualStart) {
      setEntryMessage('Confirm Start production before saving an entry.');
      return;
    }
    if (paused && jobCompleted) {
      setEntryMessage('An order cannot be paused and completed in the same entry.');
      return;
    }
    if (numbers.every((n) => n === 0) && !paused && !jobCompleted && !notes.trim()) {
      setEntryMessage('Enter production, a pause, completion, or a note before saving.');
      return;
    }
    const completedAt = jobCompleted ? new Date().toISOString() : null;
    saveProductionEntry(job.id, {
      date: today,
      complete: qty,
      reject: Number(reject),
      rework: Number(rework),
      shiftOutput: Number(shiftOutput),
      paused,
      pauseReason: paused ? pauseReason : null,
      jobCompleted,
      operatorIds: activeCrew.map((worker) => String(worker.id)),
      operatorNames: activeCrew.map((worker) => worker.name),
      completedAt,
      notes: notes.trim(),
    }, {
      remainingQty: row.sourceRemainingQty ?? row.job.remainingQty,
      completedQty: row.sourceCompletedQty ?? row.job.completedQty,
    });
    setEntryMessage(jobCompleted ? 'Entry saved. Crew released.' : 'Entry saved.');
  };

  return (
    <div
      ref={panel}
      className="inspector floating"
      role="dialog"
      aria-label={`Order ${String(job.id)}`}
      // Hidden for the first paint, while it is measured against the window —
      // otherwise it flashes at the top-left corner on the way to the click.
      // Every property is written on every render: the measuring pass sets
      // these on the node directly, and React only clears what it knows it set.
      style={
        place
          ? {
              left: place.left,
              top: place.top,
              width: place.width,
              height: place.height,
            }
          : {
              left: 0,
              top: 0,
              width: PANEL_WIDTHS[0],
              height: 'auto',
              visibility: 'hidden',
            }
      }
    >
      <div className="inspector-head">
        {close}
      </div>

      <div className="inspector-grid">
        <section className="inspector-section job-info">
          <h3>Job Info</h3>
          <dl className="kv">
            <dt>Job</dt>
            <dd className="job-number">{String(job.id)}</dd>
            <dt>Part</dt>
            <dd>{String(job.partNum)}</dd>
            <dt>Description</dt>
            <dd>{job.description || '—'}</dd>
            <dt>Progress</dt>
            <dd>{job.completedQty} / {job.completedQty + left}</dd>
            <dt>Due date</dt>
            <dd>{job.dueDate ? formatDay(job.dueDate) : '—'}</dd>
            <dt>Expect date</dt>
            <dd className={`expect ${status.color}`}>
              {row.expectDate ? formatDay(row.expectDate) : '—'}
            </dd>
            <dt>Ship date</dt>
            <dd>{job.shipDate ? formatDay(job.shipDate) : '—'}</dd>
            <dt>Kit</dt>
            <dd>{PREP_LABEL[job.materialPrep]}</dd>
          </dl>
          <div className="job-badges">
            {closed && <Badge variant="neutral">Job completed</Badge>}
            {row.overtime && <Badge variant="warn">Weekend overtime</Badge>}
            <Badge
              variant={
                status.color === 'green'
                  ? 'ok'
                  : status.color === 'orange'
                    ? 'warn'
                    : status.color === 'red'
                      ? 'error'
                      : 'neutral'
              }
            >
              {status.reason}
            </Badge>
            {row.waitingOn && (
              <Badge variant="neutral">
                Waits on {String(row.waitingOn.onJobId)}
              </Badge>
            )}
          </div>
          {row.predecessors.length > 0 && (
            <div className="inspector-subsection">
              <h4>Needs finished first</h4>
              <ul className="dep-list">
                {row.predecessors.map((dep) => {
                  const on = rowsById.get(String(dep.onJobId));
                  const holding = row.waitingOn?.onJobId === dep.onJobId;
                  return (
                    <li
                      key={String(dep.onJobId)}
                      className={holding ? 'holding' : ''}
                    >
                      <span className="dep-job">{String(dep.onJobId)}</span>
                      <span className="dep-part">
                        {dep.part ? String(dep.part) : 'named in the order export'}
                      </span>
                      <span className="dep-when">
                        {on?.line.name ?? '—'}
                        {on?.expectDate ? ` · ${formatDay(on.expectDate)}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {row.material.shortages.length > 0 && (
            <div className="inspector-subsection">
              <h4>Short components</h4>
              {row.material.shortages.map((shortage) => (
                <div className="shortage-row" key={String(shortage.componentPart)}>
                  <span className="part">{String(shortage.componentPart)}</span>
                  <span>
                    need {shortage.requiredQty}, free {shortage.freeOnHand} (−{shortage.shortQty})
                    {shortage.coverageDate
                      ? ` · PO ${shortage.poNum ?? ''} ${formatDay(shortage.coverageDate)}`
                      : ' · no PO'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="inspector-section crew-pace">
          <h3>Crew &amp; Pace</h3>
          <dl className="kv">
            <dt>On the job</dt>
            <dd>
              {activeCrew.length} / {MAX_WORKERS_PER_ORDER} today
              {activeCrew.length > 0 &&
                ` — ${activeCrew.map((worker) => worker.name).join(', ')}`}
            </dd>
            <dt>Duration</dt>
            <dd>{row.days === null ? '—' : `${row.days.toFixed(1)} days`}</dd>
            <dt>Daily target</dt>
            <dd>
              {row.dailyTarget > 0 ? `${Math.round(row.dailyTarget)} / day` : '—'}
            </dd>
            {status.color !== 'green' && (
              <>
                <dt>To hit ship</dt>
                <dd>
                  {row.crewToHitShip === null
                    ? `not reachable, even with ${MAX_WORKERS_PER_ORDER}`
                    : `${row.crewToHitShip} people`}
                </dd>
              </>
            )}
          </dl>
          <div className="production-start">
            {row.actualStart ? (
              <div className="production-history">
                <strong>Started</strong>{' '}
                {new Date(row.actualStart.startedAt).toLocaleString('en-AU', {
                  timeZone: 'Australia/Sydney',
                })}
                {row.actualStart.overrideReason &&
                  ` · Override: ${row.actualStart.overrideReason}`}
              </div>
            ) : (
              <>
                {!eligibility.allowed && (
                  <p className="hint">
                    Start gate: {eligibility.reasons.join(' · ')}
                  </p>
                )}
                {!eligibility.allowed && eligibility.canOverride && unlocked && (
                  <textarea
                    className="production-input"
                    value={overrideReason}
                    placeholder="Supervisor override reason (required)"
                    onChange={(event) => setOverrideReason(event.target.value)}
                  />
                )}
                <Button
                  variant="primary"
                  disabled={
                    !eligibility.allowed &&
                    (!eligibility.canOverride || !unlocked)
                  }
                  onClick={beginProduction}
                >
                  Start production
                </Button>
              </>
            )}
            {startMessage && <p className="hint action-message" role="status">{startMessage}</p>}
          </div>
        </section>

        <section className="inspector-section production-entry">
          <h3>Production Entry</h3>
          <div className="production-grid">
            <label>Shift output<input type="number" min={0} value={shiftOutput} onChange={(event) => setShiftOutput(event.target.value)} /></label>
            <label>Reject<input type="number" min={0} value={reject} onChange={(event) => setReject(event.target.value)} /></label>
            <label>Rework<input type="number" min={0} value={rework} onChange={(event) => setRework(event.target.value)} /></label>
            <label>Complete<input type="number" min={0} max={maxComplete} value={draft} placeholder={`≤ ${maxComplete}`} onChange={(event) => setDraft(event.target.value)} /></label>
          </div>
          <div className="production-actions">
            <label className="pause-toggle">
              <input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} /> Pause
            </label>
            <label className="pause-toggle">
              <input type="checkbox" checked={jobCompleted} onChange={(event) => setJobCompleted(event.target.checked)} /> Job Completed
            </label>
          </div>
          {paused && (
            <select className="production-input" value={pauseReason} onChange={(event) => setPauseReason(event.target.value as PauseReason)}>
              {PAUSE_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
          )}
          <textarea className="production-input" value={notes} placeholder="Notes (optional)" onChange={(event) => setNotes(event.target.value)} />
          <div className="book">
            <input
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onKeyDown={(event) => event.key === 'Enter' && book()}
            />
            <Button variant="primary" disabled={closed} onClick={book}>
              Save entry
            </Button>
          </div>
          {entryMessage && <p className="hint action-message" role="status">{entryMessage}</p>}
          <p className="hint">
            Entered at shift end. The Expect Date adjusts automatically.
          </p>
        </section>
      </div>
    </div>
  );
}
