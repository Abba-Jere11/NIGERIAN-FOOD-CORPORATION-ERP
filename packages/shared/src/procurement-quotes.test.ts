import { describe, expect, it } from 'vitest';
import { MIN_VENDOR_QUOTATIONS, recommendLowestQuote } from './procurement';

describe('recommendLowestQuote', () => {
  it('recommends the vendor with the lowest quoted total', () => {
    expect(
      recommendLowestQuote([
        { vendorId: 'a', amountKobo: 500_000 },
        { vendorId: 'b', amountKobo: 420_000 },
        { vendorId: 'c', amountKobo: 610_000 },
      ]),
    ).toEqual({ lowestAmountKobo: 420_000, recommendedVendorIds: ['b'] });
  });

  it('recommends every vendor that ties on the lowest price', () => {
    expect(
      recommendLowestQuote([
        { vendorId: 'a', amountKobo: 400_000 },
        { vendorId: 'b', amountKobo: 400_000 },
        { vendorId: 'c', amountKobo: 410_000 },
      ]).recommendedVendorIds,
    ).toEqual(['a', 'b']);
  });

  it('ignores quotations without a vendor or a price', () => {
    expect(
      recommendLowestQuote([
        { vendorId: null, amountKobo: 1 },
        { vendorId: 'a', amountKobo: null },
        { vendorId: 'b', amountKobo: 300_000 },
      ]),
    ).toEqual({ lowestAmountKobo: 300_000, recommendedVendorIds: ['b'] });
    expect(recommendLowestQuote([])).toEqual({ lowestAmountKobo: null, recommendedVendorIds: [] });
  });

  it('requires at least two quotations', () => {
    expect(MIN_VENDOR_QUOTATIONS).toBe(2);
  });
});
