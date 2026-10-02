/**
 * One truck, linehaul departure, container or pickup: what it carries, how
 * full it is, and the planner's actions on it.
 *
 * A proposal can be confirmed, which freezes it against re-planning; a
 * confirmed load can be marked dispatched or released back to the planner.
 */

import { DISPATCH_MODE_LABEL } from '@/domain/dispatch';
import type { PlannedLoad } from '@/engine/dispatch/plan';
import { useDispatchStore } from '@/store/dispatchStore';
import { Badge, Button } from '@/ui';
import { READINESS, fillTone, m3, pct, shortDay } from './format';

export function LoadCard({
  load,
  onOpenOrder,
}: {
  load: PlannedLoad;
  onOpenOrder: (id: string) => void;
}) {
  const confirmLoad = useDispatchStore((s) => s.confirmLoad);
  const markDispatched = useDispatchStore((s) => s.markDispatched);
  const releaseLoad = useDispatchStore((s) => s.releaseLoad);
  const drops = new Set(load.drops.map((d) => d.orderId)).size;

  return (
    <article className={`load-card mode-${load.mode}${load.firm ? ` firm-${load.firm}` : ''}`}>
      <header className="load-head">
        <div className="load-title">
          <span className="load-mode">{DISPATCH_MODE_LABEL[load.mode]}</span>
          <strong>{load.label}</strong>
        </div>
        <div className="load-equipment">
          <strong>{load.equipment}</strong>
          {load.firm === 'confirmed' && <Badge variant="info">Confirmed</Badge>}
          {load.firm === 'dispatched' && <Badge variant="ok">Dispatched</Badge>}
        </div>
      </header>

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
              {m3(load.volumeM3)} of {m3(load.capacityM3)} · <strong>{pct(load.fill)}</strong>
            </span>
          </>
        ) : (
          <span>{m3(load.volumeM3)}</span>
        )}
        <span className="load-drops">
          {drops} {load.mode === 'fleet' ? 'drop' : 'order'}
          {drops === 1 ? '' : 's'}
        </span>
      </div>

      {load.warnings.length > 0 && (
        <ul className="load-warnings">
          {load.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <table className="drop-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer · City</th>
            <th className="num">m³</th>
            <th>Ship By</th>
            <th>Goods</th>
          </tr>
        </thead>
        <tbody>
          {load.drops.map((d, i) => (
            <tr key={`${d.orderId}-${i}`}>
              <td>
                <button className="link" onClick={() => onOpenOrder(d.orderId)}>
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
              <td className="ellipsis" title={d.order ? `${d.order.custId} · ${d.order.city} (${d.order.zone})` : ''}>
                {d.order ? `${d.order.custId} · ${d.order.city}` : 'Not in the waybill'}
              </td>
              <td className="num">
                {d.volumeKnown ? d.volumeM3.toFixed(2) : <span className="tone-bad">?</span>}
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
          <Button onClick={() => confirmLoad(load)} title="Freeze this load: re-planning will no longer change it">
            Confirm load
          </Button>
        )}
        {load.firm === 'confirmed' && (
          <>
            <Button variant="primary" onClick={() => markDispatched(load.id)}>
              Mark dispatched
            </Button>
            <Button onClick={() => releaseLoad(load.id)} title="Hand the orders back to the planner">
              Release
            </Button>
          </>
        )}
        {load.firm === 'dispatched' && (
          <Button onClick={() => releaseLoad(load.id)} title="Undo: the orders are planned again">
            Undo dispatch
          </Button>
        )}
      </footer>
    </article>
  );
}
