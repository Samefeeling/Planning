import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';
import { Button, Spinner } from '@/ui';
import { formatTime } from '@/lib/time';

export function RefreshControl({ onRefresh }: { onRefresh: () => void }) {
  const status = useDataStore((s) => s.status);
  const last = useUiStore((s) => s.lastRefresh);
  const loading = status === 'loading';

  return (
    <div className="zoom">
      {loading && <Spinner />}
      <span className="sub">
        {last ? `Updated ${formatTime(last)}` : 'Not yet refreshed'}
      </span>
      <Button onClick={onRefresh} disabled={loading}>
        Refresh
      </Button>
    </div>
  );
}
