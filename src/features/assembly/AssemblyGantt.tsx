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
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssemblyGanttView,
  LineGroup,
  OrderRow,
} from '@/engine/assembly/board';
import {
  ORDER_TYPE_SHORT,
  SHIFT_END_HOUR,
  SHIFT_START_HOUR,
  WORK_KIND_SHORT,
  type LineKey,
} from '@/domain/assembly';
import { addDays, isWeekend, shiftFraction } from '@/engine/assembly/dates';
import { remainingHours } from '@/engine/assembly/duration';
import {
  boardDayLoads,
  lineLoad,
  rosterLoad,
  type WorkerLoad,
} from '@/engine/assembly/workload';
import { usePlanStore } from '@/store/planStore';
import { useSupervisorStore } from '@/store/supervisorStore';
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
import { DependencyArrows } from './DependencyArrows';
import {
  activeWorkerIdsOnDay,
  isInNextWorkingDays,
  lineOfWorkerToday,
  sortLineRows,
  type OrderSort,
  type OrderSortKey,
} from './boardView';

// Must match the widths in index.css (--qty-w, --date-w x4, --team-w),
// otherwise the header's day columns drift out of line with the row tracks.
// The Order column is the exception: it is dragged, so it comes from the store
// and is pushed back into CSS as --order-w.
const QTY_W = 58;
const HOURS_W = 82;
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
  allRows,
  gridWidth,
  selected,
  onSelect,
  dayWidth,
  orderWidth,
  visibleDates,
  showWeekends,
  workerLines,
}: {
  row: OrderRow;
  board: AssemblyGanttView;
  /** Every row on the board, for the crew picker's double-booking check. */
  allRows: OrderRow[];
  gridWidth: number;
  selected: boolean;
  onSelect: (id: string, at?: ClickPoint) => void;
  dayWidth: number;
  orderWidth: number;
  visibleDates: DateCols;
  showWeekends: boolean;
  workerLines: ReadonlyMap<string, LineKey>;
}) {
  const isContext = !row.line.schedulable;
  let dateOffset = orderWidth + QTY_W + HOURS_W;
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
    >
      <div className="acell order">
        <span className="order-id">{String(row.job.id)}</span>
        {/* On UPL the badge names the bench: Epicor calls both the softies and
            the upholstering "upholstery", and which of the three steps this is
            is the thing worth reading. */}
        {(row.kind !== 'general' || row.job.orderType) && (
          <span className={`order-type ${row.kind}`}>
            {row.kind === 'general'
              ? ORDER_TYPE_SHORT[row.job.orderType!]
              : WORK_KIND_SHORT[row.kind]}
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
      <div
        className="acell hours frozen"
        style={{ left: orderWidth + QTY_W }}
        title="Remaining standard labour hours used by the schedule"
      >
        {remainingHours(row.job).toFixed(1)} h
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
          <TeamChips
            row={row}
            roster={board.workers}
            rows={allRows}
            workerLines={workerLines}
            disabled={row.completedToday || Boolean(row.actualStart)}
          />
        )}
      </div>
      <div className="acell track" style={{ width: gridWidth }}>
        <OrderBar
          row={row}
          horizonStart={board.horizonStart}
          dayWidth={dayWidth}
          gridWidth={gridWidth}
          showWeekends={showWeekends}
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
 *
 * The summary row carries the line's own people — whoever is standing here
 * today, in the order the board reaches for them, each with their week of
 * load. One roster across the top of the board could not say which of those
 * names mattered to the line you were reading; here it is the same row.
 *
 * Each operator appears once, on the line the supervisor currently owns in
 * the draggable roster. See `lineOfWorkerToday`.
 */
function LineGroupView({
  group,
  board,
  allRows,
  gridWidth,
  rosterLoads,
  todayLine,
  selectedJobId,
  onSelect,
  dayWidth,
  orderWidth,
  visibleDates,
  showWeekends,
  collapsed,
  onToggle,
  filtered,
  unlocked,
}: {
  group: LineGroup;
  board: AssemblyGanttView;
  allRows: OrderRow[];
  gridWidth: number;
  /** Every person's week, worked out once for the whole board. */
  rosterLoads: Map<string, WorkerLoad>;
  /** Which line each person is standing at today — one each. */
  todayLine: Map<string, LineKey>;
  selectedJobId: string | null;
  onSelect: (id: string, at?: ClickPoint) => void;
  dayWidth: number;
  orderWidth: number;
  visibleDates: DateCols;
  showWeekends: boolean;
  collapsed: boolean;
  onToggle: () => void;
  filtered: boolean;
  unlocked: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: String(group.line.id),
    data: {
      type: 'line',
      lineId: String(group.line.id),
      lineKey: group.line.key,
    },
    disabled: !group.line.schedulable,
  });
  const load = group.load;
  const crew = useMemo(
    () =>
      board.workers
        .filter(
          (worker) =>
            worker.onShift &&
            todayLine.get(String(worker.id)) === group.line.key,
        ),
    [board.workers, group.line.key, todayLine],
  );

  return (
    <section
      ref={setNodeRef}
      className={`agroup ${isOver ? 'drop-active' : ''}`}
    >
      {/* A row, not one big button: the load chips inside it open their own
          popup, and a button cannot hold another button. The inner block is
          what sticks to the left edge, so the line's totals and its people
          stay readable however far right the grid is scrolled — the row
          itself has to span the whole grid to carry the background. */}
      <div className="agroup-head">
       <div className="agroup-head-in">
        <button
          type="button"
          className="agroup-label"
          onClick={onToggle}
          aria-expanded={!collapsed}
        >
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

        {crew.length > 0 && (
          <span
            className="agroup-roster"
            title={`Operators currently assigned to ${group.line.name}`}
          >
            {crew.map((worker) => {
              const week = rosterLoads.get(String(worker.id));
              return week ? (
                <WorkerLoadChip
                  key={String(worker.id)}
                  worker={worker}
                  load={week}
                  line={group.line.key}
                  dragDisabled={
                    !unlocked ||
                    allRows.some(
                      (row) =>
                        Boolean(row.actualStart) &&
                        row.workers.some(
                          (assigned) =>
                            String(assigned.id) === String(worker.id),
                        ),
                    )
                  }
                />
              ) : null;
            })}
          </span>
        )}
       </div>
      </div>

      {!collapsed && (group.rows.length === 0 ? (
        <div className="arow empty">
          <div className="acell order">
            {group.line.schedulable
              ? filtered
                ? 'No orders from yesterday through the next five working days'
                : 'Drop an order here'
              : 'No orders on this line'}
          </div>
        </div>
      ) : (
        group.rows.map((row) => (
          <OrderRowView
            key={String(row.job.id)}
            row={row}
            board={board}
            allRows={allRows}
            gridWidth={gridWidth}
            selected={selectedJobId === String(row.job.id)}
            onSelect={onSelect}
            dayWidth={dayWidth}
            orderWidth={orderWidth}
            visibleDates={visibleDates}
            showWeekends={showWeekends}
            workerLines={todayLine}
          />
        ))
      ))}
    </section>
  );
}

export function AssemblyGantt({ board }: { board: AssemblyGanttView }) {
  const root = useRef<HTMLDivElement>(null);
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);
  const dayWidth = useUiStore((s) => s.dayWidth);
  const orderWidth = useUiStore((s) => s.orderWidth);
  const setOrderWidth = useUiStore((s) => s.setOrderWidth);
  const visibleDates = useUiStore((s) => s.dateCols);
  const toggleDate = useUiStore((s) => s.toggleDateCol);
  const orderWindow = useUiStore((s) => s.orderWindow);
  const showWeekends = useUiStore((s) => s.showWeekends);
  const workerLineOverrides = usePlanStore((s) => s.workerLines);
  const unlocked = useSupervisorStore((s) => s.unlocked);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    PMD: true,
  });
  const [sort, setSort] = useState<OrderSort | null>(null);

  // The clock behind the "now" line. Five minutes is as fine as the line is
  // worth reading, and it keeps the board from re-rendering every second.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const calendarDays = Array.from({ length: board.horizonDays }, (_, i) =>
    addDays(board.horizonStart, i),
  );
  const days = showWeekends
    ? calendarDays
    : calendarDays.filter((day) => !isWeekend(day));
  const gridWidth = days.length * dayWidth;
  const dateCount = Object.values(visibleDates).filter(Boolean).length;
  const labelWidth =
    orderWidth + QTY_W + HOURS_W + DATE_W * dateCount + TEAM_W;
  const attendance = board.workers.filter((worker) => worker.onShift);
  const allRows = useMemo(
    () => board.groups.flatMap((group) => group.rows),
    [board],
  );
  const visibleGroups = useMemo(
    () =>
      board.groups.map((group) => {
        const filteredRows =
          orderWindow === 'next-five'
            ? group.rows.filter((row) =>
                isInNextWorkingDays(row, board.today),
              )
            : group.rows;
        return {
          ...group,
          rows: sortLineRows(filteredRows, sort),
          load: lineLoad(filteredRows),
        };
      }),
    [board.groups, board.today, orderWindow, sort],
  );
  const visibleRows = useMemo(
    () => visibleGroups.flatMap((group) => group.rows),
    [visibleGroups],
  );
  // Every name in the header carries five load squares, so the whole roster's
  // week is worked out once here rather than once per chip on every render.
  // From today: the week to come is what a supervisor allocates against.
  const rosterLoads = useMemo(
    () => rosterLoad(board.workers, allRows, board.today),
    [board, allRows],
  );
  const allocated = activeWorkerIdsOnDay(allRows, board.today);
  // One row per person: an explicit drag wins; source data supplies only the
  // initial line for plans that have never placed that person.
  const todayLine = useMemo(
    () =>
      lineOfWorkerToday(
        board.workers,
        allRows,
        board.today,
        workerLineOverrides,
      ),
    [board.workers, allRows, board.today, workerLineOverrides],
  );
  const attendanceIds = new Set(attendance.map((worker) => String(worker.id)));
  const allocatedOnSite = [...allocated].filter((id) => attendanceIds.has(id)).length;
  const unallocated = attendance.filter(
    (worker) => !allocated.has(String(worker.id)),
  );
  const allocationCoverage = attendance.length
    ? Math.round((allocatedOnSite / attendance.length) * 100)
    : 0;
  let headerOffset = orderWidth + QTY_W + HOURS_W;
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
  const calendarDayLoads = boardDayLoads(
    visibleRows,
    board.workers,
    board.horizonStart,
    board.horizonDays,
    board.today,
  );
  const dayLoads = showWeekends
    ? calendarDayLoads
    : calendarDayLoads.filter((load) => load.working);

  // Where the shift has got to, as a fraction of today's column.
  const todayIndex = dayLoads.findIndex((load) => load.isToday);
  const nowOffset =
    todayIndex < 0
      ? null
      : (todayIndex + shiftFraction(now, SHIFT_START_HOUR, SHIFT_END_HOUR)) *
        dayWidth;

  const changeSort = (key: OrderSortKey) =>
    setSort((current) => ({
      key,
      direction:
        current?.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));

  const dateHead = (
    key: DateCol,
    label: string,
    sortable: boolean,
  ) =>
    visibleDates[key] && (
      <div className="acell date date-head frozen" style={{ left: headerLeft() }}>
        {sortable ? (
          <button
            className={`date-sort ${sort?.key === key ? 'active' : ''}`}
            onClick={() => changeSort(key as OrderSortKey)}
            title={`Sort each line by ${label}`}
          >
            {label}
            <span aria-hidden="true">
              {sort?.key === key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
            </span>
          </button>
        ) : (
          <span>{label}</span>
        )}
        <button
          className="date-hide"
          onClick={() => toggleDate(key)}
          title={`Hide ${label}`}
        >
          −
        </button>
      </div>
    );

  return (
    <div
      ref={root}
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
        than per row: today is picked out and days already gone are faded.
        Saturday and Sunday are greyed when their optional columns are visible.
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

      <DependencyArrows root={root} rows={visibleRows} />

      <div className="assy-sticky">
        {/* Who is in, and how much of them is spoken for. The names themselves
            sit on the line they work — see LineGroupView — because one roster
            across the top could not say which of them mattered to the line
            being read. */}
        <div className="attendance-row">
          <div className="attendance-in">
            <strong>Today on site</strong>
            <span className="attendance-count">{attendance.length} / {board.workers.length}</span>
            <span className="attendance-count">{allocatedOnSite} allocated · {allocationCoverage}% coverage</span>
            {attendance.length === 0 && <span>Attendance awaiting API</span>}
          </div>
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
          <div
            className="acell hours frozen"
            style={{ left: orderWidth + QTY_W }}
          >
            Required Hours
          </div>
          {dateHead('start', 'Start Date', true)}
          {dateHead('due', 'Due Date', true)}
          {dateHead('expect', 'Expect Date', false)}
          {dateHead('ship', 'Ship Date', true)}
          <div
            className="acell team team-head frozen"
            style={{ left: headerOffset }}
          >
            <span>Team</span>
            {/* Everyone in today with no work on them — the people a
                supervisor can still reach for. Named in full and wrapped
                rather than cut off at the column's edge: a list ending in
                "Pet…" is the one name you needed. */}
            {unallocated.length > 0 ? (
              <span
                className="team-free"
                title={`Nothing allocated today: ${unallocated
                  .map((worker) => worker.name)
                  .join(', ')}`}
              >
                <b className="team-free-count">Free {unallocated.length}</b>
                {unallocated.map((worker) => (
                  <span key={String(worker.id)} className="team-free-name">
                    {worker.name}
                  </span>
                ))}
              </span>
            ) : (
              <span
                className="team-free none"
                title="Everyone on site is allocated today"
              >
                All allocated
              </span>
            )}
          </div>
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

      {visibleGroups.map((group) => (
        <LineGroupView
          key={group.line.key}
          group={group}
          board={board}
          allRows={allRows}
          gridWidth={gridWidth}
          rosterLoads={rosterLoads}
          todayLine={todayLine}
          selectedJobId={selectedJobId}
          onSelect={select}
          dayWidth={dayWidth}
          orderWidth={orderWidth}
          visibleDates={visibleDates}
          showWeekends={showWeekends}
          collapsed={Boolean(collapsed[group.line.key])}
          onToggle={() => setCollapsed((current) => ({ ...current, [group.line.key]: !current[group.line.key] }))}
          filtered={orderWindow === 'next-five'}
          unlocked={unlocked}
        />
      ))}
    </div>
  );
}
