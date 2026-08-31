/**
 * Holds the loaded source data and its derived look-up indexes. The data
 * source is swappable (mock ↔ live Excel) via `setSource`.
 */

import { create } from 'zustand';
import type { PlanningDataset } from '@/domain/types';
import { createDataSource, type DataSource } from '@/data';
import { buildIndexes, type DataIndexes } from '@/engine/indexes';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface DataState {
  status: LoadStatus;
  dataset: PlanningDataset | null;
  indexes: DataIndexes | null;
  error: string | null;
  source: DataSource;

  /** Fetch everything from the current source and rebuild indexes. */
  load: () => Promise<void>;
  /** Swap the active data source (does not auto-load). */
  setSource: (source: DataSource) => void;
}

export const useDataStore = create<DataState>((set, get) => ({
  status: 'idle',
  dataset: null,
  indexes: null,
  error: null,
  source: createDataSource(),

  async load() {
    set({ status: 'loading', error: null });
    const result = await get().source.loadAll();
    if (result.ok) {
      set({
        status: 'ready',
        dataset: result.value,
        indexes: buildIndexes(result.value),
        error: null,
      });
    } else {
      set({ status: 'error', error: result.error });
    }
  },

  setSource(source) {
    set({ source });
  },
}));
