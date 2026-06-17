/**
 * Adjacent-job comparison → Die/Tool/Colour/Insert changeover detection.
 *
 * When the next job on a line uses a different die, colour or insert from the
 * job before it, the machine must be set up — costing time and flagged on the
 * board. The first job on a line always needs its die mounted.
 */

import type { ColorId, InsertId, ToolId } from '@/domain/ids';
import type { ChangeoverInfo, ChangeoverKind } from '@/domain/types';
import {
  CHANGEOVER_OVERLAP_FACTOR,
  COLOR_CHANGE_MINUTES,
  DIE_CHANGE_MINUTES,
  INSERT_CHANGE_MINUTES,
} from '@/domain/constants';

/** Minimal routing-ish shape needed to compare two jobs. */
export interface ChangeoverInputs {
  tool: ToolId | null;
  color: ColorId | null;
  insert: InsertId | null;
}

const KIND_MINUTES: Record<ChangeoverKind, number> = {
  tool: DIE_CHANGE_MINUTES,
  color: COLOR_CHANGE_MINUTES,
  insert: INSERT_CHANGE_MINUTES,
};

/** Two attributes differ only when both are known and unequal. */
function differs<T>(a: T | null, b: T | null): boolean {
  return a !== null && b !== null && a !== b;
}

/** Title-case a normalised id for display ("ned stool" → "Ned Stool"). */
function humanize(id: string | null): string {
  if (!id) return '?';
  return id.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Combine concurrent changeovers: the machine is down once, not N times. */
function combinedMinutes(kinds: ChangeoverKind[]): number {
  const mins = kinds.map((k) => KIND_MINUTES[k]).sort((a, b) => b - a);
  const [largest, ...rest] = mins;
  return (
    largest + rest.reduce((sum, m) => sum + m * CHANGEOVER_OVERLAP_FACTOR, 0)
  );
}

const NO_CHANGE = (tool: ToolId | null): ChangeoverInfo => ({
  required: false,
  kinds: [],
  minutes: 0,
  summary: 'No change',
  fromTool: tool,
  toTool: tool,
});

/**
 * Compare the previous job's setup with the current one's.
 * `prev === null` means the current job is first on the line.
 */
export function detectChangeover(
  prev: ChangeoverInputs | null,
  curr: ChangeoverInputs,
): ChangeoverInfo {
  if (prev === null) {
    return {
      required: true,
      kinds: ['tool'],
      minutes: DIE_CHANGE_MINUTES,
      summary: curr.tool ? `Set up die: ${humanize(curr.tool)}` : 'Initial set-up',
      fromTool: null,
      toTool: curr.tool,
    };
  }

  const kinds: ChangeoverKind[] = [];
  if (differs(prev.tool, curr.tool)) kinds.push('tool');
  if (differs(prev.color, curr.color)) kinds.push('color');
  if (differs(prev.insert, curr.insert)) kinds.push('insert');

  if (kinds.length === 0) return NO_CHANGE(curr.tool);

  const parts: string[] = [];
  if (kinds.includes('tool')) parts.push(`D/C → ${humanize(curr.tool)}`);
  if (kinds.includes('color')) parts.push(`colour → ${humanize(curr.color)}`);
  if (kinds.includes('insert')) parts.push(`insert → ${humanize(curr.insert)}`);

  return {
    required: true,
    kinds,
    minutes: combinedMinutes(kinds),
    summary: parts.join(', '),
    fromTool: prev.tool,
    toTool: curr.tool,
  };
}
