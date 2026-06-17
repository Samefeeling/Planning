/**
 * Composition root for the data layer: pick a source from configuration.
 *   VITE_DATA_SOURCE = "mock" (default) | "excel"
 *
 * The live Excel source (and its heavy SheetJS dependency) is loaded lazily, so
 * the default mock build doesn't ship the parser.
 */

import type {
  BomLine,
  DemandLine,
  InventoryItem,
  Job,
  Machine,
  PoLine,
  RoutingEntry,
} from '@/domain/types';
import { BaseDataSource, type DataSource } from './DataSource';
import { MockSource } from './mock/MockSource';

export type DataSourceKind = 'mock' | 'excel';

/**
 * Defers loading `SharePointExcelSource` (and `xlsx`) until the first fetch,
 * keeping them out of the main bundle when the mock source is used.
 */
class LazyExcelSource extends BaseDataSource {
  readonly name = 'sharepoint-excel';
  private impl: Promise<DataSource> | null = null;

  private get source(): Promise<DataSource> {
    return (this.impl ??= import('./excel/SharePointExcelSource').then(
      (m) => new m.SharePointExcelSource(),
    ));
  }

  async fetchMachines(): Promise<Machine[]> {
    return (await this.source).fetchMachines();
  }
  async fetchJobs(): Promise<Job[]> {
    return (await this.source).fetchJobs();
  }
  async fetchRouting(): Promise<RoutingEntry[]> {
    return (await this.source).fetchRouting();
  }
  async fetchInventory(): Promise<InventoryItem[]> {
    return (await this.source).fetchInventory();
  }
  async fetchBom(): Promise<BomLine[]> {
    return (await this.source).fetchBom();
  }
  async fetchPo(): Promise<PoLine[]> {
    return (await this.source).fetchPo();
  }
  async fetchDemand(): Promise<DemandLine[]> {
    return (await this.source).fetchDemand();
  }
}

export function createDataSource(
  kind: DataSourceKind = (import.meta.env.VITE_DATA_SOURCE as DataSourceKind) ??
    'mock',
): DataSource {
  switch (kind) {
    case 'excel':
      return new LazyExcelSource();
    case 'mock':
    default:
      return new MockSource();
  }
}

export type { DataSource } from './DataSource';
