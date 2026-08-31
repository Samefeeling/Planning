import { useDataStore } from '@/store/dataStore';
import { Button, Spinner } from '@/ui';
import { formatTime } from '@/lib/time';

export function RefreshControl({ onRefresh }: { onRefresh: () => void }) {
  const status = useDataStore((s) => s.status);
  const fetchedAt = useDataStore((s) => s.dataset?.fetchedAt ?? null);
  const loading = status === 'loading';

  return (
    <div className="zoom">
      {loading && <Spinner />}
      <span className="sub">
        {fetchedAt ? `Planning1.csv updated ${formatTime(fetchedAt)}` : 'Planning1.csv update time unavailable'}
      </span>
      <Button onClick={onRefresh} disabled={loading}>
        Refresh
      </Button>
    </div>
  );
}
