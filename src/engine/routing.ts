/**
 * part → tool/insert → machine resolution.
 *
 * The `resource` sheet says which machines can run a part and with what die,
 * colour and insert. These helpers index that table and answer the questions
 * the board asks: "can this job go on this line?" and "what's the setup here?".
 */

import type { MachineId, PartId } from '@/domain/ids';
import type { RoutingEntry } from '@/domain/types';

export interface RoutingIndex {
  /** Keyed by `${partNum}::${machine}` → the routing for that pairing. */
  byPartMachine: Map<string, RoutingEntry>;
  /** All machines a part can run on. */
  byPart: Map<PartId, RoutingEntry[]>;
}

const pmKey = (part: PartId, machine: MachineId): string => `${part}::${machine}`;

export function buildRoutingIndex(routing: RoutingEntry[]): RoutingIndex {
  const byPartMachine = new Map<string, RoutingEntry>();
  const byPart = new Map<PartId, RoutingEntry[]>();
  for (const r of routing) {
    byPartMachine.set(pmKey(r.partNum, r.machine), r);
    const list = byPart.get(r.partNum);
    if (list) list.push(r);
    else byPart.set(r.partNum, [r]);
  }
  return { byPartMachine, byPart };
}

/** The routing for a (part, machine) pairing, or null if not capable. */
export function routingFor(
  part: PartId,
  machine: MachineId,
  idx: RoutingIndex,
): RoutingEntry | null {
  return idx.byPartMachine.get(pmKey(part, machine)) ?? null;
}

/** Every machine the part is allowed to run on. */
export function machinesForPart(part: PartId, idx: RoutingIndex): MachineId[] {
  return (idx.byPart.get(part) ?? []).map((r) => r.machine);
}

/** True when the part has a routing on the given machine. */
export function isRoutable(
  part: PartId,
  machine: MachineId,
  idx: RoutingIndex,
): boolean {
  return idx.byPartMachine.has(pmKey(part, machine));
}
