/**
 * The dispatch planner: every open order on the waybill, routed, windowed and
 * consolidated into loads, with the exceptions that keep orders off a load.
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
import { m3, pct } from './format';
import './dispatch.css';

type Tab = 'loads' | 'orders' | 'exceptions' | 'settings';

const TAB_LABEL: Record<Tab, string> = {
  loads: 'Load plan',
  orders: 'Orders',
  exceptions: 'Exceptions',
  settings: 'Settings',
};

export function DispatchPage() {
  const model = useDispatchPlan();
  const { parsed, plan } = model;
  const fileName = useDispatchStore((s) => s.fileName);
  const loadedAt = useDispatchStore((s) => s.loadedAt);
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
    for (const o of plan.orders.values()) {
      if (o.flags.some((f) => EXCEPTION_FLAGS.includes(f))) exceptions++;
      if (o.flags.some((f) => BLOCKING_FLAGS.includes(f))) blocked++;
      if (o.flags.includes('overdue')) overdue++;
      if (o.flags.includes('pulled-forward')) pulled++;
    }
    return {
      orders: parsed.orders.length,
      volume: parsed.orders.reduce((s, o) => s + (o.volumeM3 ?? 0), 0),
      loads: active.length,
      confirmed: active.filter((l) => l.firm === 'confirmed').length,
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
      <div className="dispatch-bar">
        <WaybillLoader />
        {fileName && loadedAt && (
          <span className="dispatch-source" title="The waybill the plan is built from">
            {fileName} · loaded {formatDay(new Date(loadedAt))} {formatTime(new Date(loadedAt))}
          </span>
        )}
        <nav className="dispatch-tabs" aria-label="Dispatch views">
          {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => setTab(key)}
            >
              {TAB_LABEL[key]}
              {key === 'exceptions' && stats && stats.exceptions > 0 && (
                <span className="tab-count">{stats.exceptions}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {parsed?.error && <div className="banner">Waybill not loaded: {parsed.error}</div>}
      {parsed && parsed.warnings.length > 0 && (
        <div className="banner warn">
          {parsed.warnings.slice(0, 3).join(' · ')}
          {parsed.warnings.length > 3 && ` · +${parsed.warnings.length - 3} more`}
        </div>
      )}

      {stats && (
        <div className="dispatch-kpis">
          <Kpi label="Open orders" value={String(stats.orders)} hint={`${m3(stats.volume)} to ship`} />
          <Kpi
            label="Loads planned"
            value={String(stats.loads)}
            hint={[...stats.byMode]
              .map(([mode, n]) => `${DISPATCH_MODE_LABEL[mode]} ${n}`)
              .join(' · ')}
          />
          <Kpi
            label="Average fill"
            value={stats.fill === null ? '—' : pct(stats.fill)}
            hint="Volume over capacity, trucks and containers"
          />
          <Kpi label="Confirmed" value={String(stats.confirmed)} hint="Loads frozen by the planner" />
          <Kpi label="Pulled forward" value={String(stats.pulled)} hint="Orders sent early to fill space" />
          <Kpi
            label="Exceptions"
            value={String(stats.exceptions)}
            hint={`${stats.blocked} blocked · ${stats.overdue} past Ship By`}
            tone={stats.exceptions > 0 ? 'warn' : undefined}
          />
        </div>
      )}

      <div className="dispatch-body">
        {tab === 'settings' ? (
          <DispatchSettingsPanel />
        ) : !parsed || parsed.error || !plan ? (
          <div className="dispatch-empty">
            <h2>No waybill loaded</h2>
            <p>
              Load the waybill export (one row per order line: Order, Ship Via,
              Description, City, Ship By, freight CBM lines, Status) to build the
              dispatch plan. Settings can be reviewed before loading.
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

      {openOrder && plan && (
        <OrderDrawer
          key={openOrder}
          orderId={openOrder}
          model={model}
          onClose={() => setOpenOrder(null)}
        />
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'warn';
}) {
  return (
    <div className={`dispatch-kpi${tone ? ` ${tone}` : ''}`} title={hint}>
      <span className="kpi-label">{label}</span>
      <strong>{value}</strong>
      <span className="kpi-hint">{hint}</span>
    </div>
  );
}
