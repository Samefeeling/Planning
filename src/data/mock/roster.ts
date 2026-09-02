/**
 * The demo roster — the fifteen people in `seed.json`.
 *
 * It stands in for the `ASSY_Operator` SharePoint list wherever that list
 * cannot be read: without a roster no order can be crewed, and without a crew
 * no order has a bar, so a board with real orders and no people is a blank
 * schedule. Borrowed people are worth less than real ones but a great deal
 * more than none, and the board says which it is showing.
 */

import { WorkerId } from '@/domain/ids';
import type { LineKey, Worker } from '@/domain/assembly';
import seed from './seed.json';

export function demoWorkers(): Worker[] {
  return (seed.workers ?? []).map((w) => ({
    id: WorkerId(w.id),
    name: w.name,
    skills: (w.skills ?? []) as LineKey[],
    onShift: Boolean(w.onShift),
    synthetic: true,
  }));
}
