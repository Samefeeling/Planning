/**
 * The main board: a sticky time axis above ten-plus machine lanes. Day labels
 * and shift gridlines give the timeline scale; a "now" line marks the present.
 */

import type { BoardView } from '@/store/selectors';
import { useUiStore } from '@/store/uiStore';
import { hoursToPx } from '@/engine/duration';
import {
  diffHours,
  floorToDay,
  formatDay,
  MS_PER_DAY,
} from '@/lib/time';
import { MachineLane } from './MachineLane';

const LANE_LABEL_WIDTH = 132; // keep in sync with --label-w
const SHIFT_HOURS = 8;
const MIN_TRACK_PX = 640;

export function GanttBoard({ board }: { board: BoardView }) {
  const pxPerHour = useUiStore((s) => s.pxPerHour);
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);

  const totalHours = diffHours(board.horizonEnd, board.horizonStart);
  const trackWidth = Math.max(hoursToPx(totalHours, pxPerHour), MIN_TRACK_PX);

  // Day labels at each midnight.
  const dayTicks: { left: number; label: string }[] = [];
  for (
    let d = floorToDay(board.horizonStart);
    d <= board.horizonEnd;
    d = new Date(d.getTime() + MS_PER_DAY)
  ) {
    const left = hoursToPx(diffHours(d, board.horizonStart), pxPerHour);
    if (left < -2) continue;
    dayTicks.push({ left, label: formatDay(d) });
  }

  // Shift gridlines every 8h.
  const shiftXs: number[] = [];
  for (let h = 0; h <= totalHours; h += SHIFT_HOURS) {
    shiftXs.push(hoursToPx(h, pxPerHour));
  }

  const nowLeft = hoursToPx(diffHours(new Date(), board.horizonStart), pxPerHour);
  const showNow = nowLeft >= 0 && nowLeft <= trackWidth;

  return (
    <div className="gantt" style={{ minWidth: trackWidth + LANE_LABEL_WIDTH }}>
      <div className="gantt-axis">
        <div className="corner" />
        <div className="ticks" style={{ width: trackWidth }}>
          {dayTicks.map((t, i) => (
            <div key={i} className="axis-tick" style={{ left: t.left }}>
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {showNow && (
        <div
          className="axis-now"
          style={{ left: LANE_LABEL_WIDTH + nowLeft, top: 30 }}
        />
      )}

      {board.lanes.map((lane) => (
        <MachineLane
          key={String(lane.machine.id)}
          lane={lane}
          horizonStart={board.horizonStart}
          pxPerHour={pxPerHour}
          trackWidth={trackWidth}
          gridXs={shiftXs}
          selectedJobId={selectedJobId}
          onSelect={select}
        />
      ))}
    </div>
  );
}
