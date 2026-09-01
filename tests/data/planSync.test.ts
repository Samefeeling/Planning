/**
 * Write-back to the `ASSY_Plan` SharePoint list.
 *
 * The rules that matter here are about what must *not* happen: a drag must
 * never move Epicor's Due Date, a refresh with nothing changed must not write,
 * and a read failure must not half-apply a plan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PLAN_COLUMNS,
  planRowsFromBoard,
  syncPlanRows,
  type PlanRow,
} from '@/data/sharepoint/plan.sync';
import type { SharePointConfig } from '@/data/excel/sharepoint.client';
import { MockSource } from '@/data/mock/MockSource';
import { buildIndexes } from '@/engine/indexes';
import { computeAssemblyGantt } from '@/engine/assembly/board';
import { usePlanStore } from '@/store/planStore';

const CFG: SharePointConfig = {
  siteUrl: 'https://contoso.sharepoint.com/sites/PMD',
  filePath: '',
  token: 'test-token',
};

const row = (over: Partial<PlanRow> = {}): PlanRow => ({
  jobNum: 'ASM8001',
  line: 'UPL',
  operatorIds: ['W02'],
  operatorNames: ['Gate'],
  startDate: '2026-09-14T00:00:00.000Z',
  dueDate: '2026-09-22T00:00:00.000Z',
  expectDate: '2026-09-16T00:00:00.000Z',
  orderQty: 60,
  remainingQty: 60,
  ...over,
});

/** Fields as SharePoint hands them back for `row()`. */
const asStored = (over: Record<string, unknown> = {}) => ({
  id: '1',
  fields: {
    [PLAN_COLUMNS.jobNum]: 'ASM8001',
    [PLAN_COLUMNS.line]: 'UPL',
    [PLAN_COLUMNS.operators]: 'Gate',
    [PLAN_COLUMNS.operatorIds]: 'W02',
    // Graph echoes dates back without the milliseconds we sent.
    [PLAN_COLUMNS.startDate]: '2026-09-14T00:00:00Z',
    [PLAN_COLUMNS.dueDate]: '2026-09-22T00:00:00Z',
    [PLAN_COLUMNS.expectDate]: '2026-09-16T00:00:00Z',
    [PLAN_COLUMNS.orderQty]: 60,
    [PLAN_COLUMNS.remainingQty]: 60,
    ...over,
  },
});

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** Stub Graph: one page of `items`, then record every write. */
function stubGraph(items: ReturnType<typeof asStored>[], readOk = true): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (method === 'GET') {
      return readOk
        ? new Response(JSON.stringify({ value: items }), { status: 200 })
        : new Response('nope', { status: 503, statusText: 'Service Unavailable' });
    }
    return new Response(JSON.stringify({ id: '99' }), { status: 200 });
  });
  return calls;
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');

beforeEach(() => usePlanStore.setState({ initialized: false }));
afterEach(() => vi.unstubAllGlobals());

describe('syncPlanRows', () => {
  it('creates a row for an order the list has never seen', async () => {
    const calls = stubGraph([]);
    const out = await syncPlanRows(CFG, 'ASSY_Plan', [row()]);

    expect(out).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    expect(out.errors).toEqual([]);

    const [write] = writes(calls);
    expect(write.method).toBe('POST');
    expect(write.body).toEqual({
      fields: {
        [PLAN_COLUMNS.jobNum]: 'ASM8001',
        [PLAN_COLUMNS.line]: 'UPL',
        [PLAN_COLUMNS.operators]: 'Gate',
        [PLAN_COLUMNS.operatorIds]: 'W02',
        [PLAN_COLUMNS.startDate]: '2026-09-14T00:00:00.000Z',
        [PLAN_COLUMNS.dueDate]: '2026-09-22T00:00:00.000Z',
        [PLAN_COLUMNS.expectDate]: '2026-09-16T00:00:00.000Z',
        [PLAN_COLUMNS.orderQty]: 60,
        [PLAN_COLUMNS.remainingQty]: 60,
      },
    });
  });

  it('writes nothing when the list already says this', async () => {
    const calls = stubGraph([asStored()]);
    const out = await syncPlanRows(CFG, 'ASSY_Plan', [row()]);

    expect(out).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(writes(calls)).toEqual([]);
  });

  it('records the crew when an operator is allocated', async () => {
    const calls = stubGraph([asStored()]);
    const out = await syncPlanRows(CFG, 'ASSY_Plan', [
      row({ operatorIds: ['W02', 'W07'], operatorNames: ['Gate', 'Jones'] }),
    ]);

    expect(out.updated).toBe(1);
    const [write] = writes(calls);
    expect(write.method).toBe('PATCH');
    expect(write.url).toContain('/items/1/fields');
    expect(write.body).toMatchObject({
      [PLAN_COLUMNS.operators]: 'Gate, Jones',
      [PLAN_COLUMNS.operatorIds]: 'W02,W07',
    });
  });

  it('moves the start day on a drag and leaves the due date alone', async () => {
    const calls = stubGraph([asStored()]);
    await syncPlanRows(CFG, 'ASSY_Plan', [
      row({ startDate: '2026-09-17T00:00:00.000Z' }),
    ]);

    const [write] = writes(calls);
    expect(write.body?.[PLAN_COLUMNS.startDate]).toBe('2026-09-17T00:00:00.000Z');
    // The whole point of item 7: Epicor's date is untouched by a drag.
    expect(write.body?.[PLAN_COLUMNS.dueDate]).toBe('2026-09-22T00:00:00.000Z');
  });

  it('pushes a refreshed export’s due date and remaining qty', async () => {
    const calls = stubGraph([asStored()]);
    const out = await syncPlanRows(CFG, 'ASSY_Plan', [
      row({ dueDate: '2026-09-25T00:00:00.000Z', remainingQty: 42 }),
    ]);

    expect(out.updated).toBe(1);
    expect(writes(calls)[0].body).toMatchObject({
      [PLAN_COLUMNS.dueDate]: '2026-09-25T00:00:00.000Z',
      [PLAN_COLUMNS.remainingQty]: 42,
    });
  });

  it('leaves rows for orders that are no longer in the export', async () => {
    const calls = stubGraph([asStored(), asStored({ Title: 'ASM9999' })]);
    const out = await syncPlanRows(CFG, 'ASSY_Plan', [row()]);

    expect(out).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(writes(calls)).toEqual([]);
  });

  it('writes nothing at all when the list cannot be read', async () => {
    const calls = stubGraph([], false);
    const out = await syncPlanRows(CFG, 'ASSY_Plan', [row()]);

    expect(out.errors[0]).toContain('503');
    expect(out).toMatchObject({ created: 0, updated: 0 });
    expect(writes(calls)).toEqual([]);
  });

  it('refuses to write without a Graph token', async () => {
    const calls = stubGraph([]);
    const out = await syncPlanRows({ ...CFG, token: '' }, 'ASSY_Plan', [row()]);

    expect(out.errors[0]).toContain('token');
    expect(calls).toEqual([]);
  });
});

describe('planRowsFromBoard', () => {
  it('mirrors the schedulable lines only, never the PMD context lane', async () => {
    const loaded = await new MockSource().loadAll();
    if (!loaded.ok) throw new Error(loaded.error);
    const dataset = loaded.value;

    usePlanStore.getState().reconcile(dataset.workCenters, dataset.jobs);
    const state = usePlanStore.getState();
    const board = computeAssemblyGantt({
      dataset,
      indexes: buildIndexes(dataset),
      containers: state.containers,
      orderWorkers: state.orderWorkers,
      orderStarts: {},
      progress: {},
      production: {},
      workers: dataset.workers,
      today: new Date('2026-09-11T00:00:00'),
    });

    const rows = planRowsFromBoard(board);
    const mouldingIds = new Set(
      dataset.jobs.filter((j) => j.department === 'moulding').map((j) => String(j.id)),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => mouldingIds.has(r.jobNum))).toBe(false);
    for (const r of rows) {
      expect(['UPL', 'ASSY', 'TABLE']).toContain(r.line);
      expect(r.orderQty).toBeGreaterThanOrEqual(r.remainingQty);
    }
  });
});
