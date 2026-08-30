/**
 * An assembly production order. Draggable between area columns; shows the
 * route position, material verdict and whether the supervisor may release it.
 *
 * The layout matches the Live Status card in the MES spec, so when the event
 * log lands this card gains progress and team without a redesign.
 */

import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { AssemblyOrderView } from '@/engine/assembly/board';
import { ROUTES } from '@/domain/assembly';
import { formatDay, formatDuration } from '@/lib/time';
import { Badge } from '@/ui';

const TYPE_LABEL: Record<string, string> = {
  A: 'A · Table / General',
  B: 'B · Sofa',
  C: 'C · Chair Uph.',
};

/** Route progress as filled/empty pips, e.g. Cutting → Frame → Upholstery. */
function RoutePips({ order }: { order: AssemblyOrderView }) {
  const route = order.route.length
    ? order.route
    : ROUTES[order.job.productType ?? 'A'];
  return (
    <span className="pips" title={route.join(' → ')}>
      {route.map((s, i) => (
        <span
          key={s}
          className={`pip ${i < order.stageIndex ? 'done' : ''} ${
            i === order.stageIndex ? 'current' : ''
          }`}
        />
      ))}
    </span>
  );
}

export function OrderCard({
  order,
  selected,
  onSelect,
}: {
  order: AssemblyOrderView;
  selected: boolean;
  onSelect: (jobId: string) => void;
}) {
  const id = String(order.job.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type: 'job', jobId: id },
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${id}`,
    data: { type: 'card', jobId: id },
  });

  const { job, release } = order;

  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        setDropRef(n);
      }}
      className={`ord rel-${release.level} ${selected ? 'selected' : ''} ${
        isDragging ? 'dragging' : ''
      }`}
      onClick={() => onSelect(id)}
      title={`${job.id} — ${job.description}`}
      {...listeners}
      {...attributes}
    >
      <div className="ord-head">
        <span className="ord-job">{String(job.id)}</span>
        <span className="ord-type" title={TYPE_LABEL[job.productType ?? '']}>
          {job.productType ?? '—'}
        </span>
      </div>

      <div className="ord-desc">{job.description || String(job.partNum)}</div>

      <div className="ord-meta">
        <span className="ord-part">{String(job.partNum)}</span>
        <span>·</span>
        <span>{job.remainingQty} pcs</span>
        <span>·</span>
        <span>{formatDuration(job.laborHrs)}</span>
      </div>

      <div className="ord-foot">
        <RoutePips order={order} />
        {order.stage && <span className="ord-stage">{order.stage.name}</span>}
        <span className="spacer" />
        {job.dueDate && (
          <span className="ord-due">{formatDay(job.dueDate)}</span>
        )}
      </div>

      <div className="ord-badges">
        <Badge
          variant={
            release.level === 'ready'
              ? 'ok'
              : release.level === 'caution'
                ? 'warn'
                : 'error'
          }
          title={release.reason}
        >
          {release.level === 'ready'
            ? 'Ready'
            : release.level === 'caution'
              ? release.reason
              : 'Blocked'}
        </Badge>
        {job.priority <= 1 && <Badge variant="error">P1</Badge>}
        {!job.released && <Badge variant="neutral">Unreleased</Badge>}
      </div>
    </div>
  );
}
