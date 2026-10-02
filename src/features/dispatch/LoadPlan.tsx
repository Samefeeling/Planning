/**
 * What leaves on which day: one section per dispatch day, its volume against
 * the marshalling area, and a card per load.
 */

import { useMemo, useState } from 'react';
import { DISPATCH_MODE_LABEL, type DispatchMode } from '@/domain/dispatch';
import type { DispatchPlan, PlannedLoad } from '@/engine/dispatch/plan';
import { addWorkingDays } from '@/engine/dispatch/calendar';
import { useDispatchStore } from '@/store/dispatchStore';
import { LoadCard } from './LoadCard';
import { dayLabel, m3, pct, stagingTone } from './format';

type Range = 'week' | 'fortnight' | 'all';

const RANGE_LABEL: Record<Range, string> = {
  week: 'Next 5 days',
  fortnight: 'Next 10 days',
  all: 'All',
};

const MODES: DispatchMode[] = ['fleet', 'linehaul', 'container', 'pickup'];

export function LoadPlan({
  plan,
  onOpenOrder,
}: {
  plan: DispatchPlan;
  onOpenOrder: (id: string) => void;
}) {
  const settings = useDispatchStore((s) => s.settings);
  const [mode, setMode] = useState<DispatchMode | 'all'>('all');
  const [range, setRange] = useState<Range>('fortnight');
  const [showDispatched, setShowDispatched] = useState(false);

  const holidays = useMemo(() => new Set(settings.holidays), [settings.holidays]);
  const until =
    range === 'all'
      ? null
      : addWorkingDays(plan.today, range === 'week' ? 4 : 9, holidays);

  const visible = plan.loads.filter(
    (l) =>
      (mode === 'all' || l.mode === mode) &&
      (showDispatched || l.firm !== 'dispatched') &&
      (until === null || l.day <= until),
  );

  const byDay = new Map<string, PlannedLoad[]>();
  for (const load of visible) {
    const list = byDay.get(load.day);
    if (list) list.push(load);
    else byDay.set(load.day, [load]);
  }
  const totals = new Map(plan.days.map((d) => [d.day, d]));
  const counts = new Map<DispatchMode, number>();
  for (const l of plan.loads) {
    if (l.firm === 'dispatched') continue;
    if (until !== null && l.day > until) continue;
    counts.set(l.mode, (counts.get(l.mode) ?? 0) + 1);
  }

  return (
    <div className="load-plan">
      <div className="load-filters">
        <div className="seg" role="group" aria-label="Route">
          <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>
            All routes
          </button>
          {MODES.map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
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

      {byDay.size === 0 && <p className="muted-note">Nothing to dispatch in this window.</p>}

      {[...byDay].map(([day, loads]) => {
        const total = totals.get(day);
        const staging = settings.stagingCapacityM3;
        const fraction = total && staging > 0 ? total.volumeM3 / staging : 0;
        return (
          <section key={day} className="dispatch-day">
            <header className="day-head">
              <h3>
                {dayLabel(day)}
                {day === plan.today && <span className="today-tag">Today</span>}
              </h3>
              {total && (
                <div className="day-stats">
                  <span>
                    {total.loads} load{total.loads === 1 ? '' : 's'} · {total.fleetRuns} fleet run
                    {total.fleetRuns === 1 ? '' : 's'}
                    {total.overFleet && (
                      <strong className="tone-bad">
                        {' '}
                        — over {settings.fleet.maxRunsPerDay} trucks
                      </strong>
                    )}
                  </span>
                  {staging > 0 && (
                    <span
                      className="staging"
                      title={`Volume leaving this day against the ${m3(staging)} marshalling area`}
                    >
                      <span className="staging-track">
                        <span
                          className={`staging-fill tone-${stagingTone(fraction)}`}
                          style={{ width: `${Math.min(100, fraction * 100)}%` }}
                        />
                      </span>
                      {m3(total.volumeM3)} / {m3(staging)} staging ({pct(fraction)})
                    </span>
                  )}
                </div>
              )}
            </header>
            <div className="load-grid">
              {loads.map((load) => (
                <LoadCard key={load.id} load={load} onOpenOrder={onOpenOrder} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
