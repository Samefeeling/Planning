import { describe, it, expect } from 'vitest';
import { detectChangeover, type ChangeoverInputs } from '@/engine/changeover';
import { ColorId, InsertId, ToolId } from '@/domain/ids';
import {
  COLOR_CHANGE_MINUTES,
  DIE_CHANGE_MINUTES,
  INSERT_CHANGE_MINUTES,
  CHANGEOVER_OVERLAP_FACTOR,
} from '@/domain/constants';

const inputs = (
  tool: string | null,
  color: string | null = null,
  insert: string | null = null,
): ChangeoverInputs => ({
  tool: tool ? ToolId(tool) : null,
  color: color ? ColorId(color) : null,
  insert: insert ? InsertId(insert) : null,
});

describe('detectChangeover', () => {
  it('requires a die set-up for the first job on a line', () => {
    const c = detectChangeover(null, inputs('Ned stool'));
    expect(c.required).toBe(true);
    expect(c.kinds).toEqual(['tool']);
    expect(c.minutes).toBe(DIE_CHANGE_MINUTES);
    expect(c.toTool).toBe(ToolId('Ned stool'));
  });

  it('reports no change when tool, colour and insert all match', () => {
    const prev = inputs('viva seat', 'black', '16');
    const curr = inputs('VIVA SEAT', 'Black', '16'); // case-insensitive
    const c = detectChangeover(prev, curr);
    expect(c.required).toBe(false);
    expect(c.minutes).toBe(0);
  });

  it('detects a die change on its own', () => {
    const c = detectChangeover(inputs('die-a'), inputs('die-b'));
    expect(c.required).toBe(true);
    expect(c.kinds).toEqual(['tool']);
    expect(c.minutes).toBe(DIE_CHANGE_MINUTES);
  });

  it('detects a colour change on its own', () => {
    const c = detectChangeover(inputs('die-a', 'black'), inputs('die-a', 'white'));
    expect(c.kinds).toEqual(['color']);
    expect(c.minutes).toBe(COLOR_CHANGE_MINUTES);
  });

  it('combines concurrent changes: largest + overlap of the rest', () => {
    const c = detectChangeover(
      inputs('die-a', 'black', '16'),
      inputs('die-b', 'white', '16'),
    );
    expect(c.kinds).toEqual(['tool', 'color']);
    const expected =
      DIE_CHANGE_MINUTES + COLOR_CHANGE_MINUTES * CHANGEOVER_OVERLAP_FACTOR;
    expect(c.minutes).toBeCloseTo(expected);
  });

  it('counts all three kinds when tool, colour and insert differ', () => {
    const c = detectChangeover(
      inputs('die-a', 'black', '16'),
      inputs('die-b', 'white', '24'),
    );
    expect(c.kinds.sort()).toEqual(['color', 'insert', 'tool']);
    const rest = (COLOR_CHANGE_MINUTES + INSERT_CHANGE_MINUTES) *
      CHANGEOVER_OVERLAP_FACTOR;
    expect(c.minutes).toBeCloseTo(DIE_CHANGE_MINUTES + rest);
  });

  it('does not flag a change when an attribute is unknown (null)', () => {
    // prev has a colour, curr's colour is unknown → not a detected change
    const c = detectChangeover(inputs('die-a', 'black'), inputs('die-a', null));
    expect(c.required).toBe(false);
  });
});
