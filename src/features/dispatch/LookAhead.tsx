/**
 * The look-ahead: what is coming, for planning warehouse space and booking
 * vehicles ahead. Read top-down:
 *
 * 1. **Plan facts** — open orders, m³, loads, fill and the orders the plan
 *    could not meet, for the whole waybill.
 * 2. **Volume to ship** — per day or per week, stacked by route, against the
 *    marshalling capacity; the weekly view adds a table of vehicles, part
 *    loads, fill and late orders per week.
 * 3. **Day strip** — every dispatch day in the window.
 *
 * Clicking a day (column, chip or week row) opens it on the Day board.
 */

import { useMemo, useState } from 'react';
import { DEADLINE_LABEL, DISPATCH_MODE_LABEL, type DispatchMode } from '@/domain/dispatch';
import type { DispatchPlan } from '@/engine/dispatch/plan';
import { addWorkingDays } from '@/engine/dispatch/calendar';
import { useDispatchStore } from '@/store/dispatchStore';
import { VolumeChart } from './VolumeChart';
import { MODES, equipmentMix, isoWeek, summarise, weekStart, type Bucket } from './summary';
import { fillTone, pct, shortDay, stagingTone, weekdayOf } from './format';

type Range = 'week' | 'fortnight' | 'month' | 'all';

const RANGE_LABEL: Record<Range, string> = {
  week: 'Next 5 days',
  fortnight: 'Next 10 days',
  month: 'Next 4 weeks',
  all: 'All',
};

const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { week: 4, fortnight: 9, month: 19 };


export function LookAhead({
  plan,
  day,
  cubicsLoaded,
  onOpenDay,
}: {
  plan: DispatchPlan;
  /** The day open on the Day board, highlighted here. */
  day: string;
  cubicsLoaded: boolean;
  onOpenDay: (day: string) => void;
}) {
  const settings = useDispatchStore((s) => s.settings);
  const [mode, setMode] = useState<DispatchMode | 'all'>('all');
  const [range, setRange] = useState<Range>('month');
  const [by, setBy] = useState<'day' | 'week'>('day');
  const [showDispatched, setShowDispatched] = useState(false);
  const selectedDay = day;
  const setSelectedDay = onOpenDay;
  const dueLabel = DEADLINE_LABEL[plan.deadline];

  const holidays = useMemo(() => new Set(settings.holidays), [settings.holidays]);
  const until = range === 'all' ? null : addWorkingDays(plan.today, RANGE_DAYS[range], holidays);

  const visible = useMemo(
    () =>
      plan.loads.filter(
        (l) =>
          (mode === 'all' || l.mode === mode) &&
          (showDispatched || l.firm !== 'dispatched') &&
          (until === null || l.day <= until),
      ),
    [plan.loads, mode, showDispatched, until],
  );

  const days = useMemo(() => summarise(visible, 'day', plan.deadline), [visible, plan.deadline]);
  const weeks = useMemo(() => summarise(visible, 'week', plan.deadline), [visible, plan.deadline]);

  const facts = useMemo(() => {
    const active = plan.loads.filter((l) => l.firm !== 'dispatched');
    const full = active.filter((l) => l.fill !== null);
    const capacity = full.reduce((s, l) => s + (l.capacityM3 ?? 0), 0);
    let volume = 0;
    let overdue = 0;
    let pulled = 0;
    let byCubics = 0;
    for (const o of plan.orders.values()) {
      volume += o.volumeM3;
      if (o.flags.includes('overdue')) overdue++;
      if (o.flags.includes('pulled-forward')) pulled++;
      if (o.volumeSource === 'cubics' || o.volumeSource === 'packed') byCubics++;
    }
    return {
      orders: plan.orders.size,
      volume,
      loads: active.length,
      fill: capacity > 0 ? full.reduce((s, l) => s + l.volumeM3, 0) / capacity : null,
      overdue,
      pulled,
      byCubics,
    };
  }, [plan]);

  const counts = new Map<DispatchMode, number>();
  for (const l of plan.loads) {
    if (l.firm === 'dispatched' && !showDispatched) continue;
    if (until !== null && l.day > until) continue;
    counts.set(l.mode, (counts.get(l.mode) ?? 0) + 1);
  }

  const selectWeek = (monday: string) => {
    const first = days.find((d) => weekStart(d.key) === monday);
    if (first) setSelectedDay(first.key);
  };

  const selectedWeek = selectedDay ? weekStart(selectedDay) : null;

  return (
    <div className="load-plan">
      <div className="plan-facts" aria-label="Plan facts">
        <Fact label="Open orders" value={String(facts.orders)} />
        <Fact label="m³ to ship" value={Math.round(facts.volume).toLocaleString('en-AU')} />
        <Fact label="Loads planned" value={String(facts.loads)} />
        <Fact
          label="Average fill"
          value={facts.fill === null ? '—' : pct(facts.fill)}
          tone={facts.fill === null ? undefined : fillTone(facts.fill)}
          title="Volume over capacity across trucks, trailers and containers: good from 85%"
        />
        <Fact label="Pulled forward" value={String(facts.pulled)} title="Orders sent early to fill space on a load" />
        <Fact
          label="Sized by pick list or cubics"
          value={cubicsLoaded || facts.byCubics > 0 ? String(facts.byCubics) : '—'}
          title="Orders sized from the packed cube or the cubics sheet; the rest use the freight line"
        />
        <Fact
          label={`Past ${dueLabel}`}
          value={String(facts.overdue)}
          tone={facts.overdue > 0 ? 'bad' : undefined}
          title="Open orders whose last ship day has gone"
        />
      </div>

      <div className="load-filters">
        <div className="shift-tabs" role="group" aria-label="Route">
          <button type="button" className={`shift-btn${mode === 'all' ? ' a' : ''}`} onClick={() => setMode('all')}>
            All routes
          </button>
          {MODES.map((m) => (
            <button key={m} type="button" className={`shift-btn${mode === m ? ' a' : ''}`} onClick={() => setMode(m)}>
              <span className={`dot series-${m}`} aria-hidden />
              {DISPATCH_MODE_LABEL[m]} <span className="seg-count">{counts.get(m) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="shift-tabs" role="group" aria-label="Window">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button key={r} type="button" className={`shift-btn${range === r ? ' a' : ''}`} onClick={() => setRange(r)}>
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={showDispatched}
            onChange={(e) => setShowDispatched(e.target.checked)}
          />
          Show dispatched
        </label>
      </div>

      <section className="kpi-chart" aria-label="Dispatch summary">
        <header className="summary-head">
          <h4>Volume to ship, m³ by route</h4>
          <span className="muted-note">Click a day to open it on the Day board</span>
          <div className="shift-tabs" role="group" aria-label="Group by">
            <button type="button" className={`shift-btn${by === 'day' ? ' a' : ''}`} onClick={() => setBy('day')}>
              By day
            </button>
            <button type="button" className={`shift-btn${by === 'week' ? ' a' : ''}`} onClick={() => setBy('week')}>
              By week
            </button>
          </div>
        </header>
        <VolumeChart
          buckets={by === 'day' ? days : weeks}
          by={by}
          capacityM3={settings.stagingCapacityM3}
          selected={by === 'day' ? selectedDay : selectedWeek}
          today={plan.today}
          onSelect={by === 'day' ? setSelectedDay : selectWeek}
        />
        {by === 'week' && (
          <WeekTable weeks={weeks} selected={selectedWeek} onSelect={selectWeek} />
        )}
      </section>

      {days.length > 0 && (
        <nav className="day-strip" aria-label="Dispatch days">
          {days.map((d, i) => {
            const newWeek = i === 0 || weekStart(d.key) !== weekStart(days[i - 1].key);
            const staging = settings.stagingCapacityM3;
            const tone = staging > 0 ? stagingTone(d.total / staging) : 'good';
            return (
              <div key={d.key} className="day-chip-wrap">
                {newWeek && <span className="week-mark">Wk {isoWeek(d.key)}</span>}
                <button
                  title={staging > 0 ? `${pct(d.total / staging)} of marshalling capacity` : undefined}
                  className={`day-chip${d.key === selectedDay ? ' active' : ''}${d.key === plan.today ? ' today' : ''}`}
                  onClick={() => setSelectedDay(d.key)}
                  aria-pressed={d.key === selectedDay}
                >
                  <span className="chip-day">
                    {weekdayOf(d.key)} {shortDay(d.key)}
                  </span>
                  <span className="chip-vol">
                    <span className={`status-dot tone-${tone}`} aria-hidden />
                    {Math.round(d.total)} m³
                  </span>
                  <span className="chip-loads">
                    {MODES.reduce((s, m) => s + d.loads[m], 0)} loads
                  </span>
                </button>
              </div>
            );
          })}
        </nav>
      )}

    </div>
  );
}

function WeekTable({
  weeks,
  selected,
  onSelect,
}: {
  weeks: Bucket[];
  selected: string | null;
  onSelect: (monday: string) => void;
}) {
  if (weeks.length === 0) return null;
  return (
    <div className="table-scroll">
      <table className="summary-table week-table">
        <thead>
          <tr>
            <th>Week</th>
            <th className="num">Orders</th>
            <th className="num">Total m³</th>
            {MODES.map((m) => (
              <th key={m} className="num">
                <span className={`dot series-${m}`} aria-hidden />
                {DISPATCH_MODE_LABEL[m]}
              </th>
            ))}
            <th>To book</th>
            <th className="num">Fill</th>
            <th className="num">Pulled fwd</th>
            <th className="num">After due date</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr
              key={w.key}
              className={`clickable${selected === w.key ? ' selected' : ''}`}
              onClick={() => onSelect(w.key)}
            >
              <td>
                <strong>Wk {isoWeek(w.key)}</strong> <span className="muted">from {shortDay(w.key)}</span>
              </td>
              <td className="num">{w.orders}</td>
              <td className="num">
                <strong>{Math.round(w.total).toLocaleString('en-AU')}</strong>
              </td>
              {MODES.map((m) => (
                <td key={m} className="num">
                  {w.loads[m] > 0 ? (
                    <>
                      {Math.round(w.volume[m])} <span className="muted">({w.loads[m]})</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              ))}
              <td className="book-mix">{equipmentMix(w.equipment) || '—'}</td>
              <td className="num">{w.fill === null ? '—' : pct(w.fill)}</td>
              <td className="num">{w.pulledForward}</td>
              <td className={`num${w.late > 0 ? ' tone-bad' : ''}`}>{w.late}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted-note">m³ per route, loads in brackets. Click a week to open its first day.</p>
    </div>
  );
}

function Fact({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'mid' | 'bad';
  title?: string;
}) {
  return (
    <div className="plan-fact" title={title}>
      <span className="plan-fact-label">{label}</span>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
    </div>
  );
}
