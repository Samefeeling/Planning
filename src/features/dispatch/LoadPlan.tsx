/**
 * What leaves when, read top-down:
 *
 * 1. **Summary** — volume per day or per week, stacked by route, against the
 *    marshalling capacity; the weekly view adds a table of vehicles, part
 *    loads, fill and late orders per week. Clicking a column picks the day
 *    (or week) shown below.
 * 2. **Day strip** — every dispatch day in the window with its volume and
 *    loads, so the week can be stepped through.
 * 3. **The day** — its loads by route, one card each.
 */

import { useEffect, useMemo, useState } from 'react';
import { DISPATCH_MODE_LABEL, type DispatchMode } from '@/domain/dispatch';
import type { DispatchPlan, PlannedLoad } from '@/engine/dispatch/plan';
import { addWorkingDays } from '@/engine/dispatch/calendar';
import { useDispatchStore } from '@/store/dispatchStore';
import { LoadCard } from './LoadCard';
import { VolumeChart } from './VolumeChart';
import { MODES, isoWeek, summarise, weekStart, type Bucket } from './summary';
import { dayLabel, m3, pct, shortDay, stagingTone, weekdayOf } from './format';

type Range = 'week' | 'fortnight' | 'month' | 'all';

const RANGE_LABEL: Record<Range, string> = {
  week: 'Next 5 days',
  fortnight: 'Next 10 days',
  month: 'Next 4 weeks',
  all: 'All',
};

const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { week: 4, fortnight: 9, month: 19 };

const kg = (v: number) => `${Math.round(v).toLocaleString('en-AU')} kg`;

export function LoadPlan({
  plan,
  onOpenOrder,
}: {
  plan: DispatchPlan;
  onOpenOrder: (id: string) => void;
}) {
  const settings = useDispatchStore((s) => s.settings);
  const [mode, setMode] = useState<DispatchMode | 'all'>('all');
  const [range, setRange] = useState<Range>('month');
  const [by, setBy] = useState<'day' | 'week'>('day');
  const [showDispatched, setShowDispatched] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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

  const days = useMemo(() => summarise(visible, 'day'), [visible]);
  const weeks = useMemo(() => summarise(visible, 'week'), [visible]);

  // Keep a day picked: the one chosen if it is still in the window, else the
  // first day with something leaving.
  useEffect(() => {
    if (selectedDay && days.some((d) => d.key === selectedDay)) return;
    setSelectedDay(days[0]?.key ?? null);
  }, [days, selectedDay]);

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
  const dayLoads = visible.filter((l) => l.day === selectedDay);
  const dayBucket = days.find((d) => d.key === selectedDay) ?? null;
  const dayTotal = plan.days.find((d) => d.day === selectedDay);

  return (
    <div className="load-plan">
      <div className="load-filters">
        <div className="seg" role="group" aria-label="Route">
          <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>
            All routes
          </button>
          {MODES.map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              <span className={`dot series-${m}`} aria-hidden />
              {DISPATCH_MODE_LABEL[m]} <span className="seg-count">{counts.get(m) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Window">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
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

      <section className="summary-panel" aria-label="Dispatch summary">
        <header className="summary-head">
          <h2>Volume to ship</h2>
          <div className="seg" role="group" aria-label="Group by">
            <button className={by === 'day' ? 'active' : ''} onClick={() => setBy('day')}>
              By day
            </button>
            <button className={by === 'week' ? 'active' : ''} onClick={() => setBy('week')}>
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

      {selectedDay && dayBucket && (
        <section className="day-detail">
          <header className="day-detail-head">
            <div>
              <h2>
                {dayLabel(selectedDay)}
                {selectedDay === plan.today && <span className="today-tag">Today</span>}
              </h2>
              <p className="day-facts">
                {dayBucket.orders} orders · {m3(dayBucket.total)}
                {dayBucket.weightKg > 0 && ` · ${kg(dayBucket.weightKg)}`}
                {' · '}
                {dayBucket.vehicles} vehicle{dayBucket.vehicles === 1 ? '' : 's'}
                {dayBucket.partLoads > 0 && ` + ${dayBucket.partLoads} part load${dayBucket.partLoads === 1 ? '' : 's'}`}
                {dayBucket.fill !== null && ` · fill ${pct(dayBucket.fill)}`}
                {dayBucket.late > 0 && (
                  <strong className="tone-bad"> · {dayBucket.late} after Ship By</strong>
                )}
              </p>
            </div>
            {dayTotal && settings.stagingCapacityM3 > 0 && (
              <StagingMeter volume={dayTotal.volumeM3} capacity={settings.stagingCapacityM3} />
            )}
            {dayTotal?.overFleet && (
              <p className="tone-bad">
                {dayTotal.fleetRuns} fleet runs — more than the {settings.fleet.maxRunsPerDay} trucks available
              </p>
            )}
          </header>

          {MODES.map((m) => {
            const group = dayLoads.filter((l) => l.mode === m);
            if (group.length === 0) return null;
            return <ModeGroup key={m} mode={m} loads={group} onOpenOrder={onOpenOrder} />;
          })}
        </section>
      )}
    </div>
  );
}

function ModeGroup({
  mode,
  loads,
  onOpenOrder,
}: {
  mode: DispatchMode;
  loads: PlannedLoad[];
  onOpenOrder: (id: string) => void;
}) {
  const volume = loads.reduce((s, l) => s + l.volumeM3, 0);
  return (
    <div className="mode-group">
      <h3>
        <span className={`dot series-${mode}`} aria-hidden />
        {DISPATCH_MODE_LABEL[mode]}
        <span className="mode-sum">
          {loads.length} load{loads.length === 1 ? '' : 's'} · {m3(volume)}
        </span>
      </h3>
      <div className="load-grid">
        {loads.map((load) => (
          <LoadCard key={load.id} load={load} onOpenOrder={onOpenOrder} />
        ))}
      </div>
    </div>
  );
}

function StagingMeter({ volume, capacity }: { volume: number; capacity: number }) {
  const fraction = volume / capacity;
  return (
    <div className="staging-meter" title="Volume leaving this day against the marshalling area">
      <span className="meter-label">Marshalling</span>
      <span className="meter-track">
        <span
          className={`meter-fill tone-${stagingTone(fraction)}`}
          style={{ width: `${Math.min(100, fraction * 100)}%` }}
        />
      </span>
      <span className="meter-value">
        <strong>{pct(fraction)}</strong> · {m3(volume)} of {m3(capacity)}
        {fraction > 1 && <span className="tone-bad"> — over</span>}
      </span>
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
      <table className="week-table">
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
            <th className="num">Vehicles</th>
            <th className="num">Part loads</th>
            <th className="num">Fill</th>
            <th className="num">Pulled fwd</th>
            <th className="num">After Ship By</th>
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
              <td className="num">{w.vehicles}</td>
              <td className="num">{w.partLoads}</td>
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
