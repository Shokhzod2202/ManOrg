import { describe, expect, it } from 'vitest';
import { batchCost, lineCost, unitsFor } from './batch-cost';

describe('batch cost (decided 2026-12-01)', () => {
  it('converts the amount to the pack unit and prices it', () => {
    // Flour: a 20 kg sack for 30,000 won; 10 kg costs 15,000.
    expect(lineCost(10, 'kg', 20, 'kg', 30_000)).toBe(15_000);
    // Oil: a 1.8 L bottle for 9,000 won; 500 mL costs 2,500.
    expect(lineCost(500, 'mL', 1.8, 'L', 9_000)).toBeCloseTo(2_500);
    // Sugar sold by 500 g for 1,000 won; 2 kg costs 4,000.
    expect(lineCost(2, 'kg', 500, 'g', 1_000)).toBe(4_000);
  });

  it('has no cost without an amount, a price or a matching unit', () => {
    expect(lineCost(null, 'kg', 20, 'kg', 30_000)).toBeNull();
    expect(lineCost(1, 'kg', 20, 'kg', null)).toBeNull();
    expect(lineCost(1, 'pc', 20, 'kg', 30_000)).toBeNull();
    expect(unitsFor('kg')).toEqual(['g', 'kg']);
    expect(unitsFor('pc')).toEqual(['pc']);
  });

  it('adds the lines, counts what is missing, and divides by the yield', () => {
    expect(batchCost([15_000, 2_500, null], 40)).toEqual({
      perBatch: 17_500,
      perPiece: 438,
      missing: 1,
    });
    expect(batchCost([null], 10)).toEqual({ perBatch: null, perPiece: null, missing: 1 });
    expect(batchCost([1_000], null)).toEqual({ perBatch: 1_000, perPiece: null, missing: 0 });
  });
});
