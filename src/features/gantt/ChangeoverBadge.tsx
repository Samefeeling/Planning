import type { ChangeoverInfo, ChangeoverKind } from '@/domain/types';
import { Badge, type BadgeVariant } from '@/ui';

const LABEL: Record<ChangeoverKind, string> = {
  tool: 'Die',
  color: 'Colour',
  insert: 'Insert',
};
const VARIANT: Record<ChangeoverKind, BadgeVariant> = {
  tool: 'tool',
  color: 'color',
  insert: 'insert',
};

/**
 * Shows whether a Die/Tool/Colour/Insert change is needed before a job runs.
 * `compact` (on the bar) collapses to a single chip; the inspector shows each
 * kind spelled out.
 */
export function ChangeoverBadge({
  changeover,
  compact = false,
}: {
  changeover: ChangeoverInfo;
  compact?: boolean;
}) {
  if (!changeover.required || changeover.kinds.length === 0) return null;

  const mins = Math.round(changeover.minutes);
  if (compact) {
    const primary = changeover.kinds[0];
    return (
      <Badge variant={VARIANT[primary]} title={`${changeover.summary} · ~${mins} min`}>
        ⇄ {changeover.kinds.map((k) => LABEL[k][0]).join('')} {mins}m
      </Badge>
    );
  }

  return (
    <>
      {changeover.kinds.map((k) => (
        <Badge key={k} variant={VARIANT[k]} title={changeover.summary}>
          {LABEL[k]} change
        </Badge>
      ))}
      <Badge variant="neutral" title="Estimated setup time">
        ~{mins} min
      </Badge>
    </>
  );
}
