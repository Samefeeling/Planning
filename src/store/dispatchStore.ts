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
  type FirmLoad,
} from '@/domain/dispatch';
import type { PlannedLoad } from '@/engine/dispatch/plan';
import { addCalendarDays } from '@/engine/dispatch/calendar';
import { toDayKey } from '@/lib/time';

/** Dispatched loads are kept this long for reference, then dropped. */
const DISPATCHED_RETENTION_DAYS = 14;

interface DispatchState {
  csvText: string | null;
  fileName: string | null;
  loadedAt: string | null;
  settings: DispatchSettings;
  decisions: DispatchDecisions;

  loadWaybill: (text: string, fileName: string) => void;
  clearWaybill: () => void;
  pin: (orderId: string, day: DayKey | null) => void;
  hold: (orderId: string, reason: string | null) => void;
  setVolume: (orderId: string, m3: number | null) => void;
  confirmLoad: (load: PlannedLoad) => void;
  markDispatched: (loadId: string) => void;
  releaseLoad: (loadId: string) => void;
  updateSettings: (change: (current: DispatchSettings) => DispatchSettings) => void;
  resetSettings: () => void;
}

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
        set((s) => {
          if (load.firm) return s;
          const orderIds = [...new Set(load.drops.map((d) => d.orderId))];
          const volumes: Record<string, number> = {};
          for (const d of load.drops) volumes[d.orderId] = (volumes[d.orderId] ?? 0) + d.volumeM3;
          const firm: FirmLoad = {
            id: `firm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            group: load.group,
            mode: load.mode,
            label: load.label,
            day: load.day,
            equipment: load.equipment,
            capacityM3: load.capacityM3,
            orderIds,
            volumes,
            status: 'confirmed',
            confirmedAt: new Date().toISOString(),
          };
          return { decisions: { ...s.decisions, firmLoads: [...s.decisions.firmLoads, firm] } };
        }),
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
                fleet: { ...DEFAULT_DISPATCH_SETTINGS.fleet, ...ps.fleet },
                linehaul: { ...DEFAULT_DISPATCH_SETTINGS.linehaul, ...ps.linehaul },
                container: { ...DEFAULT_DISPATCH_SETTINGS.container, ...ps.container },
              }
            : current.settings,
          decisions: { ...EMPTY_DECISIONS, ...p.decisions },
        };
      },
    },
  ),
);
