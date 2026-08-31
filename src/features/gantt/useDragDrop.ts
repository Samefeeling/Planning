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
import { DAY_WIDTH } from '@/features/assembly/AssemblyGantt';
import { DRAG_TYPE_BAR } from '@/features/assembly/OrderBar';
import { addDays, startOfDay } from '@/engine/assembly/dates';

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

  const onDragStart = (e: DragStartEvent) => {
    // Bars carry a prefixed id; the overlay only wants plain job cards.
    const type = e.active.data.current?.type;
    setActiveJobId(type === DRAG_TYPE_BAR ? null : String(e.active.id));
  };
  const onDragCancel = () => setActiveJobId(null);

  const onDragEnd = (e: DragEndEvent) => {
    setActiveJobId(null);
    const { over, active, delta } = e;

    // An assembly bar dragged along its own row just moves its start day.
    if (active.data.current?.type === DRAG_TYPE_BAR) {
      const jobId = JobId(String(active.data.current.jobId));
      const dayShift = Math.round((delta?.x ?? 0) / DAY_WIDTH);
      if (dayShift === 0) return;
      const { orderStarts, setOrderStart } = usePlanStore.getState();
      const key = String(jobId);
      const current = orderStarts[key]
        ? startOfDay(new Date(orderStarts[key]))
        : startOfDay(new Date());
      const moved = addDays(current, dayShift);
      setOrderStart(jobId, moved.toISOString());
      return;
    }

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
