/**
 * Assembly orders not yet assigned to an area. Same role as the moulding job
 * pool: a drop target the supervisor can park work in.
 */

import { useDroppable } from '@dnd-kit/core';
import type { AssemblyBoardView } from '@/engine/assembly/board';
import { POOL_ID } from '@/store/planStore';
import { useUiStore } from '@/store/uiStore';
import { OrderCard } from './OrderCard';

export function AssemblyPool({ board }: { board: AssemblyBoardView }) {
  const { setNodeRef, isOver } = useDroppable({
    id: POOL_ID,
    data: { type: 'pool' },
  });
  const select = useUiStore((s) => s.select);
  const selectedJobId = useUiStore((s) => s.selectedJobId);

  return (
    <div ref={setNodeRef} className={`pool ${isOver ? 'drop-active' : ''}`}>
      <h2>Unassigned · {board.pool.length}</h2>
      <div className="pool-list">
        {board.pool.length === 0 ? (
          <div className="pool-empty">
            Every order has an area. Drag a card here to park it.
          </div>
        ) : (
          board.pool.map((job) => (
            <OrderCard
              key={String(job.id)}
              order={{
                job,
                stage: null,
                route: [],
                stageIndex: -1,
                material: { level: 'unknown', earliestStart: null, shortages: [] },
                release: {
                  level: 'caution',
                  releasable: false,
                  needsOverride: false,
                  reason: 'Not assigned to an area',
                },
                warnings: [],
              }}
              selected={selectedJobId === String(job.id)}
              onSelect={select}
            />
          ))
        )}
      </div>
    </div>
  );
}
