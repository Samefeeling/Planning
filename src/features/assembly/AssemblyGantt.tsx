/**
 * The assembly main board.
 *
 * Left: one row per order with its dates and crew. Right: the day grid with
 * the draggable bar. Row groups are the lines — PMD first, shown for context
 * only, then the three schedulable assembly lines.
 *
 * The board opens on the previous working day, so the shift that has just
 * finished is still there to be compared against the plan; a line down today's
 * column says where the shift has got to.
 */

import { useDroppable } from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import type {
  AssemblyGanttView,
  LineGroup,
  OrderRow,
} from '@/engine/assembly/board';
import {
  ORDER_TYPE_SHORT,
  SHIFT_END_HOUR,
  SHIFT_START_HOUR,
} from '@/domain/assembly';
import { addDays, shiftFraction } from '@/engine/assembly/dates';
import { boardDayLoads, rosterLoad } from '@/engine/assembly/workload';
import {
  MAX_ORDER_WIDTH,
  MIN_ORDER_WIDTH,
  useUiStore,
  type ClickPoint,
  type DateCol,
  type DateCols,
} from '@/store/uiStore';
import { OrderBar } from './OrderBar';
import { TeamChips } from './TeamChips';
import { WorkerLoadChip } from './WorkerLoadChip';

// Must match the widths in index.css (--qty-w, --date-w x4, --team-w),
// otherwise the header's day columns drift out of line with the row tracks.
// The Order column is the exception: it is dragged, so it comes from the store
// and is pushed back into CSS as --order-w.
const QTY_W = 58;
const DATE_W = 62;
const TEAM_W = 172;

/** How often the "now" line catches up with the clock. */
const CLOCK_TICK_MS = 5 * 60 * 1000;

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'numeric',
});
const SHORT_FMT = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const fmt = (d: Date | null): string => (d ? SHORT_FMT.format(d) : '—');

/** A clock hour as text — 15.5 reads as 15:30. */
const hourLabel = (h: number): string =>
  TIME_FMT.format(
    new Date(2000, 0, 1, Math.floor(h), Math.round((h % 1) * 60)),
  );

/**
 * The time of day Epicor scheduled the order to start (`JobHead_StartHour`).
 * Midnight means the export carried no hour, so there is nothing to show.
 */
const startTime = (d: Date | null): string | null =>
  d && (d.getHours() !== 0 || d.getMinutes() !== 0) ? TIME_FMT.format(d) : null;

function OrderRowView({
  row,
  board,
  gridWidth,
  selected,
  onSelect,
  dayWidth,
  orderWidth,
  visibleDates,
}: {
  row: OrderRow;
  board: AssemblyGanttView;
  gridWidth: number;
  selected: boolean;
  onSelect: (id: string, at?: ClickPoint) => void;
  dayWidth: number;
  orderWidth: number;
  visibleDates: DateCols;
}) {
  const isContext = !row.line.schedulable;
  let dateOffset = orderWidth + QTY_W;
  const frozenDate = (visible: boolean): React.CSSProperties | undefined => {
    if (!visible) return undefined;
    const style = { left: dateOffset };
    dateOffset += DATE_W;
    return style;
  };
  const startStyle = frozenDate(visibleDates.start);
  const dueStyle = frozenDate(visibleDates.due);
  const expectStyle = frozenDate(visibleDates.expect);
  const shipStyle = frozenDate(visibleDates.ship);
  const startAt = row.job.startDate;
  const orderQty = row.job.remainingQty + row.job.completedQty;
  return (
    <div
      className={`arow ${selected ? 'selected' : ''} ${isContext ? 'context' : ''} ${row.completedToday ? 'completed-today' : ''}`}
      // The detail opens beside the pointer, so the click has to say where
      // it was — see AssemblyInspector.
      onClick={(e) => onSelect(String(row.job.id), { x: e.clientX, y: e.clientY })}
    >
      <div className="acell order">
        <span className="order-id">{String(row.job.id)}</span>
        {row.job.orderType && (
          <span className="order-type">
            {ORDER_TYPE_SHORT[row.job.orderType]}
          </span>
        )}
        <span className="order-desc">{row.job.description}</span>
      </div>
      {/* Ordered quantity, with what is still to make under it. */}
      <div
        className="acell qty frozen"
        style={{ left: orderWidth }}
        title={`${orderQty} ordered · ${row.job.remainingQty} still to make`}
      >
        <span>{orderQty}</span>
        {row.job.completedQty > 0 && (
          <span className="qty-left">{row.job.remainingQty} left</span>
        )}
      </div>
      {visibleDates.start && (
        <div
          className="acell date frozen start"
          style={startStyle}
          title={startAt ? `Scheduled start ${startAt.toLocaleString()}` : 'No scheduled start in the export'}
        >
          <span>{fmt(startAt)}</span>
          {startTime(startAt) && (
            <span className="date-hour">{startTime(startAt)}</span>
          )}
        </div>
      )}
      {visibleDates.due && <div className="acell date frozen" style={dueStyle}>{fmt(row.job.dueDate)}</div>}
      {visibleDates.expect && <div className={`acell date expect frozen ${row.status.color}`} style={expectStyle}>
        {fmt(row.expectDate)}
      </div>}
      {visibleDates.ship && <div className="acell date frozen" style={shipStyle}>{fmt(row.job.shipDate)}</div>}
      <div className="acell team frozen" style={{ left: dateOffset }}>
        {isContext ? (
          <span className="chip empty">moulding</span>
        ) : (
          <TeamChips row={row} roster={board.workers} />
        )}
      </div>
      <div className="acell track" style={{ width: gridWidth }}>
        <OrderBar
          row={row}
          horizonStart={board.horizonStart}
          dayWidth={dayWidth}
          readOnly={isContext}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

/**
 * A line and its orders. Schedulable lines are drop targets, so an order can be
 * dragged here from the pool, from another line, or by its own bar.
 */
function LineGroupView({
  group,
  board,
  gridWidth,
  selectedJobId,
  onSelect,
  dayWidth,
  orderWidth,
  visibleDates,
  collapsed,
  onToggle,
}: {
  group: LineGroup;
  board: AssemblyGanttView;
  gridWidth: number;
  selectedJobId: string | null;
  onSelect: (id: string, at?: ClickPoint) => void;
  dayWidth: number;
  orderWidth: number;
  visibleDates: DateCols;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: String(group.line.id),
    data: { type: 'line', lineId: String(group.line.id) },
    disabled: !group.line.schedulable,
  });
  const load = group.load;

  return (
    <section
      ref={setNodeRef}
      className={`agroup ${isOver ? 'drop-active' : ''}`}
    >
      <button type="button" className="agroup-label" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="agroup-chevron">{collapsed ? '▸' : '▾'}</span>
        <span className="agroup-name">{group.line.name}</span>
        {!group.line.schedulable && (
          <span className="agroup-note">plan only</span>
        )}
        <span className="agroup-count">{group.rows.length}</span>

        {/* The line's own work load: remaining standard hours, and how long
            the crew on it needs to clear them. */}
        <span
          className="agroup-load"
          title="Work load — standard hours still to run on this line"
        >
          {load.hours.toFixed(1)} h
        </span>
        {group.line.schedulable && (
          <span className="agroup-crew">
            {load.crew === 0
              ? 'nobody allocated'
              : `${load.crew} on line · ${load.daysOfWork!.toFixed(1)} d at ${load.capacityPerDay.toFixed(1)} h/day`}
          </span>
        )}
        {load.needsCrew > 0 && (
          <span className="agroup-gap">{load.needsCrew} need crew</span>
        )}
      </button>

      {!collapsed && (group.rows.length === 0 ? (
        <div className="arow empty">
          <div className="acell order">
            {group.line.schedulable
              ? 'Drop an order here'
              : 'No orders on this line'}
          </div>
        </div>
      ) : (
        group.rows.map((row) => (
          <OrderRowView
            key={String(row.job.id)}
            row={row}
            board={board}
            gridWidth={gridWidth}
            selected={selectedJobId === String(row.job.id)}
            onSelect={onSelect}
            dayWidth={dayWidth}
            orderWidth={orderWidth}
            visibleDates={visibleDates}
          />
        ))
      ))}
    </section>
  );
}

export function AssemblyGantt({ board }: { board: AssemblyGanttView }) {
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);
  const dayWidth = useUiStore((s) => s.dayWidth);
  const orderWidth = useUiStore((s) => s.orderWidth);
  const setOrderWidth = useUiStore((s) => s.setOrderWidth);
  const visibleDates = useUiStore((s) => s.dateCols);
  const toggleDate = useUiStore((s) => s.toggleDateCol);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // The clock behind the "now" line. Five minutes is as fine as the line is
  // worth reading, and it keeps the board from re-rendering every second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const days = Array.from({ length: board.horizonDays }, (_, i) =>
    addDays(board.horizonStart, i),
  );
  const gridWidth = board.horizonDays * dayWidth;
  const dateCount = Object.values(visibleDates).filter(Boolean).length;
  const labelWidth = orderWidth + QTY_W + DATE_W * dateCount + TEAM_W;
  const attendance = board.workers.filter((worker) => worker.onShift);
  const allRows = useMemo(
    () => board.groups.flatMap((group) => group.rows),
    [board],
  );
  // Every name in the header carries five load squares, so the whole roster's
  // week is worked out once here rather than once per chip on every render.
  // From today: the week to come is what a supervisor allocates against.
  const rosterLoads = useMemo(
    () => rosterLoad(board.workers, allRows, board.today),
    [board, allRows],
  );
  const allocated = new Set(
    allRows.flatMap((row) => row.workers.map((worker) => String(worker.id))),
  );
  const attendanceIds = new Set(attendance.map((worker) => String(worker.id)));
  const allocatedOnSite = [...allocated].filter((id) => attendanceIds.has(id)).length;
  const allocationCoverage = attendance.length
    ? Math.round((allocatedOnSite / attendance.length) * 100)
    : 0;
  let headerOffset = orderWidth + QTY_W;
  const headerLeft = () => {
    const left = headerOffset;
    headerOffset += DATE_W;
    return left;
  };

  /** Drag the Order column's right-hand edge. */
  const startColumnResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const from = e.clientX;
    const base = orderWidth;
    const move = (ev: PointerEvent) => setOrderWidth(base + ev.clientX - from);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.classList.remove('col-resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    document.body.classList.add('col-resizing');
  };

  // Hours booked per day against the hours the shift can deliver — the same
  // arithmetic as the per-person and per-line loads, so the three agree. The
  // columns behind today instead carry what was booked as output.
  const dayLoads = boardDayLoads(
    allRows,
    board.workers,
    board.horizonStart,
    board.horizonDays,
    board.today,
  );

  // Where the shift has got to, as a fraction of today's column.
  const todayIndex = dayLoads.findIndex((load) => load.isToday);
  const nowOffset =
    todayIndex < 0
      ? null
      : (todayIndex + shiftFraction(now, SHIFT_START_HOUR, SHIFT_END_HOUR)) *
        dayWidth;

  const dateHead = (key: DateCol, label: string) =>
    visibleDates[key] && (
      <div className="acell date date-head frozen" style={{ left: headerLeft() }}>
        <span>{label}</span>
        <button onClick={() => toggleDate(key)} title={`Hide ${label}`}>−</button>
      </div>
    );

  return (
    <div
      className="assy"
      style={
        {
          minWidth: labelWidth + gridWidth,
          '--order-w': `${orderWidth}px`,
        } as React.CSSProperties
      }
    >
      {/*
        Day backgrounds for the whole board, drawn once behind the rows rather
        than per row: today picked out, days already gone faded, Saturday and
        Sunday greyed because the factory is closed. Rows and bars paint on top.
      */}
      <div className="day-stripes" style={{ left: labelWidth, width: gridWidth }}>
        {dayLoads.map((load, i) => (
          <div
            key={load.key}
            className={`stripe ${load.working ? '' : 'closed'} ${load.isToday ? 'today' : ''} ${load.past ? 'past' : ''}`}
            style={{ left: i * dayWidth, width: dayWidth }}
          />
        ))}
      </div>

      {/* Where the shift has got to. Its own layer, above the bars: the point
          is to see which of them today should have reached by now. */}
      {nowOffset !== null && (
        <div
          className="now-line"
          style={{ left: labelWidth + nowOffset }}
          title={
            `Now — ${TIME_FMT.format(now)} · the shift runs ` +
            `${hourLabel(SHIFT_START_HOUR)}–${hourLabel(SHIFT_END_HOUR)}`
          }
        />
      )}

      <div className="assy-sticky">
        {/* Five squares per name, one per working day; click for the detail —
            see WorkerLoadChip. Frozen with the header, because who has room is
            the question being asked all the way down the board. */}
        <div className="attendance-row">
          <strong>Today on site</strong>
          <span className="attendance-count">{attendance.length} / {board.workers.length}</span>
          <span className="attendance-count">{allocatedOnSite} allocated · {allocationCoverage}% coverage</span>
          {attendance.length === 0 ? (
            <span>Attendance awaiting API</span>
          ) : (
            <span className="attendance-names">
              {attendance.map((worker) => {
                const load = rosterLoads.get(String(worker.id));
                return load ? (
                  <WorkerLoadChip
                    key={String(worker.id)}
                    worker={worker}
                    load={load}
                  />
                ) : null;
              })}
            </span>
          )}
        </div>

        <div className="assy-head">
          <div className="acell order">
            Order
            {/* Grab the edge to give the description more room. */}
            <span
              className="col-resize"
              role="separator"
              tabIndex={0}
              aria-label="Resize the Order column"
              aria-valuenow={orderWidth}
              aria-valuemin={MIN_ORDER_WIDTH}
              aria-valuemax={MAX_ORDER_WIDTH}
              title="Drag to resize"
              onPointerDown={startColumnResize}
              onKeyDown={(e) => {
                const step =
                  e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
                if (!step) return;
                e.preventDefault();
                setOrderWidth(orderWidth + step);
              }}
            />
          </div>
          <div className="acell qty frozen" style={{ left: orderWidth }}>Order Qty</div>
          {dateHead('start', 'Start Date')}
          {dateHead('due', 'Due Date')}
          {dateHead('expect', 'Expect Date')}
          {dateHead('ship', 'Ship Date')}
          <div className="acell team frozen" style={{ left: headerOffset }}>Team</div>
          {/* Load histogram: one column per day, coloured by band. */}
          <div className="acell track" style={{ width: gridWidth }}>
            {days.map((d, i) => {
              const load = dayLoads[i];
              const pct = Math.round(load.pct);
              // A closed day still shows what landed on it — that is the case
              // for overtime — but muted, so it never reads as normal capacity.
              const band = load.working ? load.band : 'closed';
              return (
                <div
                  key={i}
                  className={`daycol ${load.working ? '' : 'weekend'} ${load.isToday ? 'today' : ''} ${load.past ? 'past' : ''}`}
                  style={{ left: i * dayWidth, width: dayWidth }}
                  title={
                    (load.actual
                      ? `Booked as output: ${load.hours.toFixed(1)} h of ${load.capacity.toFixed(1)} h `
                      : `${load.hours.toFixed(1)} h booked of ${load.capacity.toFixed(1)} h `) +
                    `(${load.available} people) — ${pct}%` +
                    (load.working ? '' : ' · factory closed, needs overtime')
                  }
                >
                  <span className="daycol-date">
                    {DAY_FMT.format(d)}
                    {load.isToday && <b className="today-tag">today</b>}
                    {load.past && <b className="past-tag">done</b>}
                  </span>
                  <span className={`day-bar ${band} ${load.actual ? 'actual' : ''}`}>
                    <i style={{ height: `${Math.min(100, pct)}%` }} />
                  </span>
                  <span className={`day-load ${band}`}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {board.groups.map((group) => (
        <LineGroupView
          key={group.line.key}
          group={group}
          board={board}
          gridWidth={gridWidth}
          selectedJobId={selectedJobId}
          onSelect={select}
          dayWidth={dayWidth}
          orderWidth={orderWidth}
          visibleDates={visibleDates}
          collapsed={Boolean(collapsed[group.line.key])}
          onToggle={() => setCollapsed((current) => ({ ...current, [group.line.key]: !current[group.line.key] }))}
        />
      ))}
    </div>
  );
}
