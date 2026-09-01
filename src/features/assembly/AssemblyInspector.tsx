/**
 * Detail panel for the selected assembly order.
 *
 * This is where the supervisor books the shift: enter what was finished today
 * and the Expect Date moves on its own — short of target it slips out, ahead of
 * target it pulls in. Also shows what crew size would be needed to hold the
 * ship date, and the material picture behind the release gate.
 */

import { useEffect, useState } from 'react';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import { findOrderRow } from '@/store/assemblySelectors';
import { usePlanStore } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import {
  MAX_WORKERS_PER_ORDER,
  type MaterialPrepStatus,
} from '@/domain/assembly';
import { remainingQty } from '@/engine/assembly/duration';
import { formatDay } from '@/lib/time';
import { Badge, Button } from '@/ui';
import type { PauseReason, ProductionEntry } from '@/store/planStore';

const PREP_LABEL: Record<MaterialPrepStatus, string> = {
  'not-prepared': 'Not prepared',
  preparing: 'Preparing',
  ready: 'Ready',
  shortage: 'Shortage',
};

/** Shared empty list so an order with no bookings keeps a stable reference. */
const NO_ENTRIES: { date: string; qty: number }[] = [];
const NO_PRODUCTION: ProductionEntry[] = [];

const PAUSE_REASONS: { value: PauseReason; label: string }[] = [
  { value: 'material-shortage', label: 'Material Shortage' },
  { value: 'waiting-previous-stage', label: 'Waiting Previous Stage' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'quality', label: 'Quality' },
  { value: 'labour-reallocated', label: 'Labour Reallocated' },
];

const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

export function AssemblyInspector({ board }: { board: AssemblyGanttView }) {
  const selectedJobId = useUiStore((s) => s.selectedJobId);
  const select = useUiStore((s) => s.select);
  const row = findOrderRow(board, selectedJobId);
  const recordProgress = usePlanStore((s) => s.recordProgress);
  const recordProduction = usePlanStore((s) => s.recordProduction);
  // Select the stable map, then read from it. Returning a fresh `[]` from the
  // selector would give React a new snapshot every render and loop forever.
  const progressByJob = usePlanStore((s) => s.progress);
  const entries = selectedJobId
    ? (progressByJob[selectedJobId] ?? NO_ENTRIES)
    : NO_ENTRIES;
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

  useEffect(() => {
    setDraft('');
    setReject('0');
    setRework('0');
    setShiftOutput('0');
    setPaused(false);
    setJobCompleted(false);
    setNotes('');
  }, [selectedJobId]);

  if (!row) {
    return (
      <div className="inspector">
        <h2>Order</h2>
        <div className="pool-empty">Select an order to book the shift.</div>
      </div>
    );
  }

  const { job, status } = row;
  const today = isoDay(new Date());
  const left = remainingQty(job);
  // Closed by the supervisor: the bar greys out and there is nothing left to
  // book, but the history stays readable.
  const closed = row.completedToday;

  const book = () => {
    const qty = Number(draft || 0);
    if (![qty, Number(reject), Number(rework), Number(shiftOutput)].every((n) => Number.isFinite(n) && n >= 0)) return;
    if (qty === 0 && Number(reject) === 0 && Number(rework) === 0 && Number(shiftOutput) === 0 && !paused && !jobCompleted) return;
    recordProgress(job.id, today, qty);
    recordProduction(job.id, {
      date: today,
      complete: qty,
      reject: Number(reject),
      rework: Number(rework),
      shiftOutput: Number(shiftOutput),
      paused,
      pauseReason: paused ? pauseReason : null,
      jobCompleted,
      notes: notes.trim(),
    });
    setDraft('');
  };

  return (
    <div className="inspector">
      <div className="inspector-head">
        <h2>{String(job.id)}</h2>
        {closed && <Badge variant="neutral">Job completed</Badge>}
        <button
          type="button"
          className="inspector-close"
          aria-label="Close order details"
          title="Close"
          onClick={() => select(null)}
        >
          ×
        </button>
      </div>

      <dl className="kv">
        <dt>Part</dt>
        <dd>{String(job.partNum)}</dd>
        <dt>Description</dt>
        <dd>{job.description || '—'}</dd>
        <dt>Progress</dt>
        <dd>
          {job.completedQty} / {job.completedQty + left}
        </dd>
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

      <div className="job-badges" style={{ marginBottom: 10 }}>
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
        {row.waitingOnPredecessor && row.predecessor && (
          <Badge variant="neutral">Waits on {String(row.predecessor)}</Badge>
        )}
      </div>

      <div className="section-title">Crew &amp; pace</div>
      <dl className="kv">
        <dt>On the job</dt>
        <dd>
          {row.workers.length} / {MAX_WORKERS_PER_ORDER}
          {row.workers.length > 0 &&
            ` — ${row.workers.map((w) => w.name).join(', ')}`}
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

      <div className="section-title">Today&rsquo;s ASSY_Production entry</div>
      <div className="production-grid">
        <label>Shift output<input type="number" min={0} value={shiftOutput} onChange={(e) => setShiftOutput(e.target.value)} /></label>
        <label>Reject<input type="number" min={0} value={reject} onChange={(e) => setReject(e.target.value)} /></label>
        <label>Rework<input type="number" min={0} value={rework} onChange={(e) => setRework(e.target.value)} /></label>
        <label>Complete<input type="number" min={0} max={left} value={draft} placeholder={`≤ ${left}`} onChange={(e) => setDraft(e.target.value)} /></label>
      </div>
      <label className="pause-toggle">
        <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Pause
      </label>
      {paused && (
        <select className="production-input" value={pauseReason} onChange={(e) => setPauseReason(e.target.value as PauseReason)}>
          {PAUSE_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
        </select>
      )}
      <label className="pause-toggle">
        <input type="checkbox" checked={jobCompleted} onChange={(e) => setJobCompleted(e.target.checked)} /> Job Completed
      </label>
      <textarea className="production-input" value={notes} placeholder="Notes (optional)" onChange={(e) => setNotes(e.target.value)} />
      <div className="book">
        <input
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onKeyDown={(e) => e.key === 'Enter' && book()}
        />
        <Button variant="primary" onClick={book}>
          Save entry
        </Button>
      </div>
      <p className="hint">
        Entered at the end of the shift. Short of the daily target and the
        Expect Date slips out on its own.
      </p>

      {entries.length > 0 && (
        <>
          <div className="section-title">Booked</div>
          {entries.map((e) => (
            <div className="shortage-row" key={e.date}>
              <span className="part">{e.date}</span>
              <span>{e.qty} pcs</span>
            </div>
          ))}
        </>
      )}

      {productionEntries.length > 0 && (
        <>
          <div className="section-title">ASSY_Production history</div>
          {productionEntries.map((entry) => (
            <div className="production-history" key={entry.date}>
              <strong>{entry.date}</strong> · Shift output {entry.shiftOutput} · Complete {entry.complete} · Reject {entry.reject} · Rework {entry.rework}
              {entry.paused && ` · Paused: ${PAUSE_REASONS.find((r) => r.value === entry.pauseReason)?.label}`}
              {entry.jobCompleted && ' · Job Completed'}
            </div>
          ))}
        </>
      )}

      {row.material.shortages.length > 0 && (
        <>
          <div className="section-title">Short components</div>
          {row.material.shortages.map((s) => (
            <div className="shortage-row" key={String(s.componentPart)}>
              <span className="part">{String(s.componentPart)}</span>
              <span>
                need {s.requiredQty}, free {s.freeOnHand} (−{s.shortQty})
                {s.coverageDate
                  ? ` · PO ${s.poNum ?? ''} ${formatDay(s.coverageDate)}`
                  : ' · no PO'}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
