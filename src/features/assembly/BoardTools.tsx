/**
 * Timeline controls, in the middle of the title bar.
 *
 * They sit in the header rather than on the board because they change how the
 * board is *looked at*, not what it says: the zoom, the hidden date columns.
 * The one figure that travels with them is the work the board is carrying,
 * which is the number a supervisor quotes when asked how the week looks.
 */

import type { AssemblyGanttView } from '@/engine/assembly/board';
import { DATE_COLS, DATE_COL_LABEL, useUiStore } from '@/store/uiStore';
import { crewDayKey } from '@/engine/assembly/crewSchedule';
import { countRunningOrders } from './boardView';

/** How much one press of − or + moves the day column, in pixels. */
const ZOOM_STEP = 16;

export function BoardTools({ board }: { board: AssemblyGanttView | null }) {
  const dayWidth = useUiStore((s) => s.dayWidth);
  const setDayWidth = useUiStore((s) => s.setDayWidth);
  const dateCols = useUiStore((s) => s.dateCols);
  const toggleDateCol = useUiStore((s) => s.toggleDateCol);
  const orderWindow = useUiStore((s) => s.orderWindow);
  const setOrderWindow = useUiStore((s) => s.setOrderWindow);
  const orderDay = useUiStore((s) => s.orderDay);
  const setOrderDay = useUiStore((s) => s.setOrderDay);
  const showWeekends = useUiStore((s) => s.showWeekends);
  const toggleWeekends = useUiStore((s) => s.toggleWeekends);

  if (!board) return null;
  const hidden = DATE_COLS.filter((key) => !dateCols[key]);

  return (
    <div className="board-tools">
      <strong>Timeline</strong>
      <button
        onClick={() => setDayWidth(dayWidth - ZOOM_STEP)}
        aria-label="Zoom out"
        title="Narrower days — see further ahead"
      >
        −
      </button>
      <button
        onClick={() => setDayWidth(dayWidth + ZOOM_STEP)}
        aria-label="Zoom in"
        title="Wider days"
      >
        +
      </button>
      <span
        className="board-load"
        title="Standard hours still to run across every scheduled order"
      >
        {board.totals.remainingHours.toFixed(0)} h on the board
      </span>
      <span className="order-window" aria-label="Order date window">
        <button
          className={orderWindow === 'all' ? 'active' : ''}
          onClick={() => setOrderWindow('all')}
        >
          All orders
        </button>
        <button
          className={orderWindow === 'next-five' ? 'active' : ''}
          onClick={() => setOrderWindow('next-five')}
          title="Orders running today or during the next five working days"
        >
          5 working days
        </button>
      </span>
      <label className="order-day-filter">
        Filter date
        <input
          type="date"
          aria-label="Filter orders running on date"
          value={orderWindow === 'day' ? orderDay ?? '' : ''}
          onChange={(event) => setOrderDay(event.target.value || null)}
        />
      </label>
      <button className="date-restore" onClick={() => setOrderDay(crewDayKey(board.today))}>
        Today
      </button>
      {orderWindow === 'day' && orderDay && (
        <span className="board-load" role="status">
          {countRunningOrders(board.groups.flatMap((group) => group.rows), new Date(`${orderDay}T00:00:00`))} orders running
        </span>
      )}
      <button
        className="date-restore"
        onClick={toggleWeekends}
        title={
          showWeekends
            ? 'Hide Saturday and Sunday'
            : 'Show Saturday and Sunday'
        }
      >
        {showWeekends ? '− Weekends' : '+ Weekends'}
      </button>
      {/* Only the columns someone has hidden, so the row stays quiet. */}
      {hidden.map((key) => (
        <button
          className="date-restore"
          key={key}
          onClick={() => toggleDateCol(key)}
          title={`Show the ${DATE_COL_LABEL[key]} column again`}
        >
          + {DATE_COL_LABEL[key]}
        </button>
      ))}
      <MarkedSet />
      <MaterialLinks board={board} />
      {board.dependencyWarnings.length > 0 && (
        <span className="board-warn" title={board.dependencyWarnings.join('\n')}>
          {board.dependencyWarnings.length} material link
          {board.dependencyWarnings.length === 1 ? '' : 's'} not used
        </span>
      )}
    </div>
  );
}

/**
 * The orders ticked to move together, and the way out of it.
 *
 * Marking is otherwise invisible from the header — the bars carry an outline,
 * but they may all be scrolled off — and a set left ticked by accident would
 * make the next drag move things the planner had forgotten about.
 */
function MarkedSet() {
  const marked = useUiStore((s) => s.marked);
  const clearMarks = useUiStore((s) => s.clearMarks);
  if (marked.length === 0) return null;
  return (
    <button
      className="marked-set"
      onClick={clearMarks}
      title={
        `Moving together — drag any one of them:\n${marked.join('\n')}` +
        '\n\nClick here, or press Esc, to let go.'
      }
    >
      {marked.length} marked ×
    </button>
  );
}

/**
 * What `JobMaterialReq.csv` actually did to the board.
 *
 * The file's whole job is to say which order has to finish before which, and
 * that is invisible until something waits — so this counts the orders that
 * ended up with a predecessor and spells every one of them out on hover.
 * Loading the file and seeing nothing change is otherwise indistinguishable
 * from loading the wrong file.
 */
function MaterialLinks({ board }: { board: AssemblyGanttView }) {
  const rows = [...board.rowsByJob.values()].filter(
    (row) => row.predecessors.length > 0,
  );
  if (rows.length === 0) {
    return (
      <span
        className="board-load"
        title={
          'No order on this board waits for another. Load JobMaterialReq.csv ' +
          'to bring the material links in — without them every order is free ' +
          'to start on its own date.'
        }
      >
        No order links
      </span>
    );
  }

  // "ASM8020 (Upholstery) waits on ASM8019 · SFA3S-STRM-SS" — the whole graph
  // in running order. An arrow only exists where both bars are on screen, so
  // the count includes links the board cannot currently draw, and this is
  // where you find out which ones those are.
  const links = [...board.groups.flatMap((group) => group.rows)]
    .filter((row) => row.predecessors.length > 0)
    .sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime())
    .flatMap((row) =>
      row.predecessors.map(
        (dep) =>
          `${String(row.job.id)} (${row.line.name}) waits on ` +
          `${String(dep.onJobId)}${dep.part ? ` · ${String(dep.part)}` : ''}`,
      ),
    )
    .join('\n');

  return (
    <span
      className="board-load"
      title={`Drawn as arrows wherever both orders are on screen:\n${links}`}
    >
      {rows.length} order{rows.length === 1 ? '' : 's'} wait on another
    </span>
  );
}
