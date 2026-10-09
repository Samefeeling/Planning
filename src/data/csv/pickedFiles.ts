/**
 * Epicor exports picked from disk with **Load files**, and kept.
 *
 * Four files, told apart by their header row rather than their name, because
 * an export saved from Excel rarely keeps the name the BAQ gave it:
 *
 * - `Planning1.csv` — the orders (`JobHead_JobNum`);
 * - `JobMaterialReq.csv` — what each order consumes (`JobMtl_JobNum`);
 * - `OnHandInventory.csv` — on hand by part (`Part_PartNum`, `Calculated_OnHand`);
 * - `PODetail.csv` — open purchase orders (`PODetail_PONUM`, `PODetail_PartNum`).
 *
 * Picked files win over the configured URLs and SharePoint paths until they
 * are cleared, and are kept in this browser (IndexedDB — the exports can be
 * larger than localStorage holds), so a reload or the next morning finds the
 * same board instead of the demo data.
 */

import { normalizeHeader, parseCsv } from '@/lib/csv';
import {
  clearManualFiles,
  getManualCsv,
  setManualCsv,
  setManualJobMaterialCsv,
  setManualOnHandInventoryCsv,
  setManualPoDetailCsv,
} from './csv.client';
import { isPoDetailHeader } from './poDetail.parser';

export type ExportKind = 'orders' | 'links' | 'inventory' | 'po';

export const EXPORT_FILE: Record<ExportKind, string> = {
  orders: 'Planning1',
  links: 'JobMaterialReq',
  inventory: 'OnHandInventory',
  po: 'PODetail',
};

export interface PickedFile {
  kind: ExportKind;
  /** The file's name on disk. */
  name: string;
  /** When it was picked, ISO. */
  loadedAt: string;
  text: string;
}

/** Which export a file is, from its header row; null when it is none of them. */
export function exportKind(text: string): ExportKind | null {
  const header = parseCsv(text.slice(0, 8192))[0] ?? [];
  const names = new Set(header.map(normalizeHeader));
  if (names.has('partnum') && names.has('onhand')) return 'inventory';
  if (isPoDetailHeader(header)) return 'po';
  if (
    names.has('jobmtljobnum') ||
    names.has('jobmtlpartnum') ||
    (names.has('mtlpartnum') && names.has('jobnum'))
  ) {
    return 'links';
  }
  if (names.has('jobnum')) return 'orders';
  return null;
}

/** Hand a picked file to the CSV source, which reads it before any configured path. */
export function applyPicked(file: Pick<PickedFile, 'kind' | 'text'>): void {
  switch (file.kind) {
    case 'orders':
      return setManualCsv(file.text);
    case 'links':
      return setManualJobMaterialCsv(file.text);
    case 'inventory':
      return setManualOnHandInventoryCsv(file.text);
    case 'po':
      return setManualPoDetailCsv(file.text);
  }
}

/** Is a `Planning1.csv` loaded by hand — the one file the board cannot do without? */
export const hasPickedOrders = (): boolean => getManualCsv() !== null;

// ---- kept in this browser --------------------------------------------------

const DB = 'resero.files';
const STORE = 'exports';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'kind' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = work(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        } finally {
          db.close();
        }
      }),
  );
}

/** Keep a picked file, replacing the last one of its kind. Best effort. */
export async function keepPicked(file: PickedFile): Promise<void> {
  await run('readwrite', (s) => s.put(file));
}

/** What is kept, newest-picked kind first. Empty when storage is unavailable. */
export async function readPicked(): Promise<PickedFile[]> {
  const all = (await run<PickedFile[]>('readonly', (s) => s.getAll())) ?? [];
  return all.filter((f) => f && typeof f.text === 'string' && f.kind in EXPORT_FILE);
}

/** Forget every picked file, here and in the CSV source. */
export async function clearPicked(): Promise<void> {
  clearManualFiles();
  await run('readwrite', (s) => s.clear());
}

/**
 * Put the kept files back before the first load, so the board opens on them.
 * Returns what was restored.
 */
export async function restorePicked(): Promise<PickedFile[]> {
  const files = await readPicked();
  for (const f of files) applyPicked(f);
  return files;
}
