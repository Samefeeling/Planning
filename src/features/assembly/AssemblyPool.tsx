/**
 * Assembly orders not on a line yet — the day's new work. Drop an order here
 * to take it off the schedule.
 *
 * It shows nothing at all when every order is on a line, which is the normal
 * state of a working board: a heading over an empty box was only taking room
 * from the order detail underneath. The drop zone reappears the moment
 * something is being dragged, so an order can still be taken off a line.
 */

import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core';
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
  const { active } = useDndContext();

  const empty = board.pool.length === 0;
  if (empty && !active) return null;

  return (
    <div
      ref={setNodeRef}
      className={`pool ${empty ? 'target-only' : ''} ${isOver ? 'drop-active' : ''}`}
    >
      {empty ? (
        <div className="pool-target">Drop here to take the order off its line</div>
      ) : (
        <div className="pool-list">
          {board.pool.map((job) => (
            <PoolCard
              key={String(job.id)}
              job={job}
              selected={selectedJobId === String(job.id)}
              onSelect={select}
            />
          ))}
        </div>
      )}
    </div>
  );
}
