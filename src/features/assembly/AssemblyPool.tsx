/**
 * Assembly orders not on a line yet — the day's new work. Drop an order here
 * to take it off the schedule.
 */

import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import type { Job } from '@/domain/types';
import { ORDER_TYPE_SHORT } from '@/domain/assembly';
import { POOL_ID } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import { formatDay } from '@/lib/time';

function PoolCard({
  job,
  selected,
  onSelect,
}: {
  job: Job;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const id = String(job.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type: 'job', jobId: id },
  });
  return (
    <div
      ref={setNodeRef}
      className={`ord ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={() => onSelect(id)}
      {...listeners}
      {...attributes}
    >
      <div className="ord-head">
        <span className="ord-job">{id}</span>
        {job.orderType && (
          <span className="ord-type">{ORDER_TYPE_SHORT[job.orderType]}</span>
        )}
      </div>
      <div className="ord-desc">{job.description || String(job.partNum)}</div>
      <div className="ord-meta">
        <span>{job.remainingQty} pcs</span>
        <span>·</span>
        <span>ship {job.shipDate ? formatDay(job.shipDate) : '—'}</span>
      </div>
    </div>
  );
}

export function AssemblyPool({ board }: { board: AssemblyGanttView }) {
  const { setNodeRef, isOver } = useDroppable({
    id: POOL_ID,
    data: { type: 'pool' },
  });
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);

  return (
    <div ref={setNodeRef} className={`pool ${isOver ? 'drop-active' : ''}`}>
      <h2>New / unassigned · {board.pool.length}</h2>
      <div className="pool-list">
        {board.pool.length === 0 ? (
          <div className="pool-empty">
            Every order is on a line. Drag one here to take it off.
          </div>
        ) : (
          board.pool.map((job) => (
            <PoolCard
              key={String(job.id)}
              job={job}
              selected={selectedJobId === String(job.id)}
              onSelect={select}
            />
          ))
        )}
      </div>
    </div>
  );
}
