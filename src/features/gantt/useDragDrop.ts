/**
 * @dnd-kit wiring for the board. Jobs are draggable; lanes, the pool, and other
 * job cards are drop targets. Dropping onto a lane/pool appends; dropping onto
 * a card inserts before it (re-ordering). All mutations go through the plan
 * store, which the selectors re-derive into a fresh timeline.
 */

import { useState } from 'react';
import {
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { JobId } from '@/domain/ids';
import { POOL_ID, usePlanStore } from '@/store/planStore';

/** Prefer the specific card target, then a lane/pool, then the nearest. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const cards = hits.filter((h) => String(h.id).startsWith('card:'));
  if (cards.length) return cards;
  if (hits.length) return hits;
  return closestCenter(args);
};

export function useDragDrop() {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragStart = (e: DragStartEvent) => setActiveJobId(String(e.active.id));
  const onDragCancel = () => setActiveJobId(null);

  const onDragEnd = (e: DragEndEvent) => {
    setActiveJobId(null);
    const { over, active } = e;
    if (!over) return;

    const activeJob = JobId(String(active.id));
    const overId = String(over.id);
    const { containers, containerOf, moveJob } = usePlanStore.getState();

    if (overId.startsWith('card:')) {
      const overJob = JobId(overId.slice(5));
      const container = containerOf(overJob) ?? POOL_ID;
      const arr = containers[container] ?? [];
      let index = arr.indexOf(overJob);
      // Removing the active job first shifts later indices left by one when it
      // came from above the target in the same lane — compensate.
      if (containerOf(activeJob) === container) {
        const fromIndex = arr.indexOf(activeJob);
        if (fromIndex !== -1 && fromIndex < index) index -= 1;
      }
      moveJob(activeJob, container, index);
      return;
    }

    // Dropped on a lane or the pool → append.
    moveJob(activeJob, overId);
  };

  return {
    sensors,
    activeJobId,
    onDragStart,
    onDragEnd,
    onDragCancel,
    collisionDetection,
  };
}
