/**
 * The two-orders-at-once question.
 *
 * Nobody does two jobs at the same time, so putting someone on an order that
 * runs across one they are already on is not written straight to the plan.
 * Until the supervisor answers, nothing has changed — the person is not on the
 * second order.
 *
 * Two answers, and both are real:
 *   Confirm   they split their day between the two, or hand over part-way;
 *             the pair is recorded as approved and stops being flagged
 *   Cancel    leave them where they were and put someone else on it
 */

import { useEffect } from 'react';
import { JobId } from '@/domain/ids';
import { usePlanStore } from '@/store/planStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/ui';

export function ClashPrompt() {
  const request = useUiStore((s) => s.clashRequest);
  const clear = useUiStore((s) => s.clearClash);
  const assign = usePlanStore((s) => s.assignWorker);
  const approve = usePlanStore((s) => s.approveDoubleBooking);
  // The same gate as allocating by hand: this *is* an allocation, and a
  // heavier one than most.
  const unlocked = useSupervisorStore((s) => s.unlocked);
  const gated = useSupervisorStore((s) => s.required) && !unlocked;

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, clear]);

  if (!request) return null;

  const jobId = JobId(request.jobId);
  const confirm = () => {
    assign(jobId, request.workerId);
    approve(jobId, request.workerId);
    clear();
  };

  return (
    <div
      className="ot-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clash-title"
      onClick={clear}
    >
      <div className="ot-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="clash-title">Already on another order</h2>
        <p>
          <strong>{request.workerName}</strong> would be on{' '}
          <strong>{request.jobId}</strong> while it runs across work they are
          already booked for:
        </p>
        <ul className="clash-list">
          {request.withLabels.map((label, i) => (
            <li key={request.withJobIds[i]}>{label}</li>
          ))}
        </ul>
        <p className="ot-note">
          Nobody does two jobs at once, so both bars will be planned at a full
          shift each and their day will read as over-booked. Confirm only if
          they really are splitting the day or handing over part-way.
        </p>
        {gated && (
          <p className="ot-gate">
            Unlock Supervisor in the header to allocate.
          </p>
        )}
        <div className="ot-actions">
          <Button autoFocus variant="primary" disabled={gated} onClick={confirm}>
            Put them on anyway
          </Button>
          <Button onClick={clear}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
