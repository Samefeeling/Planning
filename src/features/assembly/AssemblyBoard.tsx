/**
 * The assembly planning board: four area columns plus a day summary.
 *
 * Laid out as columns (not a time axis) because the department runs one shift
 * and the supervisor dispatches on the day — and because this is the same
 * layout the MES Live Status page will use, so stage 2 adds live progress to
 * these cards rather than replacing the screen.
 */

import type { AssemblyBoardView } from '@/engine/assembly/board';
import { useUiStore } from '@/store/uiStore';
import { AreaColumn } from './AreaColumn';

function DaySummary({ board }: { board: AssemblyBoardView }) {
  const { totals } = board;
  const level =
    totals.loadPct > 100 ? 'over' : totals.loadPct < 60 ? 'under' : 'ok';
  return (
    <div className="day-summary">
      <div className="stat">
        <span className="stat-n">{totals.orders}</span>
        <span className="stat-l">scheduled</span>
      </div>
      <div className="stat">
        <span className="stat-n ok">{totals.ready}</span>
        <span className="stat-l">ready to start</span>
      </div>
      <div className="stat">
        <span className="stat-n error">{totals.blocked}</span>
        <span className="stat-l">blocked</span>
      </div>
      <div className="stat">
        <span className="stat-n">{board.pool.length}</span>
        <span className="stat-l">unassigned</span>
      </div>
      <div className="stat wide">
        <span className={`stat-n ${level}`}>
          {Math.round(totals.loadPct)}%
        </span>
        <span className="stat-l">
          day load · {totals.plannedHours.toFixed(0)} h planned /{' '}
          {totals.availableHours.toFixed(0)} h crew
        </span>
      </div>
    </div>
  );
}

export function AssemblyBoard({ board }: { board: AssemblyBoardView }) {
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);

  return (
    <div className="assembly">
      <DaySummary board={board} />
      <div className="area-grid">
        {board.columns.map((col) => (
          <AreaColumn
            key={String(col.area.id)}
            column={col}
            selectedJobId={selectedJobId}
            onSelect={select}
          />
        ))}
      </div>
    </div>
  );
}
