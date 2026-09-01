/**
 * Ephemeral view state that isn't part of the plan or the data: which job is
 * selected in the inspector, whether the side pane is showing, the Gantt zoom
 * level, and the weekend-overtime question waiting on an answer.
 */

import { create } from 'zustand';

/**
 * A bar dropped on a Saturday or Sunday. Nothing is written to the plan until
 * the supervisor answers: the factory is closed, so weekend work costs money
 * and is theirs to authorise.
 */
export interface OvertimeRequest {
  jobId: string;
  /** ISO day the bar was dropped on. */
  isoDay: string;
  /** First working day at or after `isoDay` — the "move it to Monday" answer. */
  nextWorkingIsoDay: string;
}

interface UiState {
  /** Order shown in the inspector. */
  selectedJobId: string | null;
  /**
   * The right-hand pane. Closed gives the whole width to the schedule, which
   * is how the supervisor looks further out; selecting an order brings it back.
   */
  sidePaneOpen: boolean;
  overtimeRequest: OvertimeRequest | null;
  lastRefresh: Date | null;

  select: (jobId: string | null) => void;
  setSidePane: (open: boolean) => void;
  askOvertime: (request: OvertimeRequest) => void;
  clearOvertime: () => void;
  setLastRefresh: (when: Date) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedJobId: null,
  sidePaneOpen: true,
  overtimeRequest: null,
  lastRefresh: null,

  // Picking an order is a request to see it, so it re-opens a closed pane.
  select: (selectedJobId) =>
    set(selectedJobId ? { selectedJobId, sidePaneOpen: true } : { selectedJobId }),
  setSidePane: (sidePaneOpen) => set({ sidePaneOpen }),
  askOvertime: (overtimeRequest) => set({ overtimeRequest }),
  clearOvertime: () => set({ overtimeRequest: null }),
  setLastRefresh: (lastRefresh) => set({ lastRefresh }),
}));
