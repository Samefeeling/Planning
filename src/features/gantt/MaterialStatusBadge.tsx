import type { MaterialStatus } from '@/domain/types';
import { Badge } from '@/ui';
import { formatDay } from '@/lib/time';

/**
 * Raw-material readiness for a job:
 *   ok       → all components in stock
 *   covered  → short now, but an incoming PO clears it (shows the date)
 *   short    → short with no PO on file (cannot schedule yet)
 */
export function MaterialStatusBadge({
  material,
  compact = false,
}: {
  material: MaterialStatus;
  compact?: boolean;
}) {
  switch (material.level) {
    case 'ok':
      return compact ? null : <Badge variant="ok">Material OK</Badge>;

    case 'covered': {
      const when = material.earliestStart
        ? formatDay(material.earliestStart)
        : 'PO due';
      return (
        <Badge
          variant="warn"
          title={`Short now; ${material.shortages.length} component(s) on PO, earliest ${when}`}
        >
          {compact ? `▲ ${when}` : `Material ${when}`}
        </Badge>
      );
    }

    case 'short':
      return (
        <Badge
          variant="error"
          title={`Short with no PO: ${material.shortages
            .map((s) => `${s.componentPart} (−${s.shortQty})`)
            .join(', ')}`}
        >
          {compact ? '✕ short' : 'Material short'}
        </Badge>
      );

    default:
      return null;
  }
}
