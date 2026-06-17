/**
 * One production line: a sticky label plus a time track on which jobs are
 * placed by their computed start, with bar width = labour hours. A hatched
 * marker before a bar flags the changeover that precedes it.
 */

import { useDroppable } from '@dnd-kit/core';
import type { LaneView } from '@/store/selectors';
import { hoursToPx, changeoverHours } from '@/engine/duration';
import { diffHours } from '@/lib/time';
import { JobCard } from './JobCard';

interface MachineLaneProps {
  lane: LaneView;
  horizonStart: Date;
  pxPerHour: number;
  trackWidth: number;
  /** X positions (px) for shift gridlines within the track. */
  gridXs: number[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
}

const MIN_BAR_PX = 26;

export function MachineLane({
  lane,
  horizonStart,
  pxPerHour,
  trackWidth,
  gridXs,
  selectedJobId,
  onSelect,
}: MachineLaneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: String(lane.machine.id),
    data: { type: 'lane', machineId: String(lane.machine.id) },
  });

  const setupHrs = (mins: number) => changeoverHours(mins);

  return (
    <div className="lane">
      <div className="lane-label" title={lane.machine.name}>
        <span className="name">{lane.machine.name}</span>
        <span className="meta">
          {lane.jobs.length} job{lane.jobs.length === 1 ? '' : 's'} ·{' '}
          {lane.totalRunHours.toFixed(0)}h
          {lane.totalSetupMinutes > 0
            ? ` · ${(lane.totalSetupMinutes / 60).toFixed(1)}h C/O`
            : ''}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`lane-track ${isOver ? 'drop-active' : ''}`}
        style={{ width: trackWidth }}
      >
        {gridXs.map((x, i) => (
          <div key={i} className="grid-line shift" style={{ left: x }} />
        ))}

        {lane.jobs.map((sj) => {
          const left = hoursToPx(diffHours(sj.start, horizonStart), pxPerHour);
          const width = Math.max(
            hoursToPx(sj.runHours, pxPerHour),
            MIN_BAR_PX,
          );
          const setupPx = hoursToPx(setupHrs(sj.changeover.minutes), pxPerHour);
          const markerLeft = left - setupPx;

          return (
            <div key={String(sj.job.id)}>
              {sj.changeover.required && setupPx > 3 && markerLeft >= 0 && (
                <div
                  className="changeover-marker"
                  style={{ left: markerLeft, width: Math.max(setupPx, 5) }}
                  title={`${sj.changeover.summary} · ~${Math.round(
                    sj.changeover.minutes,
                  )} min`}
                />
              )}
              <JobCard
                job={sj.job}
                scheduled={sj}
                variant="timeline"
                style={{ left, width }}
                selected={selectedJobId === String(sj.job.id)}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
