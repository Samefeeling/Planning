import { useState } from 'react';
import type { LineGroup } from '@/engine/assembly/board';
import { retainLineRows, type OrderSort } from './boardView';

/** Snapshot identity, not row data: edits update bars without moving rows. */
export function useStableBoardOrder(groups: LineGroup[], sort: OrderSort): LineGroup[] {
  const [snapshot, setSnapshot] = useState(() => ({
    source: groups,
    sort,
    groups: groups.map((group) => ({ ...group, rows: retainLineRows(group.rows, sort) })),
  }));
  if (snapshot.source === groups && snapshot.sort === sort) return snapshot.groups;

  const previous = new Map(snapshot.groups.map((group) => [
    group.line.key, group.rows.map((row) => String(row.job.id)),
  ]));
  const next = groups.map((group) => ({
    ...group,
    rows: retainLineRows(group.rows, sort,
      snapshot.sort === sort ? previous.get(group.line.key) : undefined),
  }));
  // Adjust this component's state before React commits its children. This
  // avoids a frame in the old order and keeps aborted renders isolated.
  setSnapshot({ source: groups, sort, groups: next });
  return next;
}
