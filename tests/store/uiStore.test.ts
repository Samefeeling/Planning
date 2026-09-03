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
  it('opens on five working days plus yesterday with weekends hidden', () => {
    const state = useUiStore.getState();
    expect(state.orderWindow).toBe('next-five');
    expect(state.showWeekends).toBe(false);
    expect(state.dependencyMode).toBe('focus');
    state.toggleWeekends();
    expect(useUiStore.getState().showWeekends).toBe(true);
    useUiStore.getState().toggleWeekends();
  });

  it('switches dependency visibility without changing the plan', () => {
    useUiStore.getState().setDependencyMode('all');
    expect(useUiStore.getState().dependencyMode).toBe('all');
    useUiStore.getState().setDependencyMode('focus');
  });
});
