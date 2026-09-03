/**
 * One order's bar on the day grid. Draggable left/right to move its start day;
 * coloured by how the Expect Date compares with the Ship and Due dates.
 *
 * The bar spans start to Expect Date and is drawn as one block per stretch of
 * open days. Weekend gaps appear only while weekend columns are enabled; with
 * them hidden, Friday and Monday meet on the compact working-day axis.
 *
 * ## Short orders
 *
 * A couple of hours of work is a few pixels wide, and a label crammed into
 * those pixels came out as a single clipped character — which named nothing
 * and read as a graphical glitch. So the label lives *outside* a bar too
 * narrow to hold it, in the empty grid to its right, and a bar under half a
 * day says how long it is in hours as well: the block itself is down to its
 * minimum width by then and no longer means anything to the eye.
 */

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { OrderRow } from '@/engine/assembly/board';
import { addDays, workingSpans } from '@/engine/assembly/dates';
import { completedFraction, remainingHours } from '@/engine/assembly/duration';
import { MS_PER_DAY } from '@/lib/time';
import { barTag, timelineDayOffset } from './boardView';

export const DRAG_TYPE_BAR = 'order-bar';

/** Narrowest a block may be drawn and still be seen. */
const MIN_PIECE_PX = 10;

export function OrderBar({
  row,
  horizonStart,
  dayWidth,
  gridWidth,
  showWeekends,
  readOnly = false,
  selected,
  dependencyRelated,
  onSelect,
  onDependencyHover,
}: {
  row: OrderRow;
  horizonStart: Date;
  dayWidth: number;
  /** Full width of the day grid, so a tag near the end flips to the left. */
  gridWidth: number;
  showWeekends: boolean;
  /** PMD rows mirror the moulding plan — shown, never scheduled here. */
  readOnly?: boolean;
  selected: boolean;
  dependencyRelated: boolean;
  onSelect: (jobId: string, at?: { x: number; y: number }) => void;
  onDependencyHover: (jobId: string | null) => void;
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
        showWeekends,
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
        onMouseEnter={() => onDependencyHover(id)}
        onMouseLeave={() => onDependencyHover(null)}
      >
        no crew
      </button>
    );
  }

  const axisOffset = (date: Date) =>
    timelineDayOffset(date, horizonStart, showWeekends);
  const offsetDays = axisOffset(row.start);
  const left = offsetDays * dayWidth;
  const end = row.expectDate ?? row.planThrough ?? row.start;
  // When weekends are hidden, their zero-width dates are removed from the
  // coordinate system rather than leaving blank columns behind.
  const span = Math.max(0, axisOffset(end) - offsetDays);
  const width = Math.max(span * dayWidth, MIN_PIECE_PX * 2);

  // Two kinds of order run straight through: one the supervisor has approved
  // for the weekend, and a moulding row — the presses keep their own calendar,
  // and this lane mirrors their plan rather than restating it in our hours.
  const continuous = row.overtime || readOnly;
  const plannedSpans = row.crewDays?.map((day) => ({
    from: addDays(day.date, day.from),
    to: addDays(day.date, day.from + day.used),
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
  const completion = completedFraction(row.job);
  // Days of work already booked, in the same units as `WorkingSpan.worked`.
  const doneDays = completion * worked;

  const pieces = (
    spans.length > 0
      ? spans.map((piece) => ({
          key: piece.from.getTime(),
          left: (axisOffset(piece.from) - offsetDays) * dayWidth,
          width: Math.max(
            (axisOffset(piece.to) - axisOffset(piece.from)) * dayWidth,
            0,
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
        [{ key: 0, left: 0, width, done: 1 }]
  )
    .filter((piece) => piece.width > 0)
    .map((piece) => ({
      ...piece,
      width: Math.max(piece.width, MIN_PIECE_PX),
    }));

  // A weekend-only overtime piece disappears with the weekend columns.
  if (pieces.length === 0) return null;

  // A couple of hours of work is a few pixels of bar; where the label cannot
  // fit inside it, the tag goes in the empty grid beside the block.
  const tag = barTag({
    jobId: id,
    hours: remainingHours(row.job),
    spanDays: span,
    width,
    left,
    gridWidth,
    overtime: row.overtime,
  });

  return (
    <div
      ref={setNodeRef}
      data-job-id={id}
      className={`bar ${row.status.color} ${selected ? 'selected' : ''} ${
        isDragging ? 'dragging' : ''
      } ${dependencyRelated ? 'dependency-related' : ''} ${
        readOnly ? 'readonly' : ''
      } ${row.overtime ? 'overtime' : ''} ${
        pieces.length > 1 ? 'split' : ''
      } ${tag.stub ? 'stub' : ''} ${tag.outside ? 'tagged' : ''} ${
        tag.flip ? 'tag-left' : ''
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
      onMouseEnter={() => onDependencyHover(id)}
      onMouseLeave={() => onDependencyHover(null)}
      title={
        `${row.job.id} · ${row.days.toFixed(1)} d worked with ${row.workers.length}` +
        (readOnly ? '' : ` · position ${row.slot + 1} of ${row.line.parallelOrders}`) +
        (pieces.length > 1 ? ' · pauses over the weekend' : '') +
        (row.overtime ? ' · weekend overtime approved' : '') +
        ` · ${Math.round(completion * 100)}% complete` +
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
      {/* One tag, so that outside the bar the three parts stay together. */}
      <span className="bar-tag" data-job-label={id}>
        <span className="bar-label">{tag.text}</span>
        {row.overtime && (
          <span className="bar-ot" title="Weekend overtime approved">
            OT
          </span>
        )}
      </span>
    </div>
  );
}
