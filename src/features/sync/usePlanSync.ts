/**
 * Keeps the `ASSY_Plan` SharePoint list in step with the board.
 *
 * It runs on two triggers, because two different things change:
 *
 *  - the board itself — crew allocated, a bar dragged to a new start day. That
 *    is the planner typing, so it is debounced; nobody wants a Graph round trip
 *    per keystroke of a drag.
 *  - a fresh `Planning1.csv`, every five minutes. That is where DueDate and
 *    RemainingQty come back into the list.
 *
 * Both funnel into the same diffing sync, so the second trigger is cheap when
 * nothing actually moved.
 *
 * Writing is **opt-in**: nothing leaves the browser unless `VITE_PLAN_LIST`
 * names a list and Graph is configured. The mock demo never writes.
 */

import { useEffect, useRef, useState } from 'react';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import { readConfigFromEnv } from '@/data/excel/sharepoint.client';
import {
  planRowsFromBoard,
  syncPlanRows,
  type SyncOutcome,
} from '@/data/sharepoint/plan.sync';

/** Wait this long after the last board change before writing. */
const DEBOUNCE_MS = 1200;

export interface PlanSyncState {
  /** False when `VITE_PLAN_LIST` is unset — the board is read-only then. */
  enabled: boolean;
  list: string;
  busy: boolean;
  lastSyncedAt: Date | null;
  last: SyncOutcome | null;
  /** Errors from the most recent attempt, for the banner. */
  errors: string[];
}

export function usePlanSync(board: AssemblyGanttView | null): PlanSyncState {
  const list = (import.meta.env.VITE_PLAN_LIST ?? '').trim();
  const cfg = readConfigFromEnv();
  const enabled = Boolean(list && cfg.siteUrl && cfg.token);

  const [state, setState] = useState<Omit<PlanSyncState, 'enabled' | 'list'>>({
    busy: false,
    lastSyncedAt: null,
    last: null,
    errors: [],
  });

  const timer = useRef<number | undefined>(undefined);
  /** Guards against a second sync starting while one is still in flight. */
  const running = useRef(false);
  /** Set when a change arrives mid-flight, so nothing is silently dropped. */
  const stale = useRef(false);

  // The plan the list should hold, serialised. The string is the effect's
  // dependency, so a re-render that changes nothing costs no Graph call; the
  // effect parses it back rather than closing over the array, which keeps the
  // written rows and the fingerprint that triggered them in step.
  const fingerprint = board ? JSON.stringify(planRowsFromBoard(board)) : '';

  useEffect(() => {
    if (!enabled || !fingerprint) return;

    const run = async () => {
      if (running.current) {
        stale.current = true;
        return;
      }
      running.current = true;
      setState((s) => ({ ...s, busy: true }));

      const outcome = await syncPlanRows(cfg, list, JSON.parse(fingerprint));

      running.current = false;
      setState({
        busy: false,
        lastSyncedAt: new Date(),
        last: outcome,
        errors: outcome.errors,
      });

      if (stale.current) {
        stale.current = false;
        void run();
      }
    };

    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(), DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
    // `cfg` is read from import.meta.env and is stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, list, fingerprint]);

  return { enabled, list, ...state };
}
