/**
 * One order's bar on the day grid. Draggable left/right to move its start day;
 * coloured by how the Expect Date compares with the Ship and Due dates.
 *
 * The bar spans calendar time — start to Expect Date — but is drawn as one
 * block per stretch of open days, so a weekend shows as a break in the work
 * rather than as work nobody does. Drawn as a single block it would have to be
 * either too short (worked days, stopping before its own Expect Date) or a lie
 * (calendar days, claiming the crew worked Saturday).
 */

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { OrderRow } from '@/engine/assembly/board';
import { addDays, wholeDaysBetween, workingSpans } from '@/engine/assembly/dates';
import { completedFraction } from '@/engine/assembly/duration';
import { PRODUCTIVE_HOURS_PER_PERSON } from '@/domain/assembly';
import { MS_PER_DAY } from '@/lib/time';

export const DRAG_TYPE_BAR = 'order-bar';

/** Narrowest a block may be drawn and still be seen. */
const MIN_PIECE_PX = 10;

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
  onSelect: (jobId: string, at?: { x: number; y: number }) => void;
}) {
  const id = String(row.job.id);
  const dragLocked = readOnly || Boolean(row.actualStart) || row.completedToday;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `bar:${id}`,
      disabled: dragLocked,
      // The drop handler moves the bar from where it is drawn, which is not
      // necessarily where the planner last pinned it: the line's capacity, a
      // predecessor or a weekend may have pushed it out. Sending the rendered
      // start makes the drag land exactly where the pointer let go.
      data: {
        type: DRAG_TYPE_BAR,
        jobId: id,
        startISO: row.start ? row.start.toISOString() : null,
        // The zoom is live, so the pixels-to-days conversion has to travel with
        // the drag rather than assume the default column width.
        dayWidth,
      },
    });

  if (!row.start || row.days === null) {
    return (
      <button
        type="button"
        className="bar-missing"
        title="No crew allocated — cannot schedule"
        onClick={(event) => {
          event.stopPropagation();
          onSelect(id, { x: event.clientX, y: event.clientY });
        }}
      >
        no crew
      </button>
    );
  }

  const offsetDays = wholeDaysBetween(row.start, horizonStart);
  const left = offsetDays * dayWidth;
  const end = row.expectDate ?? row.planThrough ?? row.start;
  // The whole calendar span, weekend included: the right-hand edge is the
  // Expect Date, which is the date the row itself shows.
  const span = Math.max(0, (end.getTime() - row.start.getTime()) / MS_PER_DAY);
  const width = Math.max(span * dayWidth, MIN_PIECE_PX * 2);

  // Two kinds of order run straight through: one the supervisor has approved
  // for the weekend, and a moulding row — the presses keep their own calendar,
  // and this lane mirrors their plan rather than restating it in our hours.
  const continuous = row.overtime || readOnly;
  const plannedSpans = row.crewDays?.map((day) => ({
    from: day.date,
    to: addDays(
      day.date,
      day.perWorkerHours / PRODUCTIVE_HOURS_PER_PERSON,
    ),
  }));
  const merged = (plannedSpans ?? []).reduce<{ from: Date; to: Date }[]>(
    (out, next) => {
      const previous = out.at(-1);
      if (previous && previous.to.getTime() === next.from.getTime()) {
        previous.to = next.to;
      } else {
        out.push({ ...next });
      }
      return out;
    },
    [],
  );
  let workedBefore = 0;
  const spans =
    row.crewDays && !readOnly
      ? merged.map((piece) => {
          const worked =
            (piece.to.getTime() - piece.from.getTime()) / MS_PER_DAY;
          const result = { ...piece, worked, workedBefore };
          workedBefore += worked;
          return result;
        })
      : workingSpans(row.start, end, continuous);
  const worked = spans.reduce((s, p) => s + p.worked, 0);
  // Days of work already booked, in the same units as `WorkingSpan.worked`.
  const doneDays = completedFraction(row.job) * worked;

  const pieces =
    spans.length > 0
      ? spans.map((piece) => ({
          key: piece.from.getTime(),
          left:
            ((piece.from.getTime() - row.start!.getTime()) / MS_PER_DAY) *
            dayWidth,
          width: Math.max(
            ((piece.to.getTime() - piece.from.getTime()) / MS_PER_DAY) *
              dayWidth,
            MIN_PIECE_PX,
          ),
          // How much of this stretch is already finished.
          done:
            piece.worked > 0
              ? Math.min(
                  1,
                  Math.max(0, (doneDays - piece.workedBefore) / piece.worked),
                )
              : 0,
        }))
      : // A closed order has no span left to draw, but still needs a handle.
        [{ key: 0, left: 0, width, done: 1 }];

  return (
    <div
      ref={setNodeRef}
      className={`bar ${row.status.color} ${selected ? 'selected' : ''} ${
        isDragging ? 'dragging' : ''
      } ${readOnly ? 'readonly' : ''} ${row.overtime ? 'overtime' : ''} ${
        pieces.length > 1 ? 'split' : ''
      }`}
      style={{
        left,
        width,
        transform: CSS.Translate.toString(transform),
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id, { x: e.clientX, y: e.clientY });
      }}
      title={
        `${row.job.id} · ${row.days.toFixed(1)} d worked with ${row.workers.length}` +
        (readOnly ? '' : ` · position ${row.slot + 1} of ${row.line.parallelOrders}`) +
        (pieces.length > 1 ? ' · pauses over the weekend' : '') +
        (row.overtime ? ' · weekend overtime approved' : '') +
        ` · ${row.status.reason}`
      }
      {...(dragLocked ? {} : listeners)}
      {...(dragLocked ? {} : attributes)}
    >
      {pieces.map((piece) => (
        <div
          key={piece.key}
          className="bar-piece"
          style={{ left: piece.left, width: piece.width }}
        >
          {piece.done > 0 && (
            <div
              className="bar-progress"
              style={{ width: `${piece.done * 100}%` }}
            />
          )}
        </div>
      ))}
      <span className="bar-label">{String(row.job.id)}</span>
      {row.overtime && (
        <span className="bar-ot" title="Weekend overtime approved">
          OT
        </span>
      )}
      {row.waitingOn && (
        <span
          className="bar-wait"
          title={
            `Held until ${String(row.waitingOn.onJobId)} is finished` +
            (row.waitingOn.part ? ` — it makes ${String(row.waitingOn.part)}` : '')
          }
        >
          ⇠
        </span>
      )}
    </div>
  );
}
