/**
 * Ephemeral view state that isn't part of the plan or the data: which job is
 * selected in the inspector, and the Gantt zoom level.
 */

import { create } from 'zustand';
import { DEFAULT_PX_PER_HOUR } from '@/domain/constants';
import type { Department } from '@/domain/types';

interface UiState {
  /** Which department's board is on screen. */
  department: Department;
  selectedJobId: string | null;
  pxPerHour: number;
  lastRefresh: Date | null;

  setDepartment: (department: Department) => void;
  select: (jobId: string | null) => void;
  setPxPerHour: (px: number) => void;
  setLastRefresh: (when: Date) => void;
}

export const useUiStore = create<UiState>((set) => ({
  department: 'moulding',
  selectedJobId: null,
  pxPerHour: DEFAULT_PX_PER_HOUR,
  lastRefresh: null,

  // Selection is per-board, so switching departments clears it.
  setDepartment: (department) => set({ department, selectedJobId: null }),
  select: (selectedJobId) => set({ selectedJobId }),
  setPxPerHour: (pxPerHour) =>
    set({ pxPerHour: Math.max(4, Math.min(48, pxPerHour)) }),
  setLastRefresh: (lastRefresh) => set({ lastRefresh }),
}));
