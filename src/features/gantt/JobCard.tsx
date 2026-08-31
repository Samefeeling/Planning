/**
 * A production order on the board. Draggable between lanes and the pool; on a
 * lane its width encodes Calculated_LaborHrs, and corner badges show whether a
 * changeover is needed and whether material is ready.
 */

import type { CSSProperties } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Job, ScheduledJob } from '@/domain/types';
import { formatDuration } from '@/lib/time';
import { ChangeoverBadge } from './ChangeoverBadge';
import { MaterialStatusBadge } from './MaterialStatusBadge';

export const DRAG_TYPE_JOB = 'job';

interface JobCardProps {
  job: Job;
  scheduled?: ScheduledJob;
  variant: 'timeline' | 'pool';
  /** Positioning style for timeline variant (left/width). */
  style?: CSSProperties;
  selected?: boolean;
  onSelect?: (jobId: string) => void;
}

/** Pure visual content, reused by the drag overlay. */
export function JobCardBody({
  job,
  scheduled,
  variant,
}: Pick<JobCardProps, 'job' | 'scheduled' | 'variant'>) {
  const hours = scheduled?.runHours ?? job.laborHrs;
  return (
    <>
      <div className="job-title">{String(job.id)}</div>
      <div className="job-sub">
        {String(job.partNum)} · {formatDuration(hours)}
        {variant === 'pool' && job.description ? ` · ${job.description}` : ''}
      </div>
      {scheduled && (
        <div className="job-badges">
          <ChangeoverBadge changeover={scheduled.changeover} compact />
          <MaterialStatusBadge material={scheduled.material} compact />
        </div>
      )}
    </>
  );
}

export function JobCard({
  job,
  scheduled,
  variant,
  style,
  selected = false,
  onSelect,
}: JobCardProps) {
  const id = String(job.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type: DRAG_TYPE_JOB, jobId: id },
  });
  // Also a drop target so dragging onto a card inserts before it (ordering).
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${id}`,
    data: { type: 'card', jobId: id },
  });

  const matClass = scheduled ? `mat-${scheduled.material.level}` : '';
  const cls = [
    'job',
    variant === 'pool' ? 'compact' : '',
    matClass,
    selected ? 'selected' : '',
    isDragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      className={cls}
      style={style}
      onClick={() => onSelect?.(id)}
      title={`${job.id} — ${job.description || job.partNum}`}
      {...listeners}
      {...attributes}
    >
      <JobCardBody job={job} scheduled={scheduled} variant={variant} />
    </div>
  );
}
