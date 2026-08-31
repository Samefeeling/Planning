/**
 * The `Planning1.csv` adapter, tested against the real sample rows.
 *
 * The fixture is the four rows Resero sent, verbatim apart from a quoted
 * description added to exercise the CSV reader.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parsePlanningCsv } from '@/data/csv/planning.parser';
import { parseCsv, normalizeHeader, mapHeaders } from '@/lib/csv';

const sample = readFileSync(
  fileURLToPath(new URL('../fixtures/planning1.sample.csv', import.meta.url)),
  'utf8',
);

const byId = (text: string) =>
  new Map(parsePlanningCsv(text).values.map((j) => [String(j.id), j]));

describe('parseCsv', () => {
  it('keeps a comma inside a quoted field', () => {
    const rows = parseCsv('a,b\n"one, two",3\n');
    expect(rows[1]).toEqual(['one, two', '3']);
  });

  it('handles escaped quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"say ""hi""",2\r\n');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['say "hi"', '2']);
  });

  it('reads the last row when the file has no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
  });
});

describe('header matching', () => {
  it('ignores the BAQ table prefix', () => {
    expect(normalizeHeader('JobHead_ReqDueDate')).toBe('reqduedate');
    expect(normalizeHeader('Calculated_LaborHrs')).toBe(
      normalizeHeader('LaborHrs'),
    );
  });

  it('finds columns wherever they sit', () => {
    const at = mapHeaders(['Calculated_LaborHrs', 'JobHead_JobNum'], {
      jobNum: ['JobNum'],
      laborHrs: ['LaborHrs'],
      missing: ['Nope'],
    });
    expect(at).toEqual({ jobNum: 1, laborHrs: 0 });
  });
});

describe('parsePlanningCsv', () => {
  const jobs = byId(sample);

  it('reads every order', () => {
    expect([...jobs.keys()]).toEqual([
      'SFM507615',
      'SFM507616',
      '018140-1-1',
      '018321-2-1',
    ]);
  });

  it('splits PMD rows from assembly rows', () => {
    expect(jobs.get('SFM507615')!.department).toBe('moulding');
    expect(jobs.get('SFM507615')!.preferredMachine).toBe('PMD');
    expect(jobs.get('SFM507615')!.line).toBeNull();

    expect(jobs.get('018140-1-1')!.department).toBe('assembly');
    expect(String(jobs.get('018140-1-1')!.line)).toBe('ASSY');
  });

  it('takes the export’s labour hours as the bar length', () => {
    expect(jobs.get('018140-1-1')!.laborHrs).toBeCloseTo(2.1, 5);
  });

  it('derives labour hours from qty x ProdStandard when the column is absent', () => {
    const withoutHours = [
      'JobHead_JobNum,JobHead_PartNum,JobHead_Department,Calculated_RemainingQty,JobOper_ProdStandard',
      '018321-2-1,DETR00081,ASSY,4,0.41667',
    ].join('\n');
    // 4 pcs x 0.41667 h/pc = 1.667 h, matching the export's own 1.67.
    expect(byId(withoutHours).get('018321-2-1')!.laborHrs).toBeCloseTo(
      1.667,
      3,
    );
  });

  it('inverts ProdStandard into a run rate', () => {
    expect(jobs.get('018140-1-1')!.qtyPerHr).toBeCloseTo(1 / 0.07, 6);
  });

  it('reads completed qty as ProdQty minus RemainingQty', () => {
    expect(jobs.get('018140-1-1')!.completedQty).toBe(0);

    const partlyDone = sample.replace(
      '018140-1-1,CSSL01436,"Cosmic Stool, walnut",ASSY,30,30',
      '018140-1-1,CSSL01436,"Cosmic Stool, walnut",ASSY,30,18',
    );
    const j = byId(partlyDone).get('018140-1-1')!;
    expect(j.completedQty).toBe(12);
    expect(j.remainingQty).toBe(18);
  });

  it('maps ReqDueDate to the due date and StartDate to the start', () => {
    const j = jobs.get('SFM507615')!;
    expect(j.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(j.startDate?.toISOString().slice(0, 10)).toBe('2026-09-29');
  });

  it('infers Final Assembly for lines that run only that', () => {
    expect(jobs.get('018140-1-1')!.orderType).toBe('final-assembly');
  });

  it('leaves the order type blank for UPL, which runs two of them', () => {
    const upl = sample.replace(
      '"Cosmic Stool, walnut",ASSY',
      '"Cosmic Stool, walnut",UPL',
    );
    expect(byId(upl).get('018140-1-1')!.orderType).toBeNull();
  });

  it('has no ship date to colour against — the export carries none', () => {
    expect(jobs.get('018140-1-1')!.shipDate).toBeNull();
  });

  it('reads a ship date once the column exists', () => {
    const withShip = sample
      .replace('JobHead_StartHour', 'JobHead_StartHour,JobHead_ShipDate')
      .replace('21.9\n', '21.9,2026-09-14T00:00:00\n');
    expect(
      byId(withShip).get('018140-1-1')!.shipDate?.toISOString().slice(0, 10),
    ).toBe('2026-09-14');
  });

  it('finds the PMD/ASSY column by its values when the header is unfamiliar', () => {
    const renamed = sample.replace(
      'JobHead_Department',
      'JobHead_ResourceGrpID_Something',
    );
    const j = byId(renamed);
    expect(j.get('SFM507615')!.department).toBe('moulding');
    expect(String(j.get('018140-1-1')!.line)).toBe('ASSY');
  });

  it('treats a named press as a moulding row', () => {
    const press = sample.replace('Encore,PMD', 'Encore,1300T');
    const j = byId(press).get('SFM507615')!;
    expect(j.department).toBe('moulding');
    expect(String(j.preferredMachine)).toBe('1300T');
  });

  it('reports the headers it saw when a required column is missing', () => {
    const { values, errors } = parsePlanningCsv('Foo,Bar\n1,2\n');
    expect(values).toHaveLength(0);
    expect(errors[0]).toContain('jobNum');
    expect(errors[0]).toContain('Foo, Bar');
  });

  it('skips spacer rows and keeps the first of a duplicated job', () => {
    const messy = sample + ',,,,,,,,,,\nSFM507615,7911FR,Dupe,PMD,9,9,,,0.5,,\n';
    const parsed = parsePlanningCsv(messy);
    expect(parsed.values).toHaveLength(4);
    expect(parsed.values[0].description).toBe('Encore');
  });
});
