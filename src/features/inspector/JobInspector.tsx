/**
 * Detail panel for the selected job: its routing, the changeover it triggers,
 * full material-shortage breakdown (with the date a PO clears each shortfall),
 * and any plan warnings.
 */

import type { BoardView } from '@/store/selectors';
import { findScheduledJob } from '@/store/selectors';
import { useUiStore } from '@/store/uiStore';
import { Badge } from '@/ui';
import { formatDateTime, formatDay, formatDuration } from '@/lib/time';
import { ChangeoverBadge } from '../gantt/ChangeoverBadge';
import { MaterialStatusBadge } from '../gantt/MaterialStatusBadge';

export function JobInspector({ board }: { board: BoardView }) {
  const selectedJobId = useUiStore((s) => s.selectedJobId);
  const scheduled = findScheduledJob(board, selectedJobId);
  const job = selectedJobId ? board.jobsById.get(selectedJobId) : null;

  if (!job) {
    return (
      <div className="inspector">
        <h2>Inspector</h2>
        <div className="pool-empty">Select a job to see its details.</div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <h2>{String(job.id)}</h2>

      <dl className="kv">
        <dt>Part</dt>
        <dd>{String(job.partNum)}</dd>
        <dt>Description</dt>
        <dd>{job.description || '—'}</dd>
        <dt>Qty</dt>
        <dd>{job.remainingQty}</dd>
        <dt>Labour</dt>
        <dd>{formatDuration(job.laborHrs)}</dd>
        <dt>Due</dt>
        <dd>{job.dueDate ? formatDay(job.dueDate) : '—'}</dd>
        <dt>Released</dt>
        <dd>{job.released ? 'Yes' : 'No'}</dd>
        {scheduled ? (
          <>
            <dt>Line</dt>
            <dd>{String(scheduled.machine)}</dd>
            <dt>Start</dt>
            <dd>{formatDateTime(scheduled.start)}</dd>
            <dt>Finish</dt>
            <dd>{formatDateTime(scheduled.end)}</dd>
          </>
        ) : (
          <>
            <dt>Line</dt>
            <dd>Unscheduled</dd>
          </>
        )}
      </dl>

      {scheduled && (
        <>
          <div className="section-title">Setup / changeover</div>
          <div className="job-badges" style={{ marginBottom: 10 }}>
            {scheduled.changeover.required ? (
              <ChangeoverBadge changeover={scheduled.changeover} />
            ) : (
              <Badge variant="ok">No changeover</Badge>
            )}
          </div>
          {scheduled.routing && (
            <dl className="kv">
              <dt>Die / tool</dt>
              <dd>{scheduled.routing.tool ?? '—'}</dd>
              <dt>Colour</dt>
              <dd>{scheduled.routing.color ?? '—'}</dd>
              <dt>Insert</dt>
              <dd>{scheduled.routing.insert ?? '—'}</dd>
            </dl>
          )}

          <div className="section-title">Material</div>
          <div className="job-badges" style={{ marginBottom: 6 }}>
            <MaterialStatusBadge material={scheduled.material} />
          </div>
          {scheduled.material.shortages.length > 0 && (
            <div>
              {scheduled.material.shortages.map((s) => (
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
            </div>
          )}

          {scheduled.warnings.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>
                Warnings
              </div>
              <ul className="warn-list">
                {scheduled.warnings.map((w, i) => (
                  <li key={i}>
                    <span className={`dot ${w.severity}`} />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
