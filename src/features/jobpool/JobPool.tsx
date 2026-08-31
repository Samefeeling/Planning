/**
 * The backlog of un-scheduled production orders. It's a drop target, so a
 * planner can drag a job out of a line to park it here, or drag one onto a
 * line to schedule it.
 */

import { useDroppable } from '@dnd-kit/core';
import type { Job } from '@/domain/types';
import { POOL_ID } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import { JobCard } from '../gantt/JobCard';

export function JobPool({ jobs }: { jobs: Job[] }) {
  const { setNodeRef, isOver } = useDroppable({
    id: POOL_ID,
    data: { type: 'pool' },
  });
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);

  return (
    <div ref={setNodeRef} className={`pool ${isOver ? 'drop-active' : ''}`}>
      <h2>Unscheduled · {jobs.length}</h2>
      <div className="pool-list">
        {jobs.length === 0 ? (
          <div className="pool-empty">
            Every order is on a line. Drag a bar here to un-schedule it.
          </div>
        ) : (
          jobs.map((job) => (
            <JobCard
              key={String(job.id)}
              job={job}
              variant="pool"
              selected={selectedJobId === String(job.id)}
              onSelect={select}
            />
          ))
        )}
      </div>
    </div>
  );
}
