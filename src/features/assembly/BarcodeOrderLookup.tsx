/** Keyboard-wedge barcode lookup: scan a job number and open its order popup. */

import { useEffect, useRef, useState } from 'react';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import { useUiStore } from '@/store/uiStore';
import { Button } from '@/ui';

export function findBarcodeJobId(raw: string, knownIds: Iterable<string>): string | null {
  const ids = new Map([...knownIds].map((id) => [id.toUpperCase(), id]));
  const clean = raw.trim().replace(/[\u0000-\u001f]/g, '');
  const tokens = [clean, ...clean.split(/[^A-Za-z0-9_-]+/)]
    .map((token) => token.replace(/^(JOB|JOBNUM|ORDER)[:=-]?/i, '').toUpperCase())
    .filter(Boolean);
  for (const token of tokens) {
    const found = ids.get(token);
    if (found) return found;
  }
  return null;
}

export function BarcodeOrderLookup({ board }: { board: AssemblyGanttView | null }) {
  const select = useUiStore((s) => s.select);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!board) return null;
  const submit = () => {
    const jobId = findBarcodeJobId(value, board.rowsByJob.keys());
    if (!jobId) {
      setProblem(value.trim() ? `Order not found: ${value.trim()}` : 'Scan a job barcode');
      input.current?.focus();
      return;
    }
    select(jobId, { x: window.innerWidth / 2, y: 90 });
    setValue('');
    setProblem(null);
    setOpen(false);
  };

  return (
    <span className="barcode-lookup">
      <Button onClick={() => setOpen((current) => !current)} title="Scan a job number barcode">
        Scan order
      </Button>
      {open && (
        <form className="barcode-popover" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label htmlFor="job-barcode">Scan job barcode</label>
          <div className="barcode-entry">
            <input
              id="job-barcode"
              ref={input}
              value={value}
              autoComplete="off"
              inputMode="text"
              placeholder="Scan, then Enter"
              onChange={(event) => { setValue(event.target.value); setProblem(null); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false);
              }}
            />
            <Button variant="primary" type="submit">Open</Button>
          </div>
          <small>USB and Bluetooth scanners type the job number here and press Enter.</small>
          {problem && <span className="barcode-error" role="alert">{problem}</span>}
        </form>
      )}
    </span>
  );
}
