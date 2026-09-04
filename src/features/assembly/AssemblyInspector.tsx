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
  PRODUCTIVE_HOURS_PER_PERSON,
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

  // A click anywhere outside closes the transient detail panel. Escape does
  // too, through the one handler in App that knows what else is open.
  useEffect(() => {
    if (!selectedJobId) return;
    const onOutside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) select(null);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
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

  // Nothing picked: the panel is simply not there. It opens on a click and
  // closes again, rather than sitting in a column asking to be filled.
  if (!row) return null;

  const { job, status } = row;
  // Started later than the last day that still hits Due — the same fact the
  // red Expect Date carries, said as the day it needed to begin.
  const late = Boolean(
    row.mustStartBy && row.start && row.start > row.mustStartBy,
  );
  const left = remainingQty(job);
  const existingToday = productionEntries.find((entry) => entry.date === today);
  const maxComplete = left + (existingToday?.complete ?? 0);
  // Closed by the supervisor: the bar greys out and there is nothing left to
  // book, but the history stays readable.
  const closed = row.completedToday;
  const activeCrewIds =
    row.crewDays.find((day) => day.day === today)?.workerIds ?? [];
  const activeCrew = row.workers.filter((worker) =>
    activeCrewIds.includes(String(worker.id)),
  );
  const picks = row.pickList ?? [];

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
      {/*
       * The order names itself once, across the top, instead of as the first
       * three rows of a narrow list — a part description is a sentence, and a
       * sentence set in a third of the panel's width was the tallest thing on
       * screen and the least readable. There is no close button: Esc and a
       * click anywhere outside both close it, which is how everything else on
       * the board behaves, and a button in the corner of a panel that opens at
       * the pointer is one more thing to aim at.
       */}
      <header className="inspector-title">
        <div className="inspector-ident">
          <span className="inspector-job">{String(job.id)}</span>
          <span className="inspector-part">{String(job.partNum)}</span>
          {job.description && (
            <span className="inspector-desc" title={job.description}>
              {job.description}
            </span>
          )}
        </div>
        <div className="inspector-flags">
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
          <span className="inspector-dismiss">Esc or click away to close</span>
        </div>
      </header>

      <div className="inspector-grid">
        <section className="inspector-section job-info">
          <h3>Schedule</h3>
          {/* The four dates read across, not down: they are compared with each
              other far more often than they are read one at a time, and a
              column of labelled rows makes that comparison hard work. */}
          <div className="date-rail">
            <div className="date-cell">
              <span className="date-label">Due</span>
              <span className="date-value">
                {job.dueDate ? formatDay(job.dueDate) : '—'}
              </span>
            </div>
            {/* Where Epicor's own Start Date comes from: the due date less the
                work, at 7.5 productive hours a person a day. Derived here at
                the crew actually on the order, so a gap against the export is
                a difference in crew size or hours, not a mystery. */}
            <div
              className="date-cell"
              title={
                row.mustStartBy
                  ? `Last day work can begin and still finish by the due date, ` +
                    `with ${row.workers.length} on it at ` +
                    `${PRODUCTIVE_HOURS_PER_PERSON} productive hours a day ` +
                    `(07:00–15:30 less morning tea and lunch)` +
                    (job.startDate
                      ? `. Epicor scheduled it to start ${formatDay(job.startDate)}.`
                      : '.')
                  : 'Nobody is on this order, so there is no rate to count back at'
              }
            >
              <span className="date-label">Must start</span>
              <span className={`date-value ${late ? 'red' : ''}`}>
                {row.mustStartBy ? formatDay(row.mustStartBy) : '—'}
              </span>
              {late && <span className="date-note">plan starts later</span>}
            </div>
            <div className="date-cell">
              <span className="date-label">Expect</span>
              <span className={`date-value ${status.color}`}>
                {row.expectDate ? formatDay(row.expectDate) : '—'}
              </span>
            </div>
            <div className="date-cell">
              <span className="date-label">Ship</span>
              <span className="date-value">
                {job.shipDate ? formatDay(job.shipDate) : '—'}
              </span>
            </div>
          </div>
          <dl className="kv">
            <dt>Progress</dt>
            <dd>
              <span className="progress-figure">
                {job.completedQty} <span className="of">of</span>{' '}
                {job.completedQty + left}
              </span>
              <span
                className="progress-meter"
                title={`${left} still to make`}
                aria-hidden="true"
              >
                <i
                  style={{
                    width: `${
                      (100 * job.completedQty) /
                      Math.max(1, job.completedQty + left)
                    }%`,
                  }}
                />
              </span>
            </dd>
            <dt>Kit</dt>
            <dd>{PREP_LABEL[job.materialPrep]}</dd>
          </dl>
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
                      <span
                        className="dep-part"
                        title={
                          dep.part
                            ? `${String(dep.onJobId)} supplies ${String(dep.part)}`
                            : 'Named as this order’s part in the order export'
                        }
                      >
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

        <section className="inspector-section pick-list-section">
          <h3>
            Warehouse pick list
            {picks.length > 0 && (
              <span className="count">
                {picks.length} line{picks.length === 1 ? '' : 's'}
              </span>
            )}
          </h3>
          {picks.length === 0 ? (
            <p className="hint">No materials found in JobMaterialReq.csv.</p>
          ) : (
            <div className="pick-list">
              {picks.map((material, index) => (
                <div className="pick-list-row" key={`${String(material.childPart)}-${index}`}>
                  <span className="part" title={String(material.childPart)}>
                    {String(material.childPart)}
                  </span>
                  <span
                    className={
                      material.requiredQty === null ? 'qty none' : 'qty'
                    }
                  >
                    {material.requiredQty === null ? '—' : material.requiredQty}
                  </span>
                </div>
              ))}
            </div>
          )}
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
          <h3>
            Production entry
            <span className="count">today</span>
          </h3>
          <div className="production-grid">
            <label><span>Shift output</span><input type="number" min={0} value={shiftOutput} onChange={(event) => setShiftOutput(event.target.value)} /></label>
            <label><span>Reject</span><input type="number" min={0} value={reject} onChange={(event) => setReject(event.target.value)} /></label>
            <label><span>Rework</span><input type="number" min={0} value={rework} onChange={(event) => setRework(event.target.value)} /></label>
            <label><span>Complete</span><input type="number" min={0} max={maxComplete} value={draft} placeholder={`≤ ${maxComplete}`} onChange={(event) => setDraft(event.target.value)} /></label>
          </div>
          <div className="production-actions">
            <label className="pause-toggle">
              <input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} /> Pause
            </label>
            <label className="pause-toggle">
              <input type="checkbox" checked={jobCompleted} onChange={(event) => setJobCompleted(event.target.checked)} /> Job completed
            </label>
          </div>
          {paused && (
            <select className="production-input" value={pauseReason} onChange={(event) => setPauseReason(event.target.value as PauseReason)}>
              {PAUSE_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
            </select>
          )}
          <textarea className="production-input" value={notes} placeholder="Notes (optional)" onChange={(event) => setNotes(event.target.value)} />
          {entryMessage && <p className="hint action-message" role="status">{entryMessage}</p>}
          {/* The note that explains the form sits with the button that submits
              it, so the section ends on its action rather than trailing off. */}
          <div className="section-foot book">
            <input
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onKeyDown={(event) => event.key === 'Enter' && book()}
            />
            <p className="hint">
              Entered at shift end. The Expect Date adjusts automatically.
            </p>
            <Button variant="primary" disabled={closed} onClick={book}>
              Save entry
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
