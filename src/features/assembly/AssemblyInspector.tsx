/**
 * Detail panel for the selected assembly order.
 *
 * This is where the supervisor books the shift: enter what was finished today
 * and the Expect Date moves on its own — short of target it slips out, ahead of
 * target it pulls in. Also shows what crew size would be needed to hold the
 * ship date, and the material picture behind the release gate.
 */

import { useState } from 'react';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import { findOrderRow } from '@/store/assemblySelectors';
import { usePlanStore } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import {
  MAX_WORKERS_PER_ORDER,
  ORDER_TYPE_LABEL,
  type MaterialPrepStatus,
} from '@/domain/assembly';
import { remainingQty } from '@/engine/assembly/duration';
import { formatDay } from '@/lib/time';
import { Badge, Button } from '@/ui';

const PREP_LABEL: Record<MaterialPrepStatus, string> = {
  'not-prepared': 'Not prepared',
  preparing: 'Preparing',
  ready: 'Ready',
  shortage: 'Shortage',
};

const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

export function AssemblyInspector({ board }: { board: AssemblyGanttView }) {
  const selectedJobId = useUiStore((s) => s.selectedJobId);
  const row = findOrderRow(board, selectedJobId);
  const recordProgress = usePlanStore((s) => s.recordProgress);
  const entries = usePlanStore((s) =>
    selectedJobId ? (s.progress[selectedJobId] ?? []) : [],
  );
  const [draft, setDraft] = useState('');

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

  const book = () => {
    const qty = Number(draft);
    if (!Number.isFinite(qty) || qty <= 0) return;
    recordProgress(job.id, today, qty);
    setDraft('');
  };

  return (
    <div className="inspector">
      <h2>{String(job.id)}</h2>

      <dl className="kv">
        <dt>Part</dt>
        <dd>{String(job.partNum)}</dd>
        <dt>Description</dt>
        <dd>{job.description || '—'}</dd>
        <dt>Work order</dt>
        <dd>{job.orderType ? ORDER_TYPE_LABEL[job.orderType] : '—'}</dd>
        <dt>Line</dt>
        <dd>{row.line.name}</dd>
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

      <div className="section-title">Book today&rsquo;s output</div>
      <div className="book">
        <input
          type="number"
          min={0}
          max={left}
          value={draft}
          placeholder={`qty finished (≤ ${left})`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && book()}
        />
        <Button variant="primary" onClick={book} disabled={draft === ''}>
          Book
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
