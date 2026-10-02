/**
 * Load the waybill: from disk, which always works, or from the configured
 * export location when one is set (`VITE_WAYBILL_CSV_URL` / `_PATH`).
 *
 * A file that is not a waybill is refused before it replaces the one loaded,
 * so a wrong pick never empties the plan.
 */

import { useRef, useState } from 'react';
import { fetchWaybillCsv, hasWaybillSource, readCsvConfigFromEnv } from '@/data/csv/csv.client';
import { readConfigFromEnv } from '@/data/excel/sharepoint.client';
import { parseWaybillCsv } from '@/data/csv/waybill.parser';
import { useDispatchStore } from '@/store/dispatchStore';
import { Button } from '@/ui';

export function WaybillLoader() {
  const loadWaybill = useDispatchStore((s) => s.loadWaybill);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const csvCfg = readCsvConfigFromEnv();
  const spCfg = readConfigFromEnv();
  const canRefresh = hasWaybillSource(csvCfg, spCfg);

  const accept = (text: string, name: string) => {
    const result = parseWaybillCsv(text);
    if (result.error) {
      setProblem(`${name}: ${result.error}`);
      return;
    }
    if (result.orders.length === 0) {
      setProblem(`${name}: no order lines`);
      return;
    }
    setProblem(null);
    loadWaybill(text, name);
  };

  const onPick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      accept(await file.text(), file.name);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const onRefresh = async () => {
    setBusy(true);
    try {
      const res = await fetchWaybillCsv(csvCfg, spCfg);
      if (!res.ok) setProblem(res.error);
      else if (res.value) accept(res.value, csvCfg.waybillUrl || csvCfg.waybillFilePath || 'Waybill');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="waybill-loader">
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => input.current?.click()}
        title="Pick the waybill CSV export from disk"
      >
        {busy ? 'Loading…' : 'Load waybill'}
      </Button>
      {canRefresh && (
        <Button disabled={busy} onClick={() => void onRefresh()} title="Fetch the configured waybill export">
          Refresh
        </Button>
      )}
      {problem && <span className="dispatch-problem">{problem}</span>}
    </div>
  );
}
