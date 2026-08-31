/**
 * Load `Planning1.csv` from disk.
 *
 * The scheduled path is SharePoint → Graph, but that needs a token the planner
 * does not have in a browser tab. Picking the file by hand runs exactly the
 * same parser, so the export can be checked against the board before any auth
 * is wired up.
 */

import { useRef, useState } from 'react';
import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';
import { setManualCsv } from '@/data/csv/csv.client';
import { PlanningCsvSource } from '@/data/csv/PlanningCsvSource';
import { Button } from '@/ui';

export function CsvLoader() {
  const setSource = useDataStore((s) => s.setSource);
  const load = useDataStore((s) => s.load);
  const setLastRefresh = useUiStore((s) => s.setLastRefresh);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setManualCsv(await file.text());
      setSource(new PlanningCsvSource());
      await load();
      setLastRefresh(new Date());
    } finally {
      setBusy(false);
      if (input.current) input.current.value = ''; // allow re-picking the same file
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <Button
        onClick={() => input.current?.click()}
        disabled={busy}
        title="Parse a Planning1.csv export and rebuild the board from it"
      >
        Load CSV
      </Button>
    </>
  );
}
