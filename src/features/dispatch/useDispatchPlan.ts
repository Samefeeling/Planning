/**
 * The waybill, parsed, and the plan built over it — recomputed only when the
 * export, the settings, the planner's decisions or the day change.
 */

import { useMemo } from 'react';
import { parseWaybillCsv, type WaybillParseResult } from '@/data/csv/waybill.parser';
import type { ShipmentOrder, WaybillLine } from '@/domain/dispatch';
import { planDispatch, type DispatchPlan } from '@/engine/dispatch/plan';
import { useDispatchStore } from '@/store/dispatchStore';
import { toDayKey } from '@/lib/time';

export interface DispatchModel {
  parsed: WaybillParseResult | null;
  plan: DispatchPlan | null;
  ordersById: Map<string, ShipmentOrder>;
  linesByOrder: Map<string, WaybillLine[]>;
}

export function useDispatchPlan(): DispatchModel {
  const csvText = useDispatchStore((s) => s.csvText);
  const settings = useDispatchStore((s) => s.settings);
  const decisions = useDispatchStore((s) => s.decisions);
  const today = toDayKey(new Date());

  const parsed = useMemo(() => (csvText ? parseWaybillCsv(csvText) : null), [csvText]);

  const indexes = useMemo(() => {
    const ordersById = new Map<string, ShipmentOrder>();
    const linesByOrder = new Map<string, WaybillLine[]>();
    for (const o of parsed?.orders ?? []) ordersById.set(o.id, o);
    for (const l of parsed?.lines ?? []) {
      const list = linesByOrder.get(l.order);
      if (list) list.push(l);
      else linesByOrder.set(l.order, [l]);
    }
    return { ordersById, linesByOrder };
  }, [parsed]);

  const plan = useMemo(
    () =>
      parsed && !parsed.error
        ? planDispatch(parsed.orders, settings, decisions, today)
        : null,
    [parsed, settings, decisions, today],
  );

  return { parsed, plan, ...indexes };
}
