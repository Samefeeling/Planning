/**
 * Hourly + on-demand refresh of the source data. The task schedule that feeds
 * the workbook updates hourly, so the board re-pulls on the same cadence; the
 * returned function lets the planner refresh immediately.
 */

import { useCallback, useEffect } from 'react';
import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';

export function useScheduledRefresh(intervalMinutes?: number): () => Promise<void> {
  const load = useDataStore((s) => s.load);
  const setLastRefresh = useUiStore((s) => s.setLastRefresh);

  const minutes =
    intervalMinutes ??
    Number(import.meta.env.VITE_REFRESH_INTERVAL_MINUTES ?? 60);

  const refresh = useCallback(async () => {
    await load();
    setLastRefresh(new Date());
  }, [load, setLastRefresh]);

  useEffect(() => {
    const ms = Math.max(1, minutes) * 60_000;
    const id = window.setInterval(refresh, ms);
    return () => window.clearInterval(id);
  }, [refresh, minutes]);

  return refresh;
}
