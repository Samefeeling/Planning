/**
 * Open purchase orders from PODetail.csv, and telling the four Epicor exports
 * apart by their header rows when they are picked together.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePoDetailCsv } from '@/data/csv/poDetail.parser';
import { exportKind } from '@/data/csv/pickedFiles';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');

describe('parsePoDetailCsv', () => {
  it('reads the outstanding quantity and the release dates', () => {
    const { values, errors } = parsePoDetailCsv(
      [
        'PODetail_PONUM,PODetail_POLine,PODetail_PartNum,PORel_DueDate,PORel_PromiseDt,Calculated_OutstandingQty,POHeader_BuyerID',
        '4501,1,V11694,2026-10-14T00:00:00,2026-10-16T00:00:00,"1,200",KB',
        '4502,2,FIX-M6-KIT,2026-10-20,,0,KB',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(values).toHaveLength(1); // nothing left to come on the second
    expect(values[0]).toMatchObject({ partNum: 'V11694', poNum: '4501/1', outstandingQty: 1200, buyer: 'KB' });
    expect(values[0].dueDate).toEqual(new Date(2026, 9, 14));
    expect(values[0].promiseDate).toEqual(new Date(2026, 9, 16));
  });

  it('works out what is to come from release and received quantities, and skips closed releases', () => {
    const { values } = parsePoDetailCsv(
      [
        'PORel_PONum,PORel_POLine,PODetail_PartNum,PORel_RelQty,PORel_ReceivedQty,PORel_DueDate,PORel_OpenRelease',
        '77,1,AB-1,100,40,14/10/2026,True',
        '77,2,AB-2,50,0,15/10/2026,False',
      ].join('\n'),
    );
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ partNum: 'AB-1', outstandingQty: 60 });
    expect(values[0].dueDate).toEqual(new Date(2026, 9, 14));
  });

  it('says which columns it needs', () => {
    const { values, errors } = parsePoDetailCsv('PONum,Vendor\n1,ACME');
    expect(values).toEqual([]);
    expect(errors[0]).toMatch(/PODetail_PartNum/);
  });
});

describe('exportKind', () => {
  it('recognises each export by its header row', () => {
    expect(exportKind(fixture('planning1.sample.csv'))).toBe('orders');
    expect(exportKind(fixture('jobMaterialReq.sample.csv'))).toBe('links');
    expect(exportKind('Part_PartNum,Calculated_OnHand\nA,1')).toBe('inventory');
    expect(exportKind('PODetail_PONUM,PODetail_PartNum,Calculated_OutstandingQty\n1,A,2')).toBe('po');
  });

  it('refuses a file that is none of them, the waybill included', () => {
    expect(exportKind(fixture('waybill.sample.csv'))).toBeNull();
    expect(exportKind('a,b\n1,2')).toBeNull();
  });
});
