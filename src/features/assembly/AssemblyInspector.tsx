/**
 * Detail panel for a selected assembly order: route position, the release
 * gate (engine verdict + handler's kit state), full shortage breakdown and
 * warnings. Mirrors the moulding inspector.
 */

import type { AssemblyBoardView } from '@/engine/assembly/board';
import { findAssemblyOrder } from '@/store/assemblySelectors';
import { useUiStore } from '@/store/uiStore';
import { STAGES, type MaterialPrepStatus } from '@/domain/assembly';
import { formatDay, formatDuration } from '@/lib/time';
import { Badge } from '@/ui';

const PREP_LABEL: Record<MaterialPrepStatus, string> = {
  'not-prepared': 'Not prepared',
  preparing: 'Preparing',
  ready: 'Ready',
  shortage: 'Shortage',
};

export function AssemblyInspector({ board }: { board: AssemblyBoardView }) {
  const selectedJobId = useUiStore((s) => s.selectedJobId);
  const order = findAssemblyOrder(board, selectedJobId);
  const job = selectedJobId ? board.jobsById.get(selectedJobId) : null;

  if (!job) {
    return (
      <div className="inspector">
        <h2>Inspector</h2>
        <div className="pool-empty">Select an order to see its details.</div>
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
        <dt>Type</dt>
        <dd>{job.productType ?? '—'}</dd>
        <dt>Qty</dt>
        <dd>{job.remainingQty}</dd>
        <dt>Std hours</dt>
        <dd>{formatDuration(job.laborHrs)}</dd>
        <dt>Due</dt>
        <dd>{job.dueDate ? formatDay(job.dueDate) : '—'}</dd>
        <dt>Priority</dt>
        <dd>P{job.priority}</dd>
        <dt>Kit</dt>
        <dd>{PREP_LABEL[job.materialPrep]}</dd>
      </dl>

      {order && (
        <>
          <div className="section-title">Route</div>
          <ol className="route">
            {order.route.map((s, i) => (
              <li
                key={s}
                className={
                  i < order.stageIndex
                    ? 'done'
                    : i === order.stageIndex
                      ? 'current'
                      : ''
                }
              >
                {STAGES[s].name}
              </li>
            ))}
          </ol>

          <div className="section-title">Release</div>
          <div className="job-badges" style={{ marginBottom: 8 }}>
            <Badge
              variant={
                order.release.level === 'ready'
                  ? 'ok'
                  : order.release.level === 'caution'
                    ? 'warn'
                    : 'error'
              }
            >
              {order.release.reason}
            </Badge>
            {order.release.needsOverride && (
              <Badge variant="neutral">Supervisor override required</Badge>
            )}
          </div>

          {order.material.shortages.length > 0 && (
            <>
              <div className="section-title">Short components</div>
              {order.material.shortages.map((s) => (
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

          {order.warnings.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>
                Warnings
              </div>
              <ul className="warn-list">
                {order.warnings.map((w, i) => (
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
