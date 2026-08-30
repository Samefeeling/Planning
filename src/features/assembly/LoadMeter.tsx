import type { AreaLoad } from '@/engine/assembly/capacity';

/**
 * People-hours load for an area: planned standard hours against the crew the
 * supervisor put on it. The assembly analogue of machine hours on the Gantt.
 */
export function LoadMeter({ load }: { load: AreaLoad }) {
  const pct = Math.min(load.loadPct, 999);
  const barPct = Math.min(load.loadPct, 100);

  return (
    <div className="load">
      <div className="load-top">
        <span className={`load-pct ${load.level}`}>
          {load.headcount > 0 ? `${Math.round(pct)}%` : 'no crew'}
        </span>
        <span className="load-hrs">
          {load.plannedHours.toFixed(1)} / {load.availableHours.toFixed(1)} h
        </span>
      </div>
      <div className="load-bar" title={`${load.daysOfWork.toFixed(1)} days of work queued`}>
        <div className={`load-fill ${load.level}`} style={{ width: `${barPct}%` }} />
        {load.loadPct > 100 && <div className="load-over" />}
      </div>
    </div>
  );
}
