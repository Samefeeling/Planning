/**
 * The waybill adapter: lines rolled up into orders, volume from the freight
 * line, readiness from the goods lines. The fixture is synthetic, in the
 * export's exact column layout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parseAuDate, parseWaybillCsv } from '@/data/csv/waybill.parser';

const sample = readFileSync(
  fileURLToPath(new URL('../fixtures/waybill.sample.csv', import.meta.url)),
  'utf8',
);

const parsed = parseWaybillCsv(sample);
const order = (id: string) => parsed.orders.find((o) => o.id === id)!;

describe('parseAuDate', () => {
  it('reads Australian day-first dates', () => {
    expect(parseAuDate('5/02/2027')).toBe('2027-02-05');
    expect(parseAuDate('14/10/2026')).toBe('2026-10-14');
  });

  it('rejects impossible dates and blanks', () => {
    expect(parseAuDate('31/02/2026')).toBeNull();
    expect(parseAuDate('')).toBeNull();
    expect(parseAuDate('next week')).toBeNull();
  });
});

describe('parseWaybillCsv', () => {
  it('rolls lines up into one order each', () => {
    expect(parsed.error).toBeNull();
    expect(parsed.lines).toHaveLength(23);
    expect(parsed.orders).toHaveLength(12);
  });

  it('takes the volume from the freight CBM line and ignores the FRT911 charge', () => {
    expect(order('90001').volumeM3).toBe(10);
    expect(order('90001').value).toBeCloseTo(8918.75);
  });

  it('keeps the source values: zone, city, ship via, dates', () => {
    const o = order('90006');
    expect(o.zone).toBe('QLD- Metro');
    expect(o.shipVia).toBe('AQMC');
    expect(o.shipBy).toBe('2026-10-16');
    expect(o.needBy).toBe('2026-10-30');
  });

  it('reads readiness from the goods lines only', () => {
    expect(order('90001').readiness).toBe('ready');
    expect(order('90001').inPicking).toBe(true);
    expect(order('90003').readiness).toBe('not-ready');
    expect(order('90009').readiness).toBe('partial');
    expect(order('90011').readiness).toBe('no-goods');
  });

  it('flags an order with no freight line as unknown volume', () => {
    expect(order('90009').volumeM3).toBeNull();
    expect(order('90009').notes.join()).toMatch(/volume unknown/);
  });

  it('does not double a consignment priced on two freight lines', () => {
    expect(order('90011').volumeM3).toBe(2.2);
    expect(order('90011').notes.join()).toMatch(/largest used/);
  });

  it('reads the credit hold', () => {
    expect(order('90008').creditHold).toBe(true);
    expect(order('90001').creditHold).toBe(false);
  });

  it('refuses a file that is not a waybill', () => {
    const result = parseWaybillCsv('JobNum,PartNum\nA,B\n');
    expect(result.error).toMatch(/Not a waybill export/);
    expect(result.orders).toHaveLength(0);
  });
});
