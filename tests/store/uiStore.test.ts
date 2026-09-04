import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/store/uiStore';

describe('single employee picker', () => {
  beforeEach(() => {
    useUiStore.setState({
      crewPickerJobId: null,
      selectedJobId: null,
      selectedAt: null,
    });
  });

  it('replaces the previous order picker when another is opened', () => {
    useUiStore.getState().setCrewPicker('JOB-1');
    useUiStore.getState().setCrewPicker('JOB-2');
    expect(useUiStore.getState().crewPickerJobId).toBe('JOB-2');
  });

  it('closes the employee picker when an order block is selected', () => {
    useUiStore.getState().setCrewPicker('JOB-1');
    useUiStore.getState().select('JOB-2', { x: 10, y: 20 });
    expect(useUiStore.getState().crewPickerJobId).toBeNull();
    expect(useUiStore.getState().selectedJobId).toBe('JOB-2');
  });
});

describe('board display defaults', () => {
  it('opens on five working days with weekends hidden and starts ascending', () => {
    const state = useUiStore.getState();
    expect(state.orderWindow).toBe('next-five');
    expect(state.showWeekends).toBe(false);
    expect(state.orderSort).toEqual({ key: 'start', direction: 'asc' });
    state.toggleWeekends();
    expect(useUiStore.getState().showWeekends).toBe(true);
    useUiStore.getState().toggleWeekends();
  });

  it('restores earliest-start ordering when Refresh resets a custom sort', () => {
    useUiStore.getState().changeOrderSort('due');
    useUiStore.getState().changeOrderSort('due');
    expect(useUiStore.getState().orderSort).toEqual({ key: 'due', direction: 'desc' });
    useUiStore.getState().resetOrderSort();
    expect(useUiStore.getState().orderSort).toEqual({ key: 'start', direction: 'asc' });
    const snapshot = useUiStore.getState().orderSort;
    useUiStore.getState().resetOrderSort();
    expect(useUiStore.getState().orderSort).not.toBe(snapshot);
  });

  it('selects a day without changing the order snapshot and clears back to five days', () => {
    const sort = useUiStore.getState().orderSort;
    useUiStore.getState().setOrderDay('2026-09-04');
    expect(useUiStore.getState().orderWindow).toBe('day');
    expect(useUiStore.getState().orderDay).toBe('2026-09-04');
    expect(useUiStore.getState().orderSort).toBe(sort);
    useUiStore.getState().setOrderDay(null);
    expect(useUiStore.getState().orderWindow).toBe('next-five');
    expect(useUiStore.getState().orderDay).toBeNull();
  });
});

/**
 * Marking a run of orders with Ctrl to shift them together. Kept apart from
 * the single selection that opens the detail: they answer different questions.
 */
describe('the marked set', () => {
  beforeEach(() => {
    useUiStore.setState({ marked: [], selectedJobId: null });
  });

  it('starts empty and ticks orders on and off', () => {
    expect(useUiStore.getInitialState().marked).toEqual([]);
    useUiStore.getState().toggleMark('ASM8018');
    useUiStore.getState().toggleMark('ASM8019');
    expect(useUiStore.getState().marked).toEqual(['ASM8018', 'ASM8019']);
    useUiStore.getState().toggleMark('ASM8018');
    expect(useUiStore.getState().marked).toEqual(['ASM8019']);
  });

  it('keeps the open order and the marked set apart', () => {
    useUiStore.getState().toggleMark('ASM8018');
    useUiStore.getState().select('ASM8021', { x: 1, y: 2 });
    // Opening one to read it does not tick it, nor let go of what is ticked.
    expect(useUiStore.getState().marked).toEqual(['ASM8018']);
    expect(useUiStore.getState().selectedJobId).toBe('ASM8021');
  });

  it('lets go of the whole set at once', () => {
    useUiStore.getState().toggleMark('A');
    useUiStore.getState().toggleMark('B');
    useUiStore.getState().clearMarks();
    expect(useUiStore.getState().marked).toEqual([]);
  });
});
