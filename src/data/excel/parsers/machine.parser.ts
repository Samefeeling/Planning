/**
 * Machines from the `resource` sheet (col 5) + the `makeMachine` factory that
 * turns a raw line label into a domain `Machine`. Shared by the mock source.
 */

import { MachineId } from '@/domain/ids';
import type { Machine } from '@/domain/types';
import { MACHINE_ORDER, isVisibleMachine } from '@/domain/constants';
import { asStr, dataRows, type Sheet } from './cell';
import type { ParseOutcome } from './types';

const RESOURCE_MACHINE_COL = 5;

/** Strip "(1000TB)", "PMD Machine" and surrounding whitespace from a label. */
function cleanName(raw: string): string {
  return raw
    .replace(/\(.*?\)/g, '')
    .replace(/\bPMD\b/gi, '')
    .replace(/\bMachine\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a `Machine` from a raw line name, parsing tonnage and sort order. */
export function makeMachine(rawName: string): Machine {
  const name = cleanName(rawName) || rawName.trim();
  const id = MachineId(name);
  const tonnage = (() => {
    const m = name.match(/^(\d+)\s*T/i);
    return m ? Number(m[1]) : undefined;
  })();
  const orderIdx = MACHINE_ORDER.indexOf(id);
  const sortIndex =
    orderIdx >= 0 ? orderIdx : MACHINE_ORDER.length + id.charCodeAt(0);
  return tonnage === undefined
    ? { id, name, sortIndex }
    : { id, name, tonnage, sortIndex };
}

/** Visible machines referenced by the routing sheet, in board order. */
export function parseMachines(resource: Sheet): ParseOutcome<Machine> {
  const byId = new Map<string, Machine>();
  for (const row of dataRows(resource)) {
    const raw = asStr(row[RESOURCE_MACHINE_COL]);
    if (!raw) continue;
    const m = makeMachine(raw);
    if (isVisibleMachine(m.id) && !byId.has(m.id)) byId.set(m.id, m);
  }
  const values = [...byId.values()].sort((a, b) => a.sortIndex - b.sortIndex);
  return { values, errors: [] };
}
