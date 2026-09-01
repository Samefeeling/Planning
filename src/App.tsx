/**
 * Application shell: loads data, bootstraps/persists the plan, wires the global
 * drag-and-drop context, and lays out the assembly board, order pool and
 * inspector.
 */

import { useEffect, useRef } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useDataStore } from '@/store/dataStore';
import { usePlanStore } from '@/store/planStore';
import { useAssemblyGantt } from '@/store/assemblySelectors';
import { createPlanRepository, CURRENT_PLAN_ID } from '@/persistence';
import { useDragDrop } from '@/features/assembly/useDragDrop';
import { AssemblyGantt } from '@/features/assembly/AssemblyGantt';
import { AssemblyPool } from '@/features/assembly/AssemblyPool';
import { AssemblyInspector } from '@/features/assembly/AssemblyInspector';
import { useScheduledRefresh } from '@/features/refresh/useScheduledRefresh';
import { RefreshControl } from '@/features/refresh/RefreshControl';
import { usePlanSync, type PlanSyncState } from '@/features/sync/usePlanSync';
import { CsvLoader } from '@/features/source/CsvLoader';
import { ORDER_TYPE_SHORT } from '@/domain/assembly';
import { Badge, Spinner } from '@/ui';
import type { AssemblyGanttView } from '@/engine/assembly/board';

const repo = createPlanRepository();

function ScheduleSummary({ board }: { board: AssemblyGanttView | null }) {
  if (!board) return null;
  return (
    <div className="legend" aria-label="Schedule summary">
      <Badge variant="ok">{board.totals.green} on ship date</Badge>
      <Badge variant="warn">{board.totals.orange} past ship</Badge>
      <Badge variant="error">{board.totals.red} past due</Badge>
      <Badge variant="neutral">{board.pool.length} unassigned</Badge>
    </div>
  );
}

/**
 * Whether the plan is reaching SharePoint. Silent when write-back is not
 * configured — an unconfigured board is the normal demo case, not a fault.
 */
function PlanSyncBadge({ sync }: { sync: PlanSyncState }) {
  if (!sync.enabled) return null;
  if (sync.busy) return <Badge variant="info">saving to {sync.list}…</Badge>;
  if (sync.errors.length > 0) return <Badge variant="error">{sync.list} failed</Badge>;
  if (!sync.lastSyncedAt) return null;

  const { created, updated } = sync.last ?? { created: 0, updated: 0 };
  return (
    <Badge variant="ok">
      {created + updated === 0
        ? `${sync.list} up to date`
        : `${sync.list} +${created} ~${updated}`}
    </Badge>
  );
}

export default function App() {
  const status = useDataStore((s) => s.status);
  const error = useDataStore((s) => s.error);
  const dataset = useDataStore((s) => s.dataset);
  const load = useDataStore((s) => s.load);
  const warnings = useDataStore((s) => s.warnings);
  const sourceName = useDataStore((s) => s.source.name);

  const containers = usePlanStore((s) => s.containers);
  const orderWorkers = usePlanStore((s) => s.orderWorkers);
  const orderStarts = usePlanStore((s) => s.orderStarts);
  const progress = usePlanStore((s) => s.progress);
  const production = usePlanStore((s) => s.production);

  const board = useAssemblyGantt();
  const dnd = useDragDrop();
  const refresh = useScheduledRefresh();
  // Crew and dragged starts go back to SharePoint; a refreshed CSV carries
  // DueDate and RemainingQty in the other direction.
  const sync = usePlanSync(board);

  const bootstrapped = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  // Initial data load.
  useEffect(() => {
    void load();
  }, [load]);

  // Bootstrap the plan from persistence on first ready; reconcile thereafter.
  useEffect(() => {
    if (status !== 'ready' || !dataset) return;
    const plan = usePlanStore.getState();
    if (bootstrapped.current) {
      plan.reconcile(dataset.workCenters, dataset.jobs);
      return;
    }
    bootstrapped.current = true;
    repo
      .load()
      .then((persisted) => {
        if (persisted?.containers) plan.setContainers(persisted.containers);
        if (persisted?.assembly) plan.setAssemblyPlan(persisted.assembly);
        plan.reconcile(dataset.workCenters, dataset.jobs);
      })
      .catch(() => plan.reconcile(dataset.workCenters, dataset.jobs));
  }, [status, dataset]);

  // Debounced autosave of the planner's layout.
  useEffect(() => {
    if (!bootstrapped.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void repo.save({
        id: CURRENT_PLAN_ID,
        name: 'Working plan',
        savedAt: new Date().toISOString(),
        containers,
        assembly: { orderWorkers, orderStarts, progress, production },
      });
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
  }, [containers, orderWorkers, orderStarts, progress, production]);

  const activeJob =
    dnd.activeJobId && board ? board.jobsById.get(dnd.activeJobId) : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Resero Planning</h1>
        <span className="sub">Assembly schedule</span>
        <Badge variant="info">{sourceName}</Badge>
        <div className="spacer" />
        <ScheduleSummary board={board} />
        <PlanSyncBadge sync={sync} />
        <CsvLoader />
        <RefreshControl onRefresh={() => void refresh()} />
      </header>

      {error && <div className="banner">Data error: {error}</div>}
      {sync.errors.length > 0 && (
        <div className="banner warn">
          {sync.list} not updated: {sync.errors[0]}
          {sync.errors.length > 1 && ` · +${sync.errors.length - 1} more`}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="banner warn">
          {/* Only the first few; the rest are usually the same problem. */}
          {warnings.slice(0, 3).join(' · ')}
          {warnings.length > 3 && ` · +${warnings.length - 3} more`}
        </div>
      )}

      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        onDragCancel={dnd.onDragCancel}
      >
        <div className="app-body">
          <div className="board-pane assembly-pane">
            {board ? (
              <AssemblyGantt board={board} />
            ) : (
              <div className="center-fill">
                <Spinner />
                <span>Loading assembly orders…</span>
              </div>
            )}
          </div>
          <aside className="side-pane">
            {board && (
              <>
                <AssemblyPool board={board} />
                <AssemblyInspector board={board} />
              </>
            )}
          </aside>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeJob ? (
            <div className="ord" style={{ cursor: 'grabbing', width: 240 }}>
              <div className="ord-head">
                <span className="ord-job">{String(activeJob.id)}</span>
                {activeJob.orderType && (
                  <span className="ord-type">
                    {ORDER_TYPE_SHORT[activeJob.orderType]}
                  </span>
                )}
              </div>
              <div className="ord-desc">{activeJob.description}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
