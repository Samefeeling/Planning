/**
 * The assembly main board.
 *
 * Left: one row per order with its dates and crew. Right: the day grid with
 * the draggable bar. Row groups are the lines — PMD first, shown for context
 * only, then the three schedulable assembly lines.
 */

import type { AssemblyGanttView, OrderRow } from '@/engine/assembly/board';
import { ORDER_TYPE_SHORT } from '@/domain/assembly';
import { addDays } from '@/engine/assembly/dates';
import { useUiStore } from '@/store/uiStore';
import { OrderBar } from './OrderBar';
import { TeamChips } from './TeamChips';

const DAY_WIDTH = 92;
const LABEL_WIDTH = 460; // keep in sync with the CSS grid template

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'numeric',
});
const SHORT_FMT = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: '2-digit',
});

const fmt = (d: Date | null): string => (d ? SHORT_FMT.format(d) : '—');

function Summary({ board }: { board: AssemblyGanttView }) {
  const { totals } = board;
  return (
    <div className="assy-summary">
      <span className="pill green">{totals.green} on ship date</span>
      <span className="pill orange">{totals.orange} past ship</span>
      <span className="pill red">{totals.red} past due</span>
      <span className="pill grey">{board.pool.length} unassigned</span>
    </div>
  );
}

function OrderRowView({
  row,
  board,
  selected,
  onSelect,
}: {
  row: OrderRow;
  board: AssemblyGanttView;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const isContext = !row.line.schedulable;
  return (
    <div
      className={`arow ${selected ? 'selected' : ''} ${isContext ? 'context' : ''}`}
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
      <div className="acell date">{fmt(row.job.dueDate)}</div>
      <div className={`acell date expect ${row.status.color}`}>
        {fmt(row.expectDate)}
      </div>
      <div className="acell date">{fmt(row.job.shipDate)}</div>
      <div className="acell team">
        {isContext ? (
          <span className="chip empty">moulding</span>
        ) : (
          <TeamChips row={row} roster={board.workers} />
        )}
      </div>
      <div className="acell track">
        <OrderBar
          row={row}
          horizonStart={board.horizonStart}
          dayWidth={DAY_WIDTH}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

export function AssemblyGantt({ board }: { board: AssemblyGanttView }) {
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);

  const days = Array.from({ length: board.horizonDays }, (_, i) =>
    addDays(board.horizonStart, i),
  );
  const gridWidth = board.horizonDays * DAY_WIDTH;

  return (
    <div className="assy" style={{ minWidth: LABEL_WIDTH + gridWidth }}>
      <Summary board={board} />

      <div className="assy-head">
        <div className="acell order">Order</div>
        <div className="acell date vert">Due Date</div>
        <div className="acell date vert">Expect Date</div>
        <div className="acell date vert">Ship Date</div>
        <div className="acell team">Team</div>
        <div className="acell track" style={{ width: gridWidth }}>
          {days.map((d, i) => (
            <div
              key={i}
              className={`daycol ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}`}
              style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
            >
              {DAY_FMT.format(d)}
            </div>
          ))}
        </div>
      </div>

      {board.groups.map((group) => (
        <section key={group.line.key} className="agroup">
          <div className="agroup-label">
            <span className="agroup-name">{group.line.name}</span>
            {!group.line.schedulable && (
              <span className="agroup-note">plan only</span>
            )}
            <span className="agroup-count">{group.rows.length}</span>
          </div>

          {group.rows.length === 0 ? (
            <div className="arow empty">
              <div className="acell order">No orders on this line</div>
            </div>
          ) : (
            group.rows.map((row) => (
              <OrderRowView
                key={String(row.job.id)}
                row={row}
                board={board}
                selected={selectedJobId === String(row.job.id)}
                onSelect={select}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

export { DAY_WIDTH };
