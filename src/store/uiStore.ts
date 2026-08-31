/**
 * Ephemeral view state that isn't part of the plan or the data: which job is
 * selected in the inspector, and the Gantt zoom level.
 */

import { create } from 'zustand';

interface UiState {
  /** Order shown in the inspector. */
  selectedJobId: string | null;
  lastRefresh: Date | null;

  select: (jobId: string | null) => void;
  setLastRefresh: (when: Date) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedJobId: null,
  lastRefresh: null,

  select: (selectedJobId) => set({ selectedJobId }),
  setLastRefresh: (lastRefresh) => set({ lastRefresh }),
}));
