/**
 * Every order on the waybill: where it is routed, its window, and the day and
 * load the plan gave it. Clicking a row opens the order.
 */

import { useMemo, useState } from 'react';
import { DISPATCH_MODE_LABEL, VOLUME_SOURCE_LABEL, type DispatchMode } from '@/domain/dispatch';
import { ORDER_FLAG_LABEL, type OrderFlag } from '@/engine/dispatch/plan';
import { Badge } from '@/ui';
import type { DispatchModel } from './useDispatchPlan';
import { EXCEPTION_FLAGS } from './ExceptionsList';
import { READINESS, money, shortDay } from './format';

type SortKey = 'shipBy' | 'planned' | 'volume' | 'order';

const FLAG_SHORT: Partial<Record<OrderFlag, string>> = {
  overdue: 'Overdue',
  late: 'Late',
  'not-ready': 'Not ready',
  'credit-hold': 'Credit hold',
  'on-hold': 'On hold',
  held: 'Held',
  'no-volume': 'No m³',
  'no-ship-by': 'No Ship By',
  unrouted: 'Unrouted',
  split: 'Split',
  'pulled-forward': 'Early',
  pinned: 'Pinned',
  firm: 'Firm',
  'no-location': 'No map',
  'cube-partial': 'Cube partial',
};

export function OrdersTable({
  model,
  onOpenOrder,
}: {
  model: DispatchModel;
  onOpenOrder: (id: string) => void;
}) {
  const { parsed, plan } = model;
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<DispatchMode | 'all' | 'none'>('all');
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [sort, setSort] = useState<SortKey>('shipBy');

  const rows = useMemo(() => {
    if (!parsed || !plan) return [];
    const q = query.trim().toLowerCase();
    const list = model.orders
      .map((order) => ({ order, op: plan.orders.get(order.id)! }))
      .filter(({ order, op }) => {
        if (mode === 'none' ? op.route !== null : mode !== 'all' && op.route?.mode !== mode) return false;
        if (onlyExceptions && !op.flags.some((f) => EXCEPTION_FLAGS.includes(f))) return false;
        if (!q) return true;
        return [order.id, order.custId, order.city, order.zone, order.shipVia]
          .some((v) => v.toLowerCase().includes(q));
      });
    const key = (r: (typeof list)[number]): string | number => {
      switch (sort) {
        case 'shipBy':
          return r.order.shipBy ?? '9999';
        case 'planned':
          return r.op.day ?? '9999';
        case 'volume':
          return -r.op.volumeM3;
        case 'order':
          return r.order.id;
      }
    };
    return list.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka < kb ? -1 : ka > kb ? 1 : a.order.id.localeCompare(b.order.id);
    });
  }, [parsed, plan, model.orders, query, mode, onlyExceptions, sort]);

  const head = (label: string, key?: SortKey, className?: string) => (
    <th className={className}>
      {key ? (
        <button className={`th-sort${sort === key ? ' active' : ''}`} onClick={() => setSort(key)}>
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="orders-view">
      <div className="load-filters">
        <input
          className="search"
          type="search"
          placeholder="Order, customer, city, zone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="all">All routes</option>
          {(Object.keys(DISPATCH_MODE_LABEL) as DispatchMode[]).map((m) => (
            <option key={m} value={m}>
              {DISPATCH_MODE_LABEL[m]}
            </option>
          ))}
          <option value="none">Not routed</option>
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={onlyExceptions}
            onChange={(e) => setOnlyExceptions(e.target.checked)}
          />
          Exceptions only
        </label>
        <span className="muted-note">{rows.length} orders</span>
      </div>
      <div className="table-scroll">
        <table className="orders-table">
          <thead>
            <tr>
              {head('Order', 'order')}
              <th>Customer</th>
              <th>Zone · City</th>
              <th>Route</th>
              {head('m³', 'volume', 'num')}
              <th className="num">Value</th>
              {head('Ship By', 'shipBy')}
              <th>Need By</th>
              <th>Goods</th>
              {head('Planned', 'planned')}
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ order, op }) => (
              <tr key={order.id} onClick={() => onOpenOrder(order.id)} className="clickable">
                <td className="mono">{order.id}</td>
                <td>{order.custId}</td>
                <td className="ellipsis" title={`${order.zone} · ${order.city}`}>
                  {order.zone} · {order.city}
                </td>
                <td className="ellipsis">{op.route?.label ?? '—'}</td>
                <td className="num" title={VOLUME_SOURCE_LABEL[op.volumeSource]}>
                  {op.volumeKnown ? op.volumeM3.toFixed(2) : '?'}
                  {op.volumeSource === 'cubics' && <sup className="src">C</sup>}
                  {op.volumeSource === 'cubics-partial' && <sup className="src">C?</sup>}
                  {op.volumeSource === 'entered' && <sup className="src">E</sup>}
                </td>
                <td className="num">{money(order.value)}</td>
                <td>{shortDay(order.shipBy)}</td>
                <td>{shortDay(order.needBy)}</td>
                <td>
                  <Badge variant={READINESS[order.readiness].variant}>{READINESS[order.readiness].label}</Badge>
                </td>
                <td>{shortDay(op.day)}</td>
                <td className="flags">
                  {op.flags.map((f) => (
                    <span
                      key={f}
                      className={`flag${EXCEPTION_FLAGS.includes(f) ? ' bad' : ''}`}
                      title={ORDER_FLAG_LABEL[f]}
                    >
                      {FLAG_SHORT[f] ?? f}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
