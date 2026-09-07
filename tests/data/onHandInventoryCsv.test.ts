import { describe, expect, it } from 'vitest';
import { parseOnHandInventoryCsv } from '@/data/csv/onHandInventory.parser';

describe('OnHandInventory.csv', () => {
  it('joins the requested columns and sums repeated part locations', () => {
    const result = parseOnHandInventoryCsv([
      'Part_PartNum,Calculated_OnHand,Warehouse',
      'P-100,"1,250",MAIN',
      'P-100,25,SECONDARY',
      'P-200,-3,MAIN',
    ].join('\n'));
    expect(result.errors).toEqual([]);
    expect(result.values.map((item) => ({
      part: String(item.partNum), onHand: item.onHand,
    }))).toEqual([
      { part: 'P-100', onHand: 1275 },
      { part: 'P-200', onHand: -3 },
    ]);
  });

  it('requires Part_PartNum and Calculated_OnHand and reports invalid values', () => {
    expect(parseOnHandInventoryCsv('Part,Qty\nP-1,2').errors[0])
      .toContain('Part_PartNum');
    const result = parseOnHandInventoryCsv(
      'Part_PartNum,Calculated_OnHand\nP-1,not-a-number\nP-2,4',
    );
    expect(result.errors).toHaveLength(1);
    expect(result.values).toHaveLength(1);
  });
});
