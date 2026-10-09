/**
 * **Load files** — the Epicor exports from disk, all four in one pick.
 *
 * The scheduled path is SharePoint, but that needs a signed-in site the
 * planner does not always have; picking the files runs exactly the same
 * parsers. Each file is recognised by its header row (see `pickedFiles`), so
 * the four can be picked together in any order and under any name, and one
 * that is none of them says so instead of loading as something it is not.
 *
 * The board needs `Planning1.csv`; the other three add to it — the material
 * chain, on-hand quantities and the open POs on each order's pick list. Until
 * a `Planning1.csv` is in, the board keeps whatever it was showing. Picked
 * files are kept in this browser until **Clear**.
 */

import { useEffect, useRef, useState } from 'react';
import { createDataSource } from '@/data';
import { PlanningCsvSource } from '@/data/csv/PlanningCsvSource';
import {
  EXPORT_FILE,
  applyPicked,
  clearPicked,
  exportKind,
  hasPickedOrders,
  keepPicked,
  readPicked,
  restorePicked,
  type ExportKind,
  type PickedFile,
} from '@/data/csv/pickedFiles';
import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/ui';

const ORDER: ExportKind[] = ['orders', 'links', 'inventory', 'po'];

type Loaded = Partial<Record<ExportKind, Pick<PickedFile, 'name' | 'loadedAt'>>>;

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Put kept files back before the board's first load, and read from them when
 * a `Planning1.csv` is among them.
 */
export async function restorePickedFiles(): Promise<void> {
  const files = await restorePicked();
  if (files.some((f) => f.kind === 'orders')) useDataStore.getState().setSource(new PlanningCsvSource());
}

export function CsvLoader() {
  const setSource = useDataStore((s) => s.setSource);
  const load = useDataStore((s) => s.load);
  const sourceName = useDataStore((s) => s.source.name);
  const setLastRefresh = useUiStore((s) => s.setLastRefresh);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({});
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readPicked().then((files) => {
      if (!live) return;
      const next: Loaded = {};
      for (const f of files) next[f.kind] = { name: f.name, loadedAt: f.loadedAt };
      setLoaded(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const reload = async () => {
    await load();
    setLastRefresh(new Date());
  };

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const next: Loaded = { ...loaded };
      const unknown: string[] = [];
      for (const file of Array.from(files)) {
        const text = await file.text();
        const kind = exportKind(text);
        if (!kind) {
          unknown.push(file.name);
          continue;
        }
        const picked: PickedFile = { kind, name: file.name, loadedAt: new Date().toISOString(), text };
        applyPicked(picked);
        await keepPicked(picked);
        next[kind] = { name: picked.name, loadedAt: picked.loadedAt };
      }
      setLoaded(next);
      const notes: string[] = [];
      if (unknown.length > 0) {
        notes.push(
          `${unknown.join(', ')}: not one of Planning1, JobMaterialReq, OnHandInventory or PODetail ` +
            '(by its header row) — not loaded.',
        );
      }
      if (hasPickedOrders()) {
        if (sourceName !== 'planning-csv') setSource(new PlanningCsvSource());
        await reload();
      } else if (sourceName === 'planning-csv') {
        await reload();
      } else if (Object.keys(next).length > 0) {
        notes.push('Add Planning1.csv as well: the board shows its current orders until then.');
      }
      setNote(notes.length > 0 ? notes.join(' ') : null);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await clearPicked();
      setLoaded({});
      setNote(null);
      setSource(createDataSource());
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const kinds = ORDER.filter((k) => loaded[k]);

  return (
    <span className="file-loader">
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
        title="Pick Planning1, JobMaterialReq, OnHandInventory and PODetail (.csv) — together or one at a time"
      >
        {busy ? 'Loading…' : 'Load files'}
      </Button>
      {kinds.length > 0 && (
        <span
          className="file-loader-set"
          title={kinds.map((k) => `${EXPORT_FILE[k]}: ${loaded[k]!.name}, picked ${stamp(loaded[k]!.loadedAt)}`).join('\n')}
        >
          {ORDER.map((k) => (
            <span key={k} className={`file-chip${loaded[k] ? ' on' : ''}`}>
              {EXPORT_FILE[k]}
            </span>
          ))}
          <button type="button" className="file-clear" onClick={() => void clear()} disabled={busy} title="Forget the picked files">
            Clear
          </button>
        </span>
      )}
      {note && (
        <span className="board-warn" title={note}>
          {note}
        </span>
      )}
    </span>
  );
}
