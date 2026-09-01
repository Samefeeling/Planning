/**
 * The assembly main board.
 *
 * Left: one row per order with its dates and crew. Right: the day grid with
 * the draggable bar. Row groups are the lines — PMD first, shown for context
 * only, then the three schedulable assembly lines.
 */

import { useDroppable } from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import type {
  AssemblyGanttView,
  LineGroup,
  OrderRow,
} from '@/engine/assembly/board';
import { ORDER_TYPE_SHORT } from '@/domain/assembly';
import { addDays } from '@/engine/assembly/dates';
import { boardDayLoads, rosterLoad } from '@/engine/assembly/workload';
import { useUiStore } from '@/store/uiStore';
import { OrderBar } from './OrderBar';
import { TeamChips } from './TeamChips';
import { WorkerLoadChip } from './WorkerLoadChip';

const DEFAULT_DAY_WIDTH = 92;
// Must match the widths in index.css (--order-w, --qty-w, --date-w x4,
// --team-w), otherwise the header's day columns drift out of line with the
// row tracks.
const ORDER_W = 200;
const QTY_W = 58;
const DATE_W = 62;
const TEAM_W = 172;

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

/**
 * The time of day Epicor scheduled the order to start (`JobHead_StartHour`).
 * Midnight means the export carried no hour, so there is nothing to show.
 */
const startTime = (d: Date | null): string | null =>
  d && (d.getHours() !== 0 || d.getMinutes() !== 0) ? TIME_FMT.format(d) : null;

/** Which of the four date columns are on, in the order they are drawn. */
type DateCols = Record<'start' | 'due' | 'expect' | 'ship', boolean>;
const DATE_ORDER = ['start', 'due', 'expect', 'ship'] as const;

function OrderRowView({
  row,
  board,
  gridWidth,
  selected,
  onSelect,
  dayWidth,
  visibleDates,
}: {
  row: OrderRow;
  board: AssemblyGanttView;
  gridWidth: number;
  selected: boolean;
  onSelect: (id: string) => void;
  dayWidth: number;
  visibleDates: DateCols;
}) {
  const isContext = !row.line.schedulable;
  let dateOffset = ORDER_W + QTY_W;
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
      onClick={() => onSelect(String(row.job.id))}
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
        style={{ left: ORDER_W }}
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
 * dragged here from the pool or from another line.
 */
function LineGroupView({
  group,
  board,
  gridWidth,
  selectedJobId,
  onSelect,
  dayWidth,
  visibleDates,
  collapsed,
  onToggle,
}: {
  group: LineGroup;
  board: AssemblyGanttView;
  gridWidth: number;
  selectedJobId: string | null;
  onSelect: (id: string) => void;
  dayWidth: number;
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
  const [dayWidth, setDayWidth] = useState(DEFAULT_DAY_WIDTH);
  const [visibleDates, setVisibleDates] = useState<DateCols>({
    start: true,
    due: true,
    expect: true,
    ship: true,
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const days = Array.from({ length: board.horizonDays }, (_, i) =>
    addDays(board.horizonStart, i),
  );
  const gridWidth = board.horizonDays * dayWidth;
  const dateCount = Object.values(visibleDates).filter(Boolean).length;
  const labelWidth = ORDER_W + QTY_W + DATE_W * dateCount + TEAM_W;
  const attendance = board.workers.filter((worker) => worker.onShift);
  const allRows = useMemo(
    () => board.groups.flatMap((group) => group.rows),
    [board],
  );
  // Every name in the header carries five load squares, so the whole roster's
  // week is worked out once here rather than once per chip on every render.
  const rosterLoads = useMemo(
    () => rosterLoad(board.workers, allRows, board.horizonStart),
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
  const toggleDate = (key: keyof DateCols) =>
    setVisibleDates((current) => ({ ...current, [key]: !current[key] }));
  let headerOffset = ORDER_W + QTY_W;
  const headerLeft = () => {
    const left = headerOffset;
    headerOffset += DATE_W;
    return left;
  };

  // Hours booked per day against the hours the shift can deliver — the same
  // arithmetic as the per-person and per-line loads, so the three agree.
  const dayLoads = boardDayLoads(
    allRows,
    board.workers,
    board.horizonStart,
    board.horizonDays,
  );

  return (
    <div className="assy" style={{ minWidth: labelWidth + gridWidth }}>
      {/*
        Day backgrounds for the whole board, drawn once behind the rows rather
        than per row: today picked out, Saturday and Sunday greyed because the
        factory is closed. Rows and bars paint on top.
      */}
      <div className="day-stripes" style={{ left: labelWidth, width: gridWidth }}>
        {dayLoads.map((load, i) => (
          <div
            key={load.key}
            className={`stripe ${load.working ? '' : 'closed'} ${load.isToday ? 'today' : ''}`}
            style={{ left: i * dayWidth, width: dayWidth }}
          />
        ))}
      </div>

      <div className="board-tools">
        <strong>Timeline zoom</strong>
        <button onClick={() => setDayWidth((w) => Math.max(44, w - 16))} aria-label="Zoom out">−</button>
        <input aria-label="Timeline scale" type="range" min="44" max="160" step="4" value={dayWidth} onChange={(e) => setDayWidth(Number(e.target.value))} />
        <button onClick={() => setDayWidth((w) => Math.min(160, w + 16))} aria-label="Zoom in">+</button>
        <span>{dayWidth}px / day</span>
        {DATE_ORDER.filter((key) => !visibleDates[key]).map((key) => (
          <button className="date-restore" key={key} onClick={() => toggleDate(key)}>+ {key}</button>
        ))}
        <span className="board-load" title="Standard hours still to run across every scheduled order">
          {board.totals.remainingHours.toFixed(0)} h on the board
        </span>
        {board.dependencyWarnings.length > 0 && (
          <span
            className="board-warn"
            title={board.dependencyWarnings.join('\n')}
          >
            {board.dependencyWarnings.length} material link
            {board.dependencyWarnings.length === 1 ? '' : 's'} not used
          </span>
        )}
      </div>

      {/* Five squares per name, one per working day; click for the detail —
          see WorkerLoadChip. */}
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
        <div className="acell order">Order</div>
        <div className="acell qty frozen" style={{ left: ORDER_W }}>Order Qty</div>
        {visibleDates.start && <div className="acell date date-head frozen" style={{ left: headerLeft() }}><span>Start Date</span><button onClick={() => toggleDate('start')} title="Hide Start Date">−</button></div>}
        {visibleDates.due && <div className="acell date date-head frozen" style={{ left: headerLeft() }}><span>Due Date</span><button onClick={() => toggleDate('due')} title="Hide Due Date">−</button></div>}
        {visibleDates.expect && <div className="acell date date-head frozen" style={{ left: headerLeft() }}><span>Expect Date</span><button onClick={() => toggleDate('expect')} title="Hide Expect Date">−</button></div>}
        {visibleDates.ship && <div className="acell date date-head frozen" style={{ left: headerLeft() }}><span>Ship Date</span><button onClick={() => toggleDate('ship')} title="Hide Ship Date">−</button></div>}
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
                className={`daycol ${load.working ? '' : 'weekend'} ${load.isToday ? 'today' : ''}`}
                style={{ left: i * dayWidth, width: dayWidth }}
                title={
                  `${load.hours.toFixed(1)} h booked of ${load.capacity.toFixed(1)} h ` +
                  `(${load.available} people) — ${pct}%` +
                  (load.working ? '' : ' · factory closed, needs overtime')
                }
              >
                <span className="daycol-date">
                  {DAY_FMT.format(d)}
                  {load.isToday && <b className="today-tag">today</b>}
                </span>
                <span className={`day-bar ${band}`}>
                  <i style={{ height: `${Math.min(100, pct)}%` }} />
                </span>
                <span className={`day-load ${band}`}>{pct}%</span>
              </div>
            );
          })}
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
          visibleDates={visibleDates}
          collapsed={Boolean(collapsed[group.line.key])}
          onToggle={() => setCollapsed((current) => ({ ...current, [group.line.key]: !current[group.line.key] }))}
        />
      ))}
    </div>
  );
}

export { DEFAULT_DAY_WIDTH as DAY_WIDTH };
