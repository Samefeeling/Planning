/**
 * Open purchase-order receipts from `PODetail.csv`, the Epicor PO export.
 * One row per release (or per line, when the BAQ does not join releases):
 * which part is coming, how many are still to be received, and when.
 *
 * It feeds the same `PoLine` the master workbook's `po` sheet does, so a short
 * component on an order's pick list can say which PO covers it and from when.
 *
 * Columns are matched by header name, as in the other exports. What is still
 * to come is `Calculated_OutstandingQty` when the BAQ has it, else the
 * release (or line) quantity less what has been received. Closed lines and
 * releases, and rows with nothing outstanding, are skipped.
 */

import { PartId } from '@/domain/ids';
import type { PoLine } from '@/domain/types';
import { mapHeaders, parseCsv, type CsvRow } from '@/lib/csv';
import type { ParseOutcome } from '@/data/excel/parsers/types';

type Field =
  | 'poNum'
  | 'poLine'
  | 'part'
  | 'outstanding'
  | 'orderQty'
  | 'receivedQty'
  | 'dueDate'
  | 'promiseDate'
  | 'buyer'
  | 'open';

/** Accepted header spellings per field, most specific first. */
const ALIASES: Record<Field, readonly string[]> = {
  poNum: ['PODetail_PONUM', 'PORel_PONum', 'POHeader_PONum', 'PONum', 'PO'],
  poLine: ['PODetail_POLine', 'PORel_POLine', 'POLine'],
  part: ['PODetail_PartNum', 'PORel_PartNum', 'PartNum', 'Part'],
  outstanding: ['OutstandingQty', 'Calculated_OutstandingQty', 'OpenQty', 'RemainingQty', 'BalanceQty'],
  orderQty: ['PORel_RelQty', 'PORel_XRelQty', 'PODetail_OrderQty', 'PODetail_XOrderQty', 'RelQty', 'OrderQty'],
  receivedQty: ['PORel_ReceivedQty', 'PODetail_ReceivedQty', 'ReceivedQty', 'OurReceivedQty'],
  dueDate: ['PORel_DueDate', 'PODetail_DueDate', 'DueDate'],
  promiseDate: ['PORel_PromiseDt', 'PODetail_PromiseDt', 'PromiseDt', 'PromiseDate'],
  buyer: ['POHeader_BuyerID', 'BuyerID', 'Buyer'],
  open: ['PORel_OpenRelease', 'PODetail_OpenLine', 'OpenRelease', 'OpenLine'],
};

const cell = (row: CsvRow, at: number | undefined): string =>
  at === undefined ? '' : (row[at] ?? '').trim();

const num = (v: string): number | null => {
  if (v === '') return null;
  const n = Number(v.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Same reading as `planning.parser`: a bare `YYYY-MM-DD` is local midnight. */
const date = (v: string): Date | null => {
  if (v === '') return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const d = ymd
    ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    : dmy
      ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
      : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const CLOSED = new Set(['false', '0', 'no', 'n', 'closed']);

/** Does this header row look like the PO export? */
export function isPoDetailHeader(header: CsvRow): boolean {
  const col = mapHeaders<Field>(header, ALIASES);
  return (
    col.poNum !== undefined &&
    col.part !== undefined &&
    (col.outstanding !== undefined || col.orderQty !== undefined)
  );
}

/** Parse the text of `PODetail.csv` into open PO receipts. */
export function parsePoDetailCsv(text: string): ParseOutcome<PoLine> {
  const rows = parseCsv(text);
  if (rows.length === 0) return { values: [], errors: ['PODetail.csv is empty'] };
  const header = rows[0];
  const col = mapHeaders<Field>(header, ALIASES);
  if (col.part === undefined || (col.outstanding === undefined && col.orderQty === undefined)) {
    return {
      values: [],
      errors: [
        'PODetail.csv needs a part column (PODetail_PartNum) and an outstanding or order quantity ' +
          `(Calculated_OutstandingQty, PORel_RelQty). Headers found: ${header.join(', ')}`,
      ],
    };
  }

  const values: PoLine[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((row, i) => {
    const part = cell(row, col.part);
    if (!part) return;
    if (CLOSED.has(cell(row, col.open).toLowerCase())) return;
    const outstanding =
      col.outstanding !== undefined
        ? num(cell(row, col.outstanding))
        : (() => {
            const ordered = num(cell(row, col.orderQty));
            return ordered === null ? null : ordered - (num(cell(row, col.receivedQty)) ?? 0);
          })();
    if (outstanding === null) {
      errors.push(`PODetail.csv row ${i + 2}: no quantity for ${part}`);
      return;
    }
    if (outstanding <= 0) return;
    const po = cell(row, col.poNum);
    const line = cell(row, col.poLine);
    values.push({
      partNum: PartId(part),
      poNum: po ? (line ? `${po}/${line}` : po) : null,
      outstandingQty: outstanding,
      dueDate: date(cell(row, col.dueDate)),
      promiseDate: date(cell(row, col.promiseDate)),
      buyer: cell(row, col.buyer) || null,
    });
  });
  return { values, errors };
}
