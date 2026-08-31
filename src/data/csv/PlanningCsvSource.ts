/**
 * The live source: orders from `Planning1.csv`, people from the SharePoint list
 * `ASSY_Operator`.
 *
 * The CSV carries both PMD and assembly rows, so one fetch feeds the whole
 * board — the PMD lane mirrors moulding's plan and the three assembly lines are
 * scheduled here.
 *
 * What the export does *not* carry: inventory, BOM, POs and demand. Those come
 * from the master workbook, so the material engine sees nothing here and every
 * order reads as material-OK. Point `VITE_DATA_SOURCE=excel` at the workbook
 * when the shortage view matters, or add the tables to this source once the
 * PMD dashboard and this page are merged.
 */

import type {
  BomLine,
  DemandLine,
  InventoryItem,
  Job,
  PoLine,
  RoutingEntry,
  WorkCenter,
} from '@/domain/types';
import type { Worker } from '@/domain/assembly';
import {
  assemblyWorkCenters,
  makeMachine,
} from '@/data/excel/parsers/machine.parser';
import { BaseDataSource } from '@/data/DataSource';
import {
  readConfigFromEnv,
  type SharePointConfig,
} from '@/data/excel/sharepoint.client';
import { fetchListItems } from '@/data/sharepoint/lists.client';
import { parseOperators } from '@/data/sharepoint/operator.parser';
import {
  fetchPlanningCsv,
  readCsvConfigFromEnv,
  type CsvSourceConfig,
} from './csv.client';
import { parsePlanningCsv } from './planning.parser';

/** Display name of the roster list in SharePoint. */
export const OPERATOR_LIST = 'ASSY_Operator';

export class PlanningCsvSource extends BaseDataSource {
  readonly name = 'planning-csv';

  /** Parse warnings from the last load, surfaced for diagnostics. */
  readonly warnings: string[] = [];

  private jobsOnce: Promise<Job[]> | null = null;

  constructor(
    private readonly csv: CsvSourceConfig = readCsvConfigFromEnv(),
    private readonly sp: SharePointConfig = readConfigFromEnv(),
  ) {
    super();
  }

  /**
   * One fetch per load. `loadAll` calls the `fetch*` methods in parallel and
   * two of them need the CSV, so the promise is memoised.
   */
  private get orders(): Promise<Job[]> {
    return (this.jobsOnce ??= fetchPlanningCsv(this.csv, this.sp).then((res) => {
      if (!res.ok) throw new Error(res.error);
      const { values, errors } = parsePlanningCsv(res.value);
      this.warnings.push(...errors);
      if (values.length === 0) {
        throw new Error(errors[0] ?? 'Planning1.csv held no orders');
      }
      return values;
    }));
  }

  /** Drop the memoised CSV so the next load re-fetches. */
  invalidate(): void {
    this.jobsOnce = null;
    this.warnings.length = 0;
  }

  /**
   * The hourly refresh must actually see new rows, so each full load starts
   * from a fresh fetch — the memo only spans the one `loadAll`.
   */
  override async loadAll(): ReturnType<BaseDataSource['loadAll']> {
    this.invalidate();
    return super.loadAll();
  }

  async fetchJobs(): Promise<Job[]> {
    return this.orders;
  }

  /**
   * The four lanes, plus any moulding press the CSV actually names. The presses
   * are not lanes on this board, but having them as work centres keeps their
   * orders filed by machine instead of piling into the un-scheduled pool.
   */
  async fetchWorkCenters(): Promise<WorkCenter[]> {
    const presses = new Map<string, WorkCenter>();
    for (const job of await this.orders) {
      const id = job.preferredMachine;
      if (!id || presses.has(String(id))) continue;
      presses.set(String(id), makeMachine(String(id)));
    }
    return [
      ...[...presses.values()].sort((a, b) => a.sortIndex - b.sortIndex),
      ...assemblyWorkCenters(),
    ];
  }

  async fetchWorkers(): Promise<Worker[]> {
    const res = await fetchListItems(this.sp, OPERATOR_LIST);
    if (!res.ok) {
      // A roster outage must not blank the board; the orders still schedule,
      // they just show "no crew" until the list comes back.
      this.warnings.push(res.error);
      return [];
    }
    const { values, errors } = parseOperators(res.value);
    this.warnings.push(...errors);
    return values;
  }

  // Not in this export — see the note at the top of the file.
  async fetchRouting(): Promise<RoutingEntry[]> {
    return [];
  }
  async fetchInventory(): Promise<InventoryItem[]> {
    return [];
  }
  async fetchBom(): Promise<BomLine[]> {
    return [];
  }
  async fetchPo(): Promise<PoLine[]> {
    return [];
  }
  async fetchDemand(): Promise<DemandLine[]> {
    return [];
  }
}
