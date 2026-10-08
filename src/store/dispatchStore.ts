/**
 * Dispatch planning state: the loaded waybill, the planner's decisions over
 * it, and the logistics settings the plan is built with.
 *
 * Kept in browser storage, separately from the assembly plan, so the
 * dispatch office can work from its own export without touching the board.
 * The plan itself is never stored: it is rebuilt from these on every change.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_DISPATCH_SETTINGS,
  EMPTY_DECISIONS,
  type DayKey,
  type DispatchDecisions,
  type DispatchSettings,
  type Equipment,
} from '@/domain/dispatch';
import type { PlannedLoad } from '@/engine/dispatch/plan';
import { confirm, moveOrder, redateLoad, resizeLoad } from '@/engine/dispatch/edits';
import { addCalendarDays } from '@/engine/dispatch/calendar';
import { toDayKey } from '@/lib/time';

/** Dispatched loads are kept this long for reference, then dropped. */
const DISPATCHED_RETENTION_DAYS = 14;

interface DispatchState {
  csvText: string | null;
  fileName: string | null;
  loadedAt: string | null;
  /** The cubics sheet (product cube master), as loaded. */
  cubicsText: string | null;
  cubicsFileName: string | null;
  cubicsLoadedAt: string | null;
  settings: DispatchSettings;
  decisions: DispatchDecisions;

  loadWaybill: (text: string, fileName: string) => void;
  clearWaybill: () => void;
  loadCubics: (text: string, fileName: string) => void;
  clearCubics: () => void;
  pin: (orderId: string, day: DayKey | null) => void;
  hold: (orderId: string, reason: string | null) => void;
  setVolume: (orderId: string, m3: number | null) => void;
  /** Book a proposed or edited load. */
  confirmLoad: (load: PlannedLoad) => void;
  /**
   * Move an order to another load, onto a new one when `to` is null, or off
   * this one for the optimiser to place with `replan`.
   */
  moveOrder: (orderId: string, from: PlannedLoad, to: PlannedLoad | null | 'replan') => void;
  resizeLoad: (load: PlannedLoad, equipment: string, capacityM3: number | null) => void;
  redateLoad: (load: PlannedLoad, day: DayKey) => void;
  markDispatched: (loadId: string) => void;
  /** Hand a frozen load's orders back to the optimiser. */
  releaseLoad: (loadId: string) => void;
  updateSettings: (change: (current: DispatchSettings) => DispatchSettings) => void;
  resetSettings: () => void;
}

/** Saved equipment from before notes existed picks up the default note by id. */
const withNotes = (saved: Equipment[] | undefined, defaults: Equipment[]): Equipment[] =>
  (saved ?? defaults).map((e) => ({
    ...e,
    note: e.note ?? defaults.find((d) => d.id === e.id)?.note,
  }));

const without = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record };
  delete next[key];
  return next;
};

export const useDispatchStore = create<DispatchState>()(
  persist(
    (set) => ({
      csvText: null,
      fileName: null,
      loadedAt: null,
      cubicsText: null,
      cubicsFileName: null,
      cubicsLoadedAt: null,
      settings: DEFAULT_DISPATCH_SETTINGS,
      decisions: EMPTY_DECISIONS,

      loadWaybill: (csvText, fileName) =>
        set((s) => {
          const cutoff = addCalendarDays(toDayKey(new Date()), -DISPATCHED_RETENTION_DAYS);
          return {
            csvText,
            fileName,
            loadedAt: new Date().toISOString(),
            decisions: {
              ...s.decisions,
              firmLoads: s.decisions.firmLoads.filter(
                (l) => l.status !== 'dispatched' || l.day >= cutoff,
              ),
            },
          };
        }),
      clearWaybill: () => set({ csvText: null, fileName: null, loadedAt: null }),
      loadCubics: (cubicsText, cubicsFileName) =>
        set({ cubicsText, cubicsFileName, cubicsLoadedAt: new Date().toISOString() }),
      clearCubics: () => set({ cubicsText: null, cubicsFileName: null, cubicsLoadedAt: null }),

      pin: (orderId, day) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            pins: day ? { ...s.decisions.pins, [orderId]: day } : without(s.decisions.pins, orderId),
          },
        })),
      hold: (orderId, reason) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            holds:
              reason === null
                ? without(s.decisions.holds, orderId)
                : { ...s.decisions.holds, [orderId]: reason },
          },
        })),
      setVolume: (orderId, m3) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            volumeOverrides:
              m3 === null || !Number.isFinite(m3) || m3 < 0
                ? without(s.decisions.volumeOverrides, orderId)
                : { ...s.decisions.volumeOverrides, [orderId]: m3 },
          },
        })),

      confirmLoad: (load) =>
        set((s) => ({
          decisions: { ...s.decisions, firmLoads: confirm(s.decisions.firmLoads, load, new Date().toISOString()) },
        })),
      moveOrder: (orderId, from, to) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            firmLoads: moveOrder(s.decisions.firmLoads, s.settings, orderId, from, to, new Date().toISOString()),
          },
        })),
      resizeLoad: (load, equipment, capacityM3) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            firmLoads: resizeLoad(s.decisions.firmLoads, load, equipment, capacityM3, new Date().toISOString()),
          },
        })),
      redateLoad: (load, day) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            firmLoads: redateLoad(s.decisions.firmLoads, load, day, new Date().toISOString()),
          },
        })),
      markDispatched: (loadId) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            firmLoads: s.decisions.firmLoads.map((l) =>
              l.id === loadId
                ? { ...l, status: 'dispatched' as const, dispatchedAt: new Date().toISOString() }
                : l,
            ),
          },
        })),
      releaseLoad: (loadId) =>
        set((s) => ({
          decisions: {
            ...s.decisions,
            firmLoads: s.decisions.firmLoads.filter((l) => l.id !== loadId),
          },
        })),

      updateSettings: (change) => set((s) => ({ settings: change(s.settings) })),
      resetSettings: () => set({ settings: DEFAULT_DISPATCH_SETTINGS }),
    }),
    {
      name: 'resero.dispatch.v1',
      // Settings added in a later release fall back to their defaults rather
      // than arriving as undefined from an older saved copy.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DispatchState>;
        const ps = p.settings;
        return {
          ...current,
          ...p,
          settings: ps
            ? {
                ...DEFAULT_DISPATCH_SETTINGS,
                ...ps,
                fleet: {
                  ...DEFAULT_DISPATCH_SETTINGS.fleet,
                  ...ps.fleet,
                  trucks: withNotes(ps.fleet?.trucks, DEFAULT_DISPATCH_SETTINGS.fleet.trucks),
                },
                linehaul: { ...DEFAULT_DISPATCH_SETTINGS.linehaul, ...ps.linehaul },
                container: {
                  ...DEFAULT_DISPATCH_SETTINGS.container,
                  ...ps.container,
                  containers: withNotes(ps.container?.containers, DEFAULT_DISPATCH_SETTINGS.container.containers),
                },
              }
            : current.settings,
          decisions: { ...EMPTY_DECISIONS, ...p.decisions },
        };
      },
    },
  ),
);
