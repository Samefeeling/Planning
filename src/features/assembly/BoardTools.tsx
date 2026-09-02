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

/** How much one press of − or + moves the day column, in pixels. */
const ZOOM_STEP = 16;

export function BoardTools({ board }: { board: AssemblyGanttView | null }) {
  const dayWidth = useUiStore((s) => s.dayWidth);
  const setDayWidth = useUiStore((s) => s.setDayWidth);
  const dateCols = useUiStore((s) => s.dateCols);
  const toggleDateCol = useUiStore((s) => s.toggleDateCol);
  const orderWindow = useUiStore((s) => s.orderWindow);
  const setOrderWindow = useUiStore((s) => s.setOrderWindow);
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
          title="Orders touching yesterday or the next five working days"
        >
          5 days + yesterday
        </button>
      </span>
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
      {board.dependencyWarnings.length > 0 && (
        <span className="board-warn" title={board.dependencyWarnings.join('\n')}>
          {board.dependencyWarnings.length} material link
          {board.dependencyWarnings.length === 1 ? '' : 's'} not used
        </span>
      )}
    </div>
  );
}
