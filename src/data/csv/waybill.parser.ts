/**
 * The waybill export → dispatch orders.
 *
 * One row per order line, the shape Epicor's open-release BAQ produces:
 *
 *   InPicking, Cust. ID, On Hold, CreditHold, Ship Via, Description, Order,
 *   Line, Rel, Part, Selling Requested Qty, ShippedQty, LeftToShip,
 *   AllocatedQty, UOM, ExpDeliveryDt, Ship By, Need By, ReleaseVal,
 *   FulfillmentMethod, Status, City
 *
 * Columns are matched by header name, so the BAQ can be reordered. Dates are
 * Australian `d/mm/yyyy`.
 *
 * The order is the unit dispatch plans with, so lines are rolled up:
 * - **volume** is the order's freight line (`FRTNSW`, `FRTSEB`, … in `CBM`),
 *   the cube Epicor already calculated for the consignment;
 * - **readiness** comes from the goods lines (everything but `Other`): a line
 *   is ready when its `Status` is `Ready` or it is fully allocated.
 */

import { mapHeaders, parseCsv } from '@/lib/csv';
import {
  FREIGHT_VOLUME_PARTS,
  type DayKey,
  type Readiness,
  type ShipmentOrder,
  type WaybillLine,
} from '@/domain/dispatch';

const ALIASES = {
  inPicking: ['InPicking'],
  custId: ['Cust. ID', 'CustID', 'CustomerID'],
  onHold: ['On Hold', 'OnHold'],
  creditHold: ['CreditHold', 'Credit Hold'],
  shipVia: ['Ship Via', 'ShipVia', 'ShipViaCode'],
  zone: ['Description', 'ShipViaDescription'],
  order: ['Order', 'OrderNum'],
  line: ['Line', 'OrderLine'],
  rel: ['Rel', 'OrderRelNum'],
  part: ['Part', 'PartNum'],
  requestedQty: ['Selling Requested Qty', 'SellingReqQty'],
  shippedQty: ['ShippedQty', 'Shipped Qty'],
  leftToShip: ['LeftToShip', 'Left To Ship'],
  allocatedQty: ['AllocatedQty', 'Allocated Qty'],
  uom: ['UOM', 'IUM', 'SalesUM'],
  expDelivery: ['ExpDeliveryDt', 'Exp Delivery Dt'],
  shipBy: ['Ship By', 'ShipBy', 'ReqDate'],
  needBy: ['Need By', 'NeedBy', 'NeedByDate'],
  releaseValue: ['ReleaseVal', 'Release Val'],
  fulfillment: ['FulfillmentMethod', 'Fulfillment Method'],
  status: ['Status'],
  city: ['City', 'ShipToCity'],
} as const;

type Field = keyof typeof ALIASES;

/** Columns the dispatch plan cannot work without. */
const REQUIRED: Field[] = ['order', 'zone', 'shipBy'];

export interface WaybillParseResult {
  lines: WaybillLine[];
  orders: ShipmentOrder[];
  warnings: string[];
  /** Set when the file is not a waybill export at all. */
  error: string | null;
}

/** `d/mm/yyyy` (or ISO `yyyy-mm-dd`) to a day key; anything else is null. */
export function parseAuDate(raw: string): DayKey | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const au = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (!au) return null;
  const day = Number(au[1]);
  const month = Number(au[2]);
  const year = au[3].length === 2 ? 2000 + Number(au[3]) : Number(au[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const num = (raw: string | undefined): number => {
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
};

const bool = (raw: string | undefined): boolean =>
  /^(true|yes|y|1)$/i.test((raw ?? '').trim());

const FREIGHT = new Set<string>(FREIGHT_VOLUME_PARTS);

/** Is this a line whose quantity is the consignment's cube? */
export const isFreightVolumeLine = (line: WaybillLine): boolean =>
  FREIGHT.has(line.part.trim().toUpperCase()) && line.uom.trim().toUpperCase() === 'CBM';

const isGoodsLine = (line: WaybillLine): boolean =>
  line.fulfillment.trim().toLowerCase() !== 'other';

const isLineReady = (line: WaybillLine): boolean =>
  line.status.trim().toLowerCase() === 'ready' ||
  (line.leftToShip > 0 && line.allocatedQty >= line.leftToShip);

const mostCommon = (values: (string | null)[]): string | null => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
};

/** Roll an order's lines up into the unit dispatch plans with. */
export function toShipmentOrder(id: string, lines: WaybillLine[]): ShipmentOrder {
  const first = lines[0];
  const notes: string[] = [];

  const freight = lines.filter(isFreightVolumeLine);
  let volumeM3: number | null = null;
  if (freight.length > 0) {
    // One order carried both `FRTTAS` and `FRTSEB` with the same cube — the
    // same consignment priced twice, not two consignments. Take the largest
    // rather than double the volume, and say so.
    volumeM3 = Math.max(...freight.map((l) => l.leftToShip));
    if (freight.length > 1) {
      notes.push(
        `${freight.length} freight lines (${freight
          .map((l) => `${l.part} ${l.leftToShip}`)
          .join(', ')}) — largest used`,
      );
    }
  } else {
    notes.push('No freight (CBM) line — volume unknown');
  }

  const goods = lines.filter(isGoodsLine);
  const ready = goods.filter(isLineReady).length;
  const partial = goods.some((l) => l.status.trim().toUpperCase() === 'PARTIAL');
  const readiness: Readiness =
    goods.length === 0
      ? 'no-goods'
      : ready === goods.length
        ? 'ready'
        : ready > 0 || partial
          ? 'partial'
          : 'not-ready';

  const shipBy = mostCommon(lines.map((l) => l.shipBy));
  if (new Set(lines.map((l) => l.shipBy).filter(Boolean)).size > 1) {
    notes.push('Lines carry different Ship By dates — most common used');
  }
  if (!shipBy) notes.push('No Ship By date');

  return {
    id,
    custId: first.custId,
    shipVia: first.shipVia,
    zone: first.zone,
    city: first.city.replace(/ /g, ' ').trim(),
    shipBy,
    needBy: mostCommon(lines.map((l) => l.needBy)),
    expDelivery: mostCommon(lines.map((l) => l.expDelivery)),
    volumeM3,
    value: lines.reduce((sum, l) => sum + l.releaseValue, 0),
    lineCount: lines.length,
    goodsLines: goods.length,
    readyLines: ready,
    readiness,
    inPicking: lines.some((l) => l.inPicking),
    onHold: lines.some((l) => l.onHold),
    creditHold: lines.some((l) => l.creditHold),
    notes,
  };
}

export function parseWaybillCsv(text: string): WaybillParseResult {
  const rows = parseCsv(text);
  const empty = { lines: [], orders: [], warnings: [] };
  if (rows.length === 0) return { ...empty, error: 'The file is empty.' };

  const col = mapHeaders(rows[0], ALIASES);
  const missing = REQUIRED.filter((f) => col[f] === undefined);
  if (missing.length > 0) {
    return {
      ...empty,
      error:
        'Not a waybill export: no ' +
        missing.map((f) => `"${ALIASES[f][0]}"`).join(', ') +
        ' column.',
    };
  }

  const cell = (row: string[], f: Field): string => {
    const at = col[f];
    return at === undefined ? '' : (row[at] ?? '').trim();
  };

  const warnings: string[] = [];
  const lines: WaybillLine[] = [];
  rows.slice(1).forEach((row, i) => {
    if (row.every((c) => c.trim() === '')) return;
    const order = cell(row, 'order');
    if (!order) {
      warnings.push(`Row ${i + 2}: no Order number, skipped`);
      return;
    }
    const date = (f: Field): DayKey | null => {
      const raw = cell(row, f);
      const parsed = parseAuDate(raw);
      if (raw && !parsed) warnings.push(`Row ${i + 2}: unreadable ${ALIASES[f][0]} "${raw}"`);
      return parsed;
    };
    lines.push({
      order,
      line: cell(row, 'line'),
      rel: cell(row, 'rel'),
      custId: cell(row, 'custId'),
      shipVia: cell(row, 'shipVia'),
      zone: cell(row, 'zone'),
      city: cell(row, 'city'),
      part: cell(row, 'part'),
      requestedQty: num(cell(row, 'requestedQty')),
      shippedQty: num(cell(row, 'shippedQty')),
      leftToShip: num(cell(row, 'leftToShip')),
      allocatedQty: num(cell(row, 'allocatedQty')),
      uom: cell(row, 'uom'),
      expDelivery: date('expDelivery'),
      shipBy: date('shipBy'),
      needBy: date('needBy'),
      releaseValue: num(cell(row, 'releaseValue')),
      fulfillment: cell(row, 'fulfillment'),
      status: cell(row, 'status'),
      inPicking: bool(cell(row, 'inPicking')),
      onHold: bool(cell(row, 'onHold')),
      creditHold: bool(cell(row, 'creditHold')),
    });
  });

  const byOrder = new Map<string, WaybillLine[]>();
  for (const line of lines) {
    const list = byOrder.get(line.order);
    if (list) list.push(line);
    else byOrder.set(line.order, [line]);
  }
  const orders = [...byOrder].map(([id, ls]) => toShipmentOrder(id, ls));
  return { lines, orders, warnings, error: null };
}
