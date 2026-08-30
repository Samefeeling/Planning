/**
 * Local development / demo source. Reads a snapshot (`seed.json`) extracted
 * from the real PMD master workbook and maps it onto the domain model, so the
 * board is fully populated with no network or credentials.
 */

import { JobId, MachineId, PartId, ToolId, ColorId, InsertId } from '@/domain/ids';
import type {
  BomLine,
  Department,
  DemandLine,
  InventoryItem,
  Job,
  PoLine,
  RoutingEntry,
  WorkCenter,
} from '@/domain/types';
import type { MaterialPrepStatus, ProductType, StageId } from '@/domain/assembly';
import {
  assemblyWorkCenters,
  makeMachine,
} from '@/data/excel/parsers/machine.parser';
import { isVisibleMachine } from '@/domain/constants';
import { BaseDataSource } from '@/data/DataSource';
import seed from './seed.json';

const toDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

// Simulate a touch of network latency so loading states are exercised.
const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

export class MockSource extends BaseDataSource {
  readonly name = 'mock';

  async fetchWorkCenters(): Promise<WorkCenter[]> {
    const machines = seed.machines
      .map(makeMachine)
      .filter((m) => isVisibleMachine(m.id))
      .sort((a, b) => a.sortIndex - b.sortIndex);
    return delay([...machines, ...assemblyWorkCenters()]);
  }

  async fetchJobs(): Promise<Job[]> {
    const jobs: Job[] = seed.jobs.map((j) => ({
      id: JobId(j.jobNum),
      department: (j.department ?? 'moulding') as Department,
      partNum: PartId(j.partNum),
      description: j.description ?? '',
      remainingQty: j.remainingQty ?? 0,
      qtyPerHr: j.qtyPerHr ?? null,
      laborHrs:
        j.laborHrs ??
        (j.qtyPerHr && j.qtyPerHr > 0
          ? (j.remainingQty ?? 0) / j.qtyPerHr
          : 0),
      dueDate: toDate(j.dueDate),
      reqBy: toDate(j.reqBy),
      released: Boolean(j.released),
      priority: j.priority ?? 3,
      materialPrep: (j.materialPrep ?? 'ready') as MaterialPrepStatus,
      tool: j.die ? ToolId(j.die) : null,
      preferredMachine: j.machine ? MachineId(j.machine) : null,
      productType: (j.productType ?? null) as ProductType | null,
      currentStage: (j.currentStage ?? null) as StageId | null,
    }));
    return delay(jobs);
  }

  async fetchRouting(): Promise<RoutingEntry[]> {
    const routing: RoutingEntry[] = seed.routing.map((r) => ({
      partNum: PartId(r.partNum),
      machine: MachineId(r.machine),
      tool: r.die ? ToolId(r.die) : null,
      color: r.color ? ColorId(r.color) : null,
      insert: r.insert ? InsertId(r.insert) : null,
      description: r.description ?? '',
    }));
    return delay(routing);
  }

  async fetchInventory(): Promise<InventoryItem[]> {
    const inv: InventoryItem[] = seed.inventory.map((i) => ({
      partNum: PartId(i.partNum),
      description: i.description ?? '',
      typeCode: i.typeCode ?? null,
      onHand: i.onHand ?? 0,
      cmplWip: i.cmplWip ?? 0,
      supply: i.supply ?? 0,
      demand: i.demand ?? 0,
      freeOnHand: i.freeOnHand ?? 0,
    }));
    return delay(inv);
  }

  async fetchBom(): Promise<BomLine[]> {
    const bom: BomLine[] = seed.bom.map((b) => ({
      finishedPart: PartId(b.finishedPart),
      jobNum: b.jobNum ? JobId(b.jobNum) : null,
      componentPart: PartId(b.componentPart),
      requiredQty: b.requiredQty ?? 0,
      uom: b.uom ?? 'EA',
      dueDate: toDate(b.dueDate),
      outstandingQty: b.outstandingQty ?? 0,
    }));
    return delay(bom);
  }

  async fetchPo(): Promise<PoLine[]> {
    const po: PoLine[] = seed.po.map((p) => ({
      partNum: PartId(p.partNum),
      poNum: p.poNum ?? null,
      outstandingQty: p.outstandingQty ?? 0,
      dueDate: toDate(p.dueDate),
      promiseDate: toDate(p.promiseDate),
      buyer: p.buyer ?? null,
    }));
    return delay(po);
  }

  async fetchDemand(): Promise<DemandLine[]> {
    const demand: DemandLine[] = seed.demand.map((d) => ({
      partNum: PartId(d.partNum),
      reqDate: toDate(d.reqDate),
      reqQty: d.reqQty ?? 0,
    }));
    return delay(demand);
  }
}
