/**
 * Derived assembly board — the counterpart to `selectors.useBoardView` for the
 * moulding Gantt. Both read the same plan store; only the derivation differs.
 */

import { useMemo } from 'react';
import {
  computeAssemblyBoard,
  type AssemblyBoardView,
  type AssemblyOrderView,
} from '@/engine/assembly/board';
import { useDataStore } from './dataStore';
import { usePlanStore } from './planStore';

export function useAssemblyBoard(): AssemblyBoardView | null {
  const dataset = useDataStore((s) => s.dataset);
  const indexes = useDataStore((s) => s.indexes);
  const containers = usePlanStore((s) => s.containers);
  const areaHeadcount = usePlanStore((s) => s.areaHeadcount);

  return useMemo(
    () =>
      dataset && indexes
        ? computeAssemblyBoard(
            dataset,
            indexes,
            containers,
            areaHeadcount,
            dataset.fetchedAt,
          )
        : null,
    [dataset, indexes, containers, areaHeadcount],
  );
}

/** Find one assembly order across all area columns (for the inspector). */
export function findAssemblyOrder(
  board: AssemblyBoardView | null,
  jobId: string | null,
): AssemblyOrderView | null {
  if (!board || !jobId) return null;
  for (const col of board.columns) {
    const hit = col.orders.find((o) => String(o.job.id) === jobId);
    if (hit) return hit;
  }
  return null;
}
