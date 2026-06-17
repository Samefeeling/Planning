/**
 * Application shell: loads data, bootstraps/persists the plan, wires the global
 * drag-and-drop context, and lays out the board, job pool and inspector.
 */

import { useEffect, useRef } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useDataStore } from '@/store/dataStore';
import { usePlanStore } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import { findScheduledJob, useBoardView } from '@/store/selectors';
import { createPlanRepository, CURRENT_PLAN_ID } from '@/persistence';
import { useDragDrop } from '@/features/gantt/useDragDrop';
import { GanttBoard } from '@/features/gantt/GanttBoard';
import { JobCardBody } from '@/features/gantt/JobCard';
import { JobPool } from '@/features/jobpool/JobPool';
import { JobInspector } from '@/features/inspector/JobInspector';
import { useScheduledRefresh } from '@/features/refresh/useScheduledRefresh';
import { RefreshControl } from '@/features/refresh/RefreshControl';
import { buildEpicorRows, toTsv } from '@/engine/epicorExport';
import { Badge, Button, Spinner } from '@/ui';

const repo = createPlanRepository();

function Legend() {
  return (
    <div className="legend">
      <Badge variant="ok">Material OK</Badge>
      <Badge variant="warn">PO covers</Badge>
      <Badge variant="error">Short</Badge>
      <Badge variant="tool">Die</Badge>
      <Badge variant="color">Colour</Badge>
      <Badge variant="insert">Insert</Badge>
    </div>
  );
}

export default function App() {
  const status = useDataStore((s) => s.status);
  const error = useDataStore((s) => s.error);
  const dataset = useDataStore((s) => s.dataset);
  const load = useDataStore((s) => s.load);
  const sourceName = useDataStore((s) => s.source.name);

  const containers = usePlanStore((s) => s.containers);
  const laneDelays = usePlanStore((s) => s.laneDelays);
  const pxPerHour = useUiStore((s) => s.pxPerHour);
  const setPx = useUiStore((s) => s.setPxPerHour);

  const board = useBoardView();
  const dnd = useDragDrop();
  const refresh = useScheduledRefresh();

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
      plan.reconcile(dataset.machines, dataset.jobs);
      return;
    }
    bootstrapped.current = true;
    repo
      .load()
      .then((persisted) => {
        if (persisted?.containers) plan.setContainers(persisted.containers);
        if (persisted?.laneDelays) plan.setLaneDelays(persisted.laneDelays);
        plan.reconcile(dataset.machines, dataset.jobs);
      })
      .catch(() => plan.reconcile(dataset.machines, dataset.jobs));
  }, [status, dataset]);

  // Debounced autosave of the planner's layout (placements + line delays).
  useEffect(() => {
    if (!bootstrapped.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void repo.save({
        id: CURRENT_PLAN_ID,
        name: 'Working plan',
        savedAt: new Date().toISOString(),
        containers,
        laneDelays,
      });
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
  }, [containers, laneDelays]);

  const activeJob =
    dnd.activeJobId && board ? board.jobsById.get(dnd.activeJobId) : null;
  const activeScheduled = activeJob
    ? findScheduledJob(board, dnd.activeJobId)
    : null;

  const copyToEpicor = async () => {
    if (!board) return;
    const tsv = toTsv(buildEpicorRows(board.lanes));
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {
      // Clipboard blocked (e.g. insecure context) — surface the text instead.
      window.prompt('Copy the Epicor return rows:', tsv);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Resero Planning</h1>
        <span className="sub">PMD schedule board</span>
        <Badge variant="info">{sourceName}</Badge>
        <div className="spacer" />
        <Legend />
        <div className="zoom">
          <span className="sub">Zoom</span>
          <Button icon onClick={() => setPx(pxPerHour - 3)} aria-label="Zoom out">
            −
          </Button>
          <Button icon onClick={() => setPx(pxPerHour + 3)} aria-label="Zoom in">
            +
          </Button>
        </div>
        <Button onClick={() => void copyToEpicor()} disabled={!board}>
          Copy → Epicor
        </Button>
        <RefreshControl onRefresh={() => void refresh()} />
      </header>

      {error && <div className="banner">Data error: {error}</div>}

      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        onDragCancel={dnd.onDragCancel}
      >
        <div className="app-body">
          <div className="board-pane">
            {board ? (
              <GanttBoard board={board} />
            ) : (
              <div className="center-fill">
                <Spinner />
                <span>Loading schedule…</span>
              </div>
            )}
          </div>
          <aside className="side-pane">
            {board && <JobPool jobs={board.pool} />}
            {board && <JobInspector board={board} />}
          </aside>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeJob ? (
            <div
              className={`job compact ${
                activeScheduled ? `mat-${activeScheduled.material.level}` : ''
              }`}
              style={{ cursor: 'grabbing' }}
            >
              <JobCardBody
                job={activeJob}
                scheduled={activeScheduled ?? undefined}
                variant="pool"
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
