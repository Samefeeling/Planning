/**
 * Load the Epicor exports from disk.
 *
 * The scheduled path is SharePoint → Graph, but that needs a token the planner
 * does not have in a browser tab. Picking the files by hand runs exactly the
 * same parsers, so an export can be checked against the board before any auth
 * is wired up.
 *
 * Both files can be selected at once. Which is which is decided by the header
 * row rather than the file name, because an export saved from Excel rarely
 * keeps the name the BAQ gave it.
 */

import { useRef, useState } from 'react';
import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';
import {
  setManualCsv,
  setManualJobMaterialCsv,
} from '@/data/csv/csv.client';
import { PlanningCsvSource } from '@/data/csv/PlanningCsvSource';
import { normalizeHeader, parseCsv } from '@/lib/csv';
import { Button } from '@/ui';

/**
 * A material-link export names the job on the `JobMtl` table; the order export
 * never does. That one header is enough to tell them apart.
 */
function isMaterialExport(text: string): boolean {
  const header = parseCsv(text.slice(0, 4096))[0] ?? [];
  const names = new Set(header.map(normalizeHeader));
  return (
    names.has('jobmtljobnum') ||
    names.has('jobmtlpartnum') ||
    (names.has('mtlpartnum') && names.has('jobnum'))
  );
}

export function CsvLoader() {
  const setSource = useDataStore((s) => s.setSource);
  const load = useDataStore((s) => s.load);
  const setLastRefresh = useUiStore((s) => s.setLastRefresh);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        if (isMaterialExport(text)) setManualJobMaterialCsv(text);
        else setManualCsv(text);
      }
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
        multiple
        hidden
        onChange={(e) => void onPick(e.target.files)}
      />
      <Button
        onClick={() => input.current?.click()}
        disabled={busy}
        title="Parse Planning1.csv (and JobMaterialReq.csv) and rebuild the board"
      >
        Load CSV
      </Button>
    </>
  );
}
