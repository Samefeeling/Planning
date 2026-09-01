/**
 * "Crew N orders" — a first allocation for a freshly imported export.
 *
 * `Planning1.csv` says what to build, never who builds it, so every order
 * arrives with nobody on it and therefore with no bar at all. This fills them
 * from the qualified people on shift so the week has a shape to argue with;
 * see `engine/assembly/crew`. It is deliberately one explicit click, gated by
 * the same lock as allocating by hand — nothing is invented behind the
 * supervisor's back — and it never touches an order that is already crewed.
 */

import { useMemo } from 'react';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import { suggestCrew } from '@/engine/assembly/crew';
import { usePlanStore } from '@/store/planStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { Button } from '@/ui';

export function SuggestCrew({ board }: { board: AssemblyGanttView | null }) {
  const assignCrews = usePlanStore((s) => s.assignCrews);
  const unlocked = useSupervisorStore((s) => s.unlocked);
  const suggestion = useMemo(
    () => (board ? suggestCrew(board) : null),
    [board],
  );

  // Nothing to say when every order already has its people.
  if (!suggestion || suggestion.staffed === 0) return null;

  return (
    <Button
      onClick={() => assignCrews(suggestion.allocations)}
      disabled={!unlocked}
      title={
        unlocked
          ? `Put the qualified people on shift onto the ${suggestion.staffed} ` +
            'orders that have nobody, so they can be scheduled. Orders that ' +
            'already have a crew are left alone.' +
            (suggestion.unstaffed > 0
              ? ` ${suggestion.unstaffed} more have nobody qualified in today.`
              : '')
          : 'Allocating crew needs the supervisor password'
      }
    >
      Crew {suggestion.staffed} orders
    </Button>
  );
}
