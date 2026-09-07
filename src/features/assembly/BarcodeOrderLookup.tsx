/** Keyboard-wedge barcode lookup: scan a job number and open its order popup. */

import { useEffect, useRef, useState } from 'react';
import type { AssemblyGanttView } from '@/engine/assembly/board';
import { useUiStore } from '@/store/uiStore';
import { createBarcodeBuffer } from './barcodeScanner';
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

  useEffect(() => {
    if (!board) return;
    const scanner = createBarcodeBuffer((raw) => {
      const jobId = findBarcodeJobId(raw, board.rowsByJob.keys());
      if (!jobId) {
        setValue(raw);
        setProblem(`Order not found: ${raw}`);
        setOpen(true);
        return;
      }
      // Use the same selection action as clicking an order on the board.
      select(jobId, { x: window.innerWidth / 2, y: 90 });
      setValue('');
      setProblem(null);
      setOpen(false);
    });
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof Element && (
        target.closest('input, textarea, select, [role="textbox"]') !== null ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
      const blocked = editing || event.isComposing || event.repeat ||
        event.ctrlKey || event.altKey || event.metaKey ||
        document.visibilityState !== 'visible' || !document.hasFocus();
      if (scanner.push(event.key, event.timeStamp, blocked)) {
        // The scanner's suffix must not activate a focused button or submit a form.
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const reset = () => scanner.reset();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [board, select]);

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
      <Button onClick={() => setOpen((current) => !current)} title="Scan anywhere on the focused board, or click to enter an order number">
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
          <small>Scan anywhere on the focused board with Enter or Tab as the scanner suffix. While editing a field, click outside it before scanning. You can also enter an order here.</small>
          {problem && <span className="barcode-error" role="alert">{problem}</span>}
        </form>
      )}
    </span>
  );
}
