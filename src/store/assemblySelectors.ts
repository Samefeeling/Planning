/**
 * Derived assembly Gantt — the counterpart to `selectors.useBoardView` for the
 * moulding board. Both read the same plan store; only the derivation differs.
 */

import { useMemo } from 'react';
import {
  computeAssemblyGantt,
  type AssemblyGanttView,
  type OrderRow,
} from '@/engine/assembly/board';
import { useDataStore } from './dataStore';
import { usePlanStore } from './planStore';

export function useAssemblyGantt(): AssemblyGanttView | null {
  const dataset = useDataStore((s) => s.dataset);
  const indexes = useDataStore((s) => s.indexes);
  const containers = usePlanStore((s) => s.containers);
  const orderWorkers = usePlanStore((s) => s.orderWorkers);
  const orderStarts = usePlanStore((s) => s.orderStarts);
  const progress = usePlanStore((s) => s.progress);
  const production = usePlanStore((s) => s.production);

  return useMemo(
    () =>
      dataset && indexes
        ? computeAssemblyGantt({
            dataset,
            indexes,
            containers,
            orderWorkers,
            orderStarts,
            progress,
            production,
            workers: dataset.workers,
            today: new Date(),
          })
        : null,
    [dataset, indexes, containers, orderWorkers, orderStarts, progress, production],
  );
}

/** The row for one order, if it is on a line. */
export function findOrderRow(
  board: AssemblyGanttView | null,
  jobId: string | null,
): OrderRow | null {
  if (!board || !jobId) return null;
  return board.rowsByJob.get(jobId) ?? null;
}
