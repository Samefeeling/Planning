/**
 * Application shell: loads data, bootstraps/persists the plan, wires the global
 * drag-and-drop context, and lays out the board, job pool and inspector.
 */

import { useEffect, useRef } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import type { Department } from '@/domain/types';
import { useDataStore } from '@/store/dataStore';
import { usePlanStore } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import { findScheduledJob, useBoardView } from '@/store/selectors';
import { useAssemblyBoard } from '@/store/assemblySelectors';
import { createPlanRepository, CURRENT_PLAN_ID } from '@/persistence';
import { useDragDrop } from '@/features/gantt/useDragDrop';
import { GanttBoard } from '@/features/gantt/GanttBoard';
import { JobCardBody } from '@/features/gantt/JobCard';
import { JobPool } from '@/features/jobpool/JobPool';
import { JobInspector } from '@/features/inspector/JobInspector';
import { useScheduledRefresh } from '@/features/refresh/useScheduledRefresh';
import { RefreshControl } from '@/features/refresh/RefreshControl';
import { AssemblyBoard } from '@/features/assembly/AssemblyBoard';
import { AssemblyPool } from '@/features/assembly/AssemblyPool';
import { AssemblyInspector } from '@/features/assembly/AssemblyInspector';
import { buildEpicorRows, toTsv } from '@/engine/epicorExport';
import { Badge, Button, Spinner } from '@/ui';

const repo = createPlanRepository();

function Legend({ department }: { department: Department }) {
  if (department === 'assembly') {
    return (
      <div className="legend">
        <Badge variant="ok">Ready</Badge>
        <Badge variant="warn">Waiting material / kit</Badge>
        <Badge variant="error">Blocked</Badge>
      </div>
    );
  }
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

const DEPARTMENTS: { id: Department; label: string }[] = [
  { id: 'moulding', label: 'Moulding (PMD)' },
  { id: 'assembly', label: 'Assembly' },
];

function DepartmentTabs() {
  const department = useUiStore((s) => s.department);
  const setDepartment = useUiStore((s) => s.setDepartment);
  return (
    <div className="tabs" role="tablist">
      {DEPARTMENTS.map((d) => (
        <button
          key={d.id}
          role="tab"
          aria-selected={department === d.id}
          className={`tab ${department === d.id ? 'active' : ''}`}
          onClick={() => setDepartment(d.id)}
        >
          {d.label}
        </button>
      ))}
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
  const areaHeadcount = usePlanStore((s) => s.areaHeadcount);
  const department = useUiStore((s) => s.department);
  const pxPerHour = useUiStore((s) => s.pxPerHour);
  const setPx = useUiStore((s) => s.setPxPerHour);

  const board = useBoardView();
  const assembly = useAssemblyBoard();
  const isAssembly = department === 'assembly';
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
      plan.reconcile(dataset.workCenters, dataset.jobs);
      return;
    }
    bootstrapped.current = true;
    repo
      .load()
      .then((persisted) => {
        if (persisted?.containers) plan.setContainers(persisted.containers);
        if (persisted?.laneDelays) plan.setLaneDelays(persisted.laneDelays);
        if (persisted?.areaHeadcount)
          plan.setAreaHeadcounts(persisted.areaHeadcount);
        plan.reconcile(dataset.workCenters, dataset.jobs);
      })
      .catch(() => plan.reconcile(dataset.workCenters, dataset.jobs));
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
        areaHeadcount,
      });
    }, 600);
    return () => window.clearTimeout(saveTimer.current);
  }, [containers, laneDelays, areaHeadcount]);

  const activeJob = dnd.activeJobId
    ? (board?.jobsById.get(dnd.activeJobId) ??
      assembly?.jobsById.get(dnd.activeJobId) ??
      null)
    : null;
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
        <DepartmentTabs />
        <Badge variant="info">{sourceName}</Badge>
        <div className="spacer" />
        <Legend department={department} />
        {!isAssembly && (
          <div className="zoom">
            <span className="sub">Zoom</span>
            <Button
              icon
              onClick={() => setPx(pxPerHour - 3)}
              aria-label="Zoom out"
            >
              −
            </Button>
            <Button
              icon
              onClick={() => setPx(pxPerHour + 3)}
              aria-label="Zoom in"
            >
              +
            </Button>
          </div>
        )}
        {!isAssembly && (
          <Button onClick={() => void copyToEpicor()} disabled={!board}>
            Copy → Epicor
          </Button>
        )}
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
          <div className={isAssembly ? 'board-pane assembly-pane' : 'board-pane'}>
            {isAssembly ? (
              assembly ? (
                <AssemblyBoard board={assembly} />
              ) : (
                <div className="center-fill">
                  <Spinner />
                  <span>Loading assembly orders…</span>
                </div>
              )
            ) : board ? (
              <GanttBoard board={board} />
            ) : (
              <div className="center-fill">
                <Spinner />
                <span>Loading schedule…</span>
              </div>
            )}
          </div>
          <aside className="side-pane">
            {isAssembly ? (
              assembly && (
                <>
                  <AssemblyPool board={assembly} />
                  <AssemblyInspector board={assembly} />
                </>
              )
            ) : (
              board && (
                <>
                  <JobPool jobs={board.pool} />
                  <JobInspector board={board} />
                </>
              )
            )}
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
