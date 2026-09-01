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

/** Column headings, shared by the board and the chip that brings one back. */
export const DATE_COL_LABEL: Record<DateCol, string> = {
  start: 'Start Date',
  due: 'Due Date',
  expect: 'Expect Date',
  ship: 'Ship Date',
};

/** Where on screen an order was clicked, so its detail opens beside it. */
export interface ClickPoint {
  x: number;
  y: number;
}

interface UiState {
  /** Order shown in the inspector. */
  selectedJobId: string | null;
  /**
   * Where the pointer was when it was picked. The detail opens there rather
   * than in a fixed column: the supervisor is already looking at that row, and
   * the schedule keeps the whole width.
   */
  selectedAt: ClickPoint | null;
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

  /** Show an order's detail; `at` moves the panel, omitting it leaves it. */
  select: (jobId: string | null, at?: ClickPoint) => void;
  setDayWidth: (px: number) => void;
  setOrderWidth: (px: number) => void;
  toggleDateCol: (key: DateCol) => void;
  askOvertime: (request: OvertimeRequest) => void;
  clearOvertime: () => void;
  setLastRefresh: (when: Date) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedJobId: null,
  selectedAt: null,
  overtimeRequest: null,
  lastRefresh: null,
  dayWidth: DEFAULT_DAY_WIDTH,
  orderWidth: DEFAULT_ORDER_WIDTH,
  dateCols: { start: true, due: true, expect: true, ship: true },

  // A follow-on pick — a predecessor in the detail itself — comes with no
  // point, and leaves the panel where the reader is already looking.
  select: (selectedJobId, at) =>
    set((state) => ({ selectedJobId, selectedAt: at ?? state.selectedAt })),
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
