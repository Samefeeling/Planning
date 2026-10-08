/**
 * The dispatch planner: every open order on the waybill, routed, windowed and
 * consolidated into loads, with the exceptions that keep orders off a load.
 *
 * Laid out like the MES KPI page (`src/ui/kpi.ts`), which this page will sit
 * beside once the two projects merge: one white toolbar card with the views
 * as tabs, a single row of headline stat tiles, then the content. Only the
 * app's own top bar is fixed — the toolbar and the tiles scroll away with the
 * page, so the plan gets the whole screen once someone is reading it.
 *
 * Four tabs, one question each:
 * - **Load plan** — what leaves on which day, in what, and how full it is;
 * - **Orders** — every order on the waybill and where the plan put it;
 * - **Exceptions** — what someone has to act on before it can ship;
 * - **Settings** — the vehicles, windows and departure days the plan uses.
 */

import { useMemo, useState } from 'react';
import { DISPATCH_MODE_LABEL, type DispatchMode } from '@/domain/dispatch';
import { BLOCKING_FLAGS } from '@/engine/dispatch/plan';
import { useDispatchStore } from '@/store/dispatchStore';
import { formatDay, formatTime } from '@/lib/time';
import { useDispatchPlan } from './useDispatchPlan';
import { WaybillLoader } from './WaybillLoader';
import { LoadPlan } from './LoadPlan';
import { OrdersTable } from './OrdersTable';
import { ExceptionsList, EXCEPTION_FLAGS } from './ExceptionsList';
import { DispatchSettingsPanel } from './DispatchSettingsPanel';
import { OrderDrawer } from './OrderDrawer';
import { fillTone, m3, pct } from './format';
import './dispatch.css';

type Tab = 'loads' | 'orders' | 'exceptions' | 'settings';

const TAB_LABEL: Record<Tab, string> = {
  loads: 'Load plan',
  orders: 'Orders',
  exceptions: 'Exceptions',
  settings: 'Settings',
};

/** The MES traffic-light classes a stat tile can carry. */
type Tone = 'green' | 'amber' | 'red' | '';

const TONE: Record<'good' | 'mid' | 'bad', Tone> = { good: 'green', mid: 'amber', bad: 'red' };

export function DispatchPage() {
  const model = useDispatchPlan();
  const { parsed, plan } = model;
  const fileName = useDispatchStore((s) => s.fileName);
  const loadedAt = useDispatchStore((s) => s.loadedAt);
  const cubicsFileName = useDispatchStore((s) => s.cubicsFileName);
  const [tab, setTab] = useState<Tab>('loads');
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!plan || !parsed) return null;
    const active = plan.loads.filter((l) => l.firm !== 'dispatched');
    const full = active.filter((l) => l.fill !== null);
    const capacity = full.reduce((s, l) => s + (l.capacityM3 ?? 0), 0);
    const filled = full.reduce((s, l) => s + l.volumeM3, 0);
    const byMode = new Map<DispatchMode, number>();
    for (const l of active) byMode.set(l.mode, (byMode.get(l.mode) ?? 0) + 1);
    let exceptions = 0;
    let blocked = 0;
    let overdue = 0;
    let pulled = 0;
    let byCubics = 0;
    let volume = 0;
    for (const o of plan.orders.values()) {
      if (o.flags.some((f) => EXCEPTION_FLAGS.includes(f))) exceptions++;
      if (o.flags.some((f) => BLOCKING_FLAGS.includes(f))) blocked++;
      if (o.flags.includes('overdue')) overdue++;
      if (o.flags.includes('pulled-forward')) pulled++;
      if (o.volumeSource === 'cubics') byCubics++;
      volume += o.volumeM3;
    }
    return {
      orders: parsed.orders.length,
      volume,
      byCubics,
      loads: active.length,
      byMode,
      fill: capacity > 0 ? filled / capacity : null,
      exceptions,
      blocked,
      overdue,
      pulled,
    };
  }, [plan, parsed]);

  return (
    <div className="dispatch">
      <div className="dispatch-scroll">
        <div className="kpi">
          <div className="kpi-head">
            <div className="shift-tabs" role="tablist" aria-label="Dispatch views">
              {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`shift-btn${tab === key ? ' a' : ''}`}
                  onClick={() => setTab(key)}
                >
                  {TAB_LABEL[key]}
                  {key === 'exceptions' && stats && stats.exceptions > 0 && (
                    <span className="tab-count">{stats.exceptions}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="kpi-range">
              <span className="dispatch-source">
                {fileName && loadedAt && (
                  <span title="The waybill the plan is built from">
                    Waybill <b>{fileName}</b> · {formatDay(new Date(loadedAt))} {formatTime(new Date(loadedAt))}
                  </span>
                )}
                {model.cubics && (
                  <span title="The product cube master orders are sized from">
                    Cubics <b>{cubicsFileName}</b> · {model.cubics.items.length} parts
                    {model.cubics.withoutCode.length > 0 && ` · ${model.cubics.withoutCode.length} rows without a code`}
                  </span>
                )}
              </span>
              <WaybillLoader />
            </div>
          </div>

          {parsed?.error && <div className="banner">Waybill not loaded: {parsed.error}</div>}
          {parsed && parsed.warnings.length > 0 && (
            <div className="banner warn">
              {parsed.warnings.slice(0, 3).join(' · ')}
              {parsed.warnings.length > 3 && ` · +${parsed.warnings.length - 3} more`}
            </div>
          )}

          {stats && (
            <div className="kpi-stats">
              <Stat label="Open orders" value={String(stats.orders)} title="Orders on the waybill" />
              <Stat label="m³ to ship" value={Math.round(stats.volume).toLocaleString('en-AU')} title={m3(stats.volume)} />
              <Stat
                label="Loads planned"
                value={String(stats.loads)}
                title={[...stats.byMode].map(([mode, n]) => `${DISPATCH_MODE_LABEL[mode]} ${n}`).join(' · ')}
              />
              <Stat
                label="Average fill"
                value={stats.fill === null ? '—' : pct(stats.fill)}
                tone={stats.fill === null ? '' : TONE[fillTone(stats.fill)]}
                title="Volume over capacity across trucks, trailers and containers: green from 85%, amber from 60%"
              />
              <Stat
                label="Sized by cubics"
                value={model.cubics ? String(stats.byCubics) : '—'}
                title={model.cubics ? `${stats.byCubics} of ${stats.orders} orders; the rest use the freight line` : 'Load the cubics sheet'}
              />
              <Stat label="Pulled forward" value={String(stats.pulled)} title="Orders sent early to fill space on a load" />
              <Stat
                label="Past Ship By"
                value={String(stats.overdue)}
                tone={stats.overdue > 0 ? 'red' : 'green'}
                title="Orders whose Ship By has already gone"
              />
              <Stat
                label="Exceptions"
                value={String(stats.exceptions)}
                tone={stats.exceptions > 0 ? 'amber' : 'green'}
                title={`${stats.blocked} blocked from every load`}
              />
            </div>
          )}

          {tab === 'settings' ? (
            <DispatchSettingsPanel />
          ) : !parsed || parsed.error || !plan ? (
            <div className="dispatch-empty">
              <h2>No waybill loaded</h2>
              <p>
                Load the waybill export (one row per order line: Order, Ship Via, Description,
                City, Ship By, freight CBM lines, Status) to build the dispatch plan. Settings can
                be reviewed before loading.
              </p>
            </div>
          ) : tab === 'loads' ? (
            <LoadPlan plan={plan} onOpenOrder={setOpenOrder} />
          ) : tab === 'orders' ? (
            <OrdersTable model={model} onOpenOrder={setOpenOrder} />
          ) : (
            <ExceptionsList model={model} onOpenOrder={setOpenOrder} />
          )}
        </div>
      </div>

      {openOrder && plan && (
        <OrderDrawer key={openOrder} orderId={openOrder} model={model} onClose={() => setOpenOrder(null)} />
      )}
    </div>
  );
}

/** One headline tile, in the MES `kpi-stat` shape: a label and a value. */
function Stat({ label, value, tone = '', title }: { label: string; value: string; tone?: Tone; title?: string }) {
  return (
    <div className={`kpi-stat${tone ? ` is-${tone}` : ''}`} title={title}>
      <span className="kpi-stat-label">{label}</span>
      <b className="kpi-stat-value">{value}</b>
    </div>
  );
}
