/**
 * Ephemeral view state that isn't part of the plan or the data: which job is
 * selected in the inspector, and the Gantt zoom level.
 */

import { create } from 'zustand';
import { DEFAULT_PX_PER_HOUR } from '@/domain/constants';

interface UiState {
  selectedJobId: string | null;
  pxPerHour: number;
  lastRefresh: Date | null;

  select: (jobId: string | null) => void;
  setPxPerHour: (px: number) => void;
  setLastRefresh: (when: Date) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedJobId: null,
  pxPerHour: DEFAULT_PX_PER_HOUR,
  lastRefresh: null,

  select: (selectedJobId) => set({ selectedJobId }),
  setPxPerHour: (pxPerHour) =>
    set({ pxPerHour: Math.max(4, Math.min(48, pxPerHour)) }),
  setLastRefresh: (lastRefresh) => set({ lastRefresh }),
}));
