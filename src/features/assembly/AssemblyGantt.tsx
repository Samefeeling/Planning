/**
 * The assembly main board.
 *
 * Left: one row per order with its dates and crew. Right: the day grid with
 * the draggable bar. Row groups are the lines — PMD first, shown for context
 * only, then the three schedulable assembly lines.
 */

import { useDroppable } from '@dnd-kit/core';
import { useState } from 'react';
import type {
  AssemblyGanttView,
  LineGroup,
  OrderRow,
} from '@/engine/assembly/board';
import { ORDER_TYPE_SHORT } from '@/domain/assembly';
import { addDays } from '@/engine/assembly/dates';
import { useUiStore } from '@/store/uiStore';
import { OrderBar } from './OrderBar';
import { TeamChips } from './TeamChips';

const DEFAULT_DAY_WIDTH = 92;
// Must match the widths in index.css (--order-w, --date-w x3, --team-w),
// otherwise the header's day columns drift out of line with the row tracks.
const ORDER_W = 200;
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

const fmt = (d: Date | null): string => (d ? SHORT_FMT.format(d) : '—');
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

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
  visibleDates: Record<'due' | 'expect' | 'ship', boolean>;
}) {
  const isContext = !row.line.schedulable;
  let dateOffset = ORDER_W;
  const frozenDate = (visible: boolean): React.CSSProperties | undefined => {
    if (!visible) return undefined;
    const style = { left: dateOffset };
    dateOffset += DATE_W;
    return style;
  };
  const dueStyle = frozenDate(visibleDates.due);
  const expectStyle = frozenDate(visibleDates.expect);
  const shipStyle = frozenDate(visibleDates.ship);
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
  visibleDates: Record<'due' | 'expect' | 'ship', boolean>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: String(group.line.id),
    data: { type: 'line', lineId: String(group.line.id) },
    disabled: !group.line.schedulable,
  });

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
  const [visibleDates, setVisibleDates] = useState({ due: true, expect: true, ship: true });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const days = Array.from({ length: board.horizonDays }, (_, i) =>
    addDays(board.horizonStart, i),
  );
  const gridWidth = board.horizonDays * dayWidth;
  const dateCount = Object.values(visibleDates).filter(Boolean).length;
  const labelWidth = ORDER_W + DATE_W * dateCount + TEAM_W;
  const attendance = board.workers.filter((worker) => worker.onShift);
  const allocated = new Set(
    board.groups.flatMap((group) =>
      group.rows.flatMap((row) => row.workers.map((worker) => String(worker.id))),
    ),
  );
  const attendanceIds = new Set(attendance.map((worker) => String(worker.id)));
  const allocatedOnSite = [...allocated].filter((id) => attendanceIds.has(id)).length;
  const allocationCoverage = attendance.length
    ? Math.round((allocatedOnSite / attendance.length) * 100)
    : 0;
  const toggleDate = (key: keyof typeof visibleDates) =>
    setVisibleDates((current) => ({ ...current, [key]: !current[key] }));
  let headerOffset = ORDER_W;
  const headerLeft = () => {
    const left = headerOffset;
    headerOffset += DATE_W;
    return left;
  };

  const loadRate = (day: Date): { rate: number; available: number } => {
    const key = dayKey(day);
    const isToday = key === dayKey(board.horizonStart);
    const availableWorkers = board.workers.filter(
      (worker) =>
        (!isToday || worker.onShift) && !worker.plannedLeave?.includes(key),
    );
    const availableIds = new Set(
      availableWorkers.map((worker) => String(worker.id)),
    );
    const assigned = board.groups
      .flatMap((group) => group.rows)
      .filter(
        (row) =>
          row.line.schedulable &&
          !row.completedToday &&
          row.start &&
          row.expectDate &&
          row.start < addDays(day, 1) &&
          row.expectDate > day,
      )
      .reduce(
        (count, row) =>
          count +
          row.workers.filter((worker) => availableIds.has(String(worker.id)))
            .length,
        0,
      );
    return {
      rate: availableWorkers.length
        ? Math.round((assigned / availableWorkers.length) * 100)
        : 0,
      available: availableWorkers.length,
    };
  };

  return (
    <div className="assy" style={{ minWidth: labelWidth + gridWidth }}>
      <div className="board-tools">
        <strong>Timeline zoom</strong>
        <button onClick={() => setDayWidth((w) => Math.max(44, w - 16))} aria-label="Zoom out">−</button>
        <input aria-label="Timeline scale" type="range" min="44" max="160" step="4" value={dayWidth} onChange={(e) => setDayWidth(Number(e.target.value))} />
        <button onClick={() => setDayWidth((w) => Math.min(160, w + 16))} aria-label="Zoom in">+</button>
        <span>{dayWidth}px / day</span>
        {Object.entries(visibleDates).filter(([, visible]) => !visible).map(([key]) => (
          <button className="date-restore" key={key} onClick={() => toggleDate(key as keyof typeof visibleDates)}>+ {key}</button>
        ))}
      </div>

      <div className="attendance-row">
        <strong>Today on site</strong>
        <span className="attendance-count">{attendance.length} / {board.workers.length}</span>
        <span className="attendance-count">{allocatedOnSite} allocated · {allocationCoverage}% coverage</span>
        <span>{attendance.map((worker) => worker.name).join(' · ') || 'Attendance awaiting API'}</span>
      </div>

      <div className="assy-head">
        <div className="acell order">Order</div>
        {visibleDates.due && <div className="acell date date-head frozen" style={{ left: headerLeft() }}><span>Due Date</span><button onClick={() => toggleDate('due')} title="Hide Due Date">−</button></div>}
        {visibleDates.expect && <div className="acell date date-head frozen" style={{ left: headerLeft() }}><span>Expect Date</span><button onClick={() => toggleDate('expect')} title="Hide Expect Date">−</button></div>}
        {visibleDates.ship && <div className="acell date date-head frozen" style={{ left: headerLeft() }}><span>Ship Date</span><button onClick={() => toggleDate('ship')} title="Hide Ship Date">−</button></div>}
        <div className="acell team frozen" style={{ left: headerOffset }}>Team</div>
        <div className="acell track" style={{ width: gridWidth }}>
          {days.map((d, i) => (
            (() => {
              const load = loadRate(d);
              return (
            <div
              key={i}
              className={`daycol ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}`}
              style={{ left: i * dayWidth, width: dayWidth }}
            >
              <span>{DAY_FMT.format(d)}</span>
              <span className={`day-load ${load.rate > 100 ? 'over' : ''}`} title={`${load.available} people available after planned leave`}>
                Load {load.rate}%
              </span>
            </div>
              );
            })()
          ))}
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
