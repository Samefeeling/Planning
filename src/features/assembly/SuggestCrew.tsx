/**
 * "Crew N orders" — a first allocation for a freshly imported export.
 *
 * `Planning1.csv` says what to build, never who builds it, so every order
 * arrives with nobody on it and therefore with no bar at all. This fills them
 * from each current production-line roster so the week has a shape to argue with;
 * see `engine/assembly/crew`. It is deliberately one explicit click, gated by
 * the same lock as allocating by hand — nothing is invented behind the
 * supervisor's back — and it never touches an order that is already crewed.
 *
 * The suggestion is worked out on the click, not on every render: it staffs a
 * round, re-derives the whole board, and staffs the next against the dates
 * that came back, which is what keeps it from putting anyone on two orders at
 * once. That costs a few milliseconds a round and is far too much to repeat
 * behind a label.
 */

import type { AssemblyGanttView } from '@/engine/assembly/board';
import { countUnstaffed, suggestCrew } from '@/engine/assembly/crew';
import { recomputeAssemblyGantt } from '@/store/assemblySelectors';
import { usePlanStore } from '@/store/planStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { Button } from '@/ui';
import { lineOfWorkerToday } from './boardView';

export function SuggestCrew({ board }: { board: AssemblyGanttView | null }) {
  const assignCrews = usePlanStore((s) => s.assignCrews);
  const workerLineOverrides = usePlanStore((s) => s.workerLines);
  const unlocked = useSupervisorStore((s) => s.unlocked);

  const waiting = board ? countUnstaffed(board) : 0;
  // Nothing to say when every order already has its people.
  if (!board || waiting === 0) return null;

  const crewThem = () => {
    const rows = board.groups.flatMap((group) => group.rows);
    const workerLines = lineOfWorkerToday(
      board.workers,
      rows,
      board.today,
      workerLineOverrides,
    );
    const { allocations } = suggestCrew(
      board,
      (soFar) => recomputeAssemblyGantt(soFar) ?? board,
      workerLines,
    );
    assignCrews(allocations);
  };

  return (
    <Button
      onClick={crewThem}
      disabled={!unlocked}
      title={
        unlocked
          ? `Put people from each current production-line roster onto the ${waiting} orders that ` +
            'have nobody, so they can be scheduled. Orders that already have a ' +
            'crew are left alone, and nobody is put on two orders at once — an ' +
            'order with nobody free across its days is left for you.'
          : 'Allocating crew needs the supervisor password'
      }
    >
      Crew {waiting} orders
    </Button>
  );
}
