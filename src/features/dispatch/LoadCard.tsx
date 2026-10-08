/**
 * One truck, linehaul departure, container or pickup: what to book, what it
 * carries, and the planner's actions on it.
 *
 * The recommendation leads — "1 × Rigid 12-pallet truck — 45 m³ usable" —
 * with the route's whole size ladder under it, each size showing how full
 * this load would make it, so the reason for the pick is on the card: the
 * size below does not hold it, the size above would travel half empty.
 *
 * A proposal can be confirmed, which freezes it against re-planning; a
 * confirmed load can be marked dispatched or released back to the planner.
 */

import { DISPATCH_MODE_LABEL, VOLUME_SOURCE_LABEL, type VolumeSource } from '@/domain/dispatch';
import type { PlannedLoad } from '@/engine/dispatch/plan';
import { useDispatchStore } from '@/store/dispatchStore';
import { Badge } from '@/ui';
import { recommendation, sizeLadder } from './equipment';
import { READINESS, fillTone, m3, pct, shortDay } from './format';

/** One-letter marker for where a volume came from; freight is the default. */
const SOURCE_MARK: Partial<Record<VolumeSource, string>> = {
  cubics: 'C',
  'cubics-partial': 'C?',
  entered: 'E',
};

export function LoadCard({
  load,
  onOpenOrder,
}: {
  load: PlannedLoad;
  onOpenOrder: (id: string) => void;
}) {
  const settings = useDispatchStore((s) => s.settings);
  const confirmLoad = useDispatchStore((s) => s.confirmLoad);
  const markDispatched = useDispatchStore((s) => s.markDispatched);
  const releaseLoad = useDispatchStore((s) => s.releaseLoad);
  const drops = new Set(load.drops.map((d) => d.orderId)).size;
  const ladder = sizeLadder(load, settings);

  return (
    <article className={`load-card mode-${load.mode}${load.firm ? ` firm-${load.firm}` : ''}`}>
      <header className="load-head">
        <div className="load-title">
          <span className="load-mode">{DISPATCH_MODE_LABEL[load.mode]}</span>
          <strong>{load.label}</strong>
        </div>
        <div className="load-status">
          {load.firm === 'confirmed' && <Badge variant="info">Confirmed</Badge>}
          {load.firm === 'dispatched' && <Badge variant="ok">Dispatched</Badge>}
          <span className="load-drops">
            {drops} {load.mode === 'fleet' ? 'drop' : 'order'}
            {drops === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      <div className="load-reco">
        <span className="reco-label">{load.firm ? 'Booked' : 'Recommended'}</span>
        <strong className="reco-value">{recommendation(load, settings)}</strong>
        <div className="load-volume">
          {load.fill !== null && load.capacityM3 ? (
            <>
              <span className="fill-track" aria-hidden>
                <span
                  className={`fill-bar tone-${fillTone(load.fill)}`}
                  style={{ width: `${Math.min(100, load.fill * 100)}%` }}
                />
              </span>
              <span>
                <b>{m3(load.volumeM3)}</b> of {m3(load.capacityM3)} · <b>{pct(load.fill)}</b> full
              </span>
            </>
          ) : (
            <span>
              <b>{m3(load.volumeM3)}</b>
            </span>
          )}
          {load.weightKg > 0 && (
            <span title={load.weightComplete ? 'From the cubics sheet' : 'Only the drops the cubics sheet weighs'}>
              <b>{Math.round(load.weightKg).toLocaleString('en-AU')} kg</b>
              {load.weightComplete ? '' : '+'}
            </span>
          )}
        </div>
      </div>

      {ladder.length > 1 && (
        <ol className="size-ladder" aria-label="Sizes this route can use">
          {ladder.map((o) => (
            <li
              key={o.name}
              className={`${o.chosen ? 'chosen' : ''}${o.fits ? '' : ' too-small'}`}
              title={o.note || undefined}
            >
              <span className="rung-name">{o.name}</span>
              <span className="rung-cap">{o.capacityM3 === null ? 'part load' : `${o.capacityM3} m³`}</span>
              <span className="rung-fill">
                {!o.fits ? 'too small' : o.fill === null ? (o.chosen ? 'chosen' : 'fits') : `${pct(o.fill)} full`}
              </span>
            </li>
          ))}
        </ol>
      )}

      {load.warnings.length > 0 && (
        <ul className="load-warnings">
          {load.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <table className="summary-table drop-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>City</th>
            <th className="num">m³</th>
            <th>Ship By</th>
            <th>Goods</th>
          </tr>
        </thead>
        <tbody>
          {load.drops.map((d, i) => (
            <tr key={`${d.orderId}-${i}`}>
              <td>
                <button type="button" className="link" onClick={() => onOpenOrder(d.orderId)}>
                  {d.orderId}
                </button>
                {d.piece && (
                  <span className="tag" title="Bigger than the largest vehicle — split">
                    {d.piece.index}/{d.piece.of}
                  </span>
                )}
                {d.daysEarly > 0 && (
                  <span className="tag early" title="Working days ahead of its last dispatch day">
                    +{d.daysEarly}d
                  </span>
                )}
              </td>
              <td className="ellipsis" title={d.order?.custId}>
                {d.order ? d.order.custId : 'Not in the waybill'}
              </td>
              <td className="ellipsis" title={d.order ? `${d.order.city} (${d.order.zone})` : ''}>
                {d.order?.city}
              </td>
              <td className="num" title={VOLUME_SOURCE_LABEL[d.volumeSource]}>
                {d.volumeKnown ? d.volumeM3.toFixed(2) : <span className="tone-bad">?</span>}
                {SOURCE_MARK[d.volumeSource] && <sup className="src">{SOURCE_MARK[d.volumeSource]}</sup>}
              </td>
              <td
                className={d.order?.shipBy && d.order.shipBy < load.day ? 'tone-bad' : undefined}
                title={d.order?.shipBy && d.order.shipBy < load.day ? 'Leaves after its Ship By' : undefined}
              >
                {shortDay(d.order?.shipBy ?? null)}
              </td>
              <td>
                {d.order && (
                  <Badge variant={READINESS[d.order.readiness].variant} title={READINESS[d.order.readiness].title}>
                    {READINESS[d.order.readiness].label}
                  </Badge>
                )}
                {d.order?.inPicking && <span className="tag">Picking</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="load-actions">
        {!load.firm && (
          <button
            type="button"
            className="kpi-btn"
            onClick={() => confirmLoad(load)}
            title="Freeze this load: re-planning will no longer change it"
          >
            Confirm load
          </button>
        )}
        {load.firm === 'confirmed' && (
          <>
            <button type="button" className="kpi-btn primary" onClick={() => markDispatched(load.id)}>
              Mark dispatched
            </button>
            <button
              type="button"
              className="kpi-btn"
              onClick={() => releaseLoad(load.id)}
              title="Hand the orders back to the planner"
            >
              Release
            </button>
          </>
        )}
        {load.firm === 'dispatched' && (
          <button
            type="button"
            className="kpi-btn"
            onClick={() => releaseLoad(load.id)}
            title="Undo: the orders are planned again"
          >
            Undo dispatch
          </button>
        )}
      </footer>
    </article>
  );
}
