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

/** Day column width, in pixels: the default, and how far it may be pushed. */
export const DEFAULT_DAY_WIDTH = 92;
export const MIN_DAY_WIDTH = 44;
export const MAX_DAY_WIDTH = 160;

/** Order column width, in pixels. Dragged by its edge in the board header. */
export const DEFAULT_ORDER_WIDTH = 200;
export const MIN_ORDER_WIDTH = 120;
export const MAX_ORDER_WIDTH = 520;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(n)));

/** The four date columns, in the order the board draws them. */
export const DATE_COLS = ['start', 'due', 'expect', 'ship'] as const;
export type DateCol = (typeof DATE_COLS)[number];
export type DateCols = Record<DateCol, boolean>;

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
  /**
   * Timeline zoom. It lives here rather than in the board because the zoom
   * buttons sit in the app header, above the board that answers to them.
   */
  dayWidth: number;
  /** Width of the frozen Order column, dragged by its right-hand edge. */
  orderWidth: number;
  /** Which date columns are showing; hidden ones come back from the header. */
  dateCols: DateCols;

  select: (jobId: string | null) => void;
  setSidePane: (open: boolean) => void;
  setDayWidth: (px: number) => void;
  setOrderWidth: (px: number) => void;
  toggleDateCol: (key: DateCol) => void;
  askOvertime: (request: OvertimeRequest) => void;
  clearOvertime: () => void;
  setLastRefresh: (when: Date) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedJobId: null,
  sidePaneOpen: true,
  overtimeRequest: null,
  lastRefresh: null,
  dayWidth: DEFAULT_DAY_WIDTH,
  orderWidth: DEFAULT_ORDER_WIDTH,
  dateCols: { start: true, due: true, expect: true, ship: true },

  // Picking an order is a request to see it, so it re-opens a closed pane.
  select: (selectedJobId) =>
    set(selectedJobId ? { selectedJobId, sidePaneOpen: true } : { selectedJobId }),
  setSidePane: (sidePaneOpen) => set({ sidePaneOpen }),
  setDayWidth: (px) =>
    set({ dayWidth: clamp(px, MIN_DAY_WIDTH, MAX_DAY_WIDTH) }),
  setOrderWidth: (px) =>
    set({ orderWidth: clamp(px, MIN_ORDER_WIDTH, MAX_ORDER_WIDTH) }),
  toggleDateCol: (key) =>
    set((state) => ({
      dateCols: { ...state.dateCols, [key]: !state.dateCols[key] },
    })),
  askOvertime: (overtimeRequest) => set({ overtimeRequest }),
  clearOvertime: () => set({ overtimeRequest: null }),
  setLastRefresh: (lastRefresh) => set({ lastRefresh }),
}));
