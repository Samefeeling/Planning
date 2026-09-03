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
import { useUiStore } from '@/store/uiStore';
import { DEFAULT_DAY_WIDTH } from '@/store/uiStore';
import { DRAG_TYPE_BAR } from '@/features/assembly/OrderBar';
import type { LineKey } from '@/domain/assembly';
import {
  isWeekend,
  nextWorkingDay,
  startOfDay,
} from '@/engine/assembly/dates';
import { dayKey } from '@/engine/assembly/workload';
import { shiftTimelineDays } from './boardView';

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
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragStart = (e: DragStartEvent) => {
    // Bars carry a prefixed id; the overlay only wants plain job cards.
    const type = e.active.data.current?.type;
    setActiveWorkerId(
      type === 'worker' ? String(e.active.data.current?.workerId ?? '') : null,
    );
    setActiveJobId(
      type === DRAG_TYPE_BAR || type === 'worker' ? null : String(e.active.id),
    );
  };
  const onDragCancel = () => {
    setActiveJobId(null);
    setActiveWorkerId(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveJobId(null);
    setActiveWorkerId(null);
    const { over, active, delta } = e;

    if (active.data.current?.type === 'worker') {
      if (over?.data.current?.type !== 'line') return;
      const line = over.data.current.lineKey as LineKey | undefined;
      if (!line) return;
      usePlanStore
        .getState()
        .moveWorkerToLine(String(active.data.current.workerId), line);
      return;
    }

    // An assembly bar dragged along its own row moves its start day. Dragged
    // onto another line, it changes line as well — and that is the only thing
    // that moves a row off the one it is on. Rows never re-order themselves
    // because a bar was pushed out; the board is the planner's own layout.
    if (active.data.current?.type === DRAG_TYPE_BAR) {
      const jobId = JobId(String(active.data.current.jobId));
      const dayWidth = Number(active.data.current.dayWidth) || DEFAULT_DAY_WIDTH;
      const showWeekends = active.data.current.showWeekends === true;
      const dayShift = Math.round((delta?.x ?? 0) / dayWidth);

      const { orderStarts, setOrderStart, setOvertime, containerOf, moveJob } =
        usePlanStore.getState();
      const key = String(jobId);
      if (usePlanStore.getState().orderActualStarts[key]) return;

      const droppedOn =
        over?.data.current?.type === 'line'
          ? String(over.data.current.lineId)
          : null;
      if (droppedOn && droppedOn !== containerOf(jobId)) {
        moveJob(jobId, droppedOn);
      }
      if (dayShift === 0) return;
      // Move from where the bar is drawn. The pinned day is only a request —
      // the line's capacity, a predecessor or a weekend may have pushed the
      // bar past it, and dragging from the pin would then snap it backwards.
      const drawn = active.data.current.startISO as string | null | undefined;
      const from = drawn
        ? startOfDay(new Date(drawn))
        : orderStarts[key]
          ? startOfDay(new Date(orderStarts[key]))
          : startOfDay(new Date());
      const moved = startOfDay(
        shiftTimelineDays(from, dayShift, showWeekends),
      );

      // The factory is shut at the weekend. Ask before writing work into one;
      // nothing changes until the supervisor answers.
      if (isWeekend(moved)) {
        useUiStore.getState().askOvertime({
          jobId: key,
          isoDay: dayKey(moved),
          nextWorkingIsoDay: dayKey(nextWorkingDay(moved)),
        });
        return;
      }

      // Back onto a weekday: whatever overtime was approved is no longer
      // needed, so it lapses rather than quietly following the order around.
      setOvertime(jobId, false);
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
    activeWorkerId,
    onDragStart,
    onDragEnd,
    onDragCancel,
    collisionDetection,
  };
}
