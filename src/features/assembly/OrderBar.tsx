/**
 * One order's bar on the day grid. Draggable left/right to move its start day;
 * coloured by how the Expect Date compares with the Ship and Due dates.
 */

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { OrderRow } from '@/engine/assembly/board';
import { wholeDaysBetween } from '@/engine/assembly/dates';
import { completedFraction } from '@/engine/assembly/duration';

export const DRAG_TYPE_BAR = 'order-bar';

export function OrderBar({
  row,
  horizonStart,
  dayWidth,
  readOnly = false,
  selected,
  onSelect,
}: {
  row: OrderRow;
  horizonStart: Date;
  dayWidth: number;
  /** PMD rows mirror the moulding plan — shown, never scheduled here. */
  readOnly?: boolean;
  selected: boolean;
  onSelect: (jobId: string) => void;
}) {
  const id = String(row.job.id);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `bar:${id}`,
      data: { type: DRAG_TYPE_BAR, jobId: id },
    });

  if (!row.start || row.days === null) {
    return (
      <div className="bar-missing" title="No crew allocated — cannot schedule">
        no crew
      </div>
    );
  }

  const offsetDays = wholeDaysBetween(row.start, horizonStart);
  const left = offsetDays * dayWidth;
  const width = Math.max(row.days * dayWidth, 34);
  const done = completedFraction(row.job);

  return (
    <div
      ref={setNodeRef}
      className={`bar ${row.status.color} ${selected ? 'selected' : ''} ${
        isDragging ? 'dragging' : ''
      } ${readOnly ? 'readonly' : ''}`}
      style={{
        left,
        width,
        transform: CSS.Translate.toString(transform),
      }}
      onClick={() => onSelect(id)}
      title={`${row.job.id} · ${row.days.toFixed(1)} d with ${
        row.workers.length
      } · ${row.status.reason}`}
      {...(readOnly ? {} : listeners)}
      {...(readOnly ? {} : attributes)}
    >
      {done > 0 && (
        <div className="bar-progress" style={{ width: `${done * 100}%` }} />
      )}
      <span className="bar-label">{String(row.job.id)}</span>
      {row.waitingOnPredecessor && (
        <span className="bar-wait" title="Waiting on the previous order">
          ⇠
        </span>
      )}
    </div>
  );
}
