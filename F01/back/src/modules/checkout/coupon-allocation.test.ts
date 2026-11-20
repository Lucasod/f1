import { describe, it, expect } from 'vitest';
import { allocateCouponDiscount, allocateMinorDiscount } from './coupon-allocation';

describe('allocateCouponDiscount', () => {
  it('preserves exact total in minor units', () => {
    const alloc = allocateCouponDiscount(100, [30, 70]);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(100);
    expect(alloc).toEqual([30, 70]);
  });

  it('returns integers (minor-unit divisibility)', () => {
    const alloc = allocateCouponDiscount(100, [1, 1, 1]);
    expect(alloc.every((n) => Number.isInteger(n))).toBe(true);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('returns empty array for empty eligible set', () => {
    expect(allocateCouponDiscount(100, [])).toEqual([]);
  });

  it('returns zeros for empty eligible set with zero total', () => {
    expect(allocateCouponDiscount(0, [])).toEqual([]);
  });

  it('is repeatable (stable)', () => {
    const a = allocateCouponDiscount(10, [1, 1, 1]);
    const b = allocateCouponDiscount(10, [1, 1, 1]);
    expect(a).toEqual(b);
  });

  it('produces no negative allocations', () => {
    const alloc = allocateCouponDiscount(5, [10, 20, 30]);
    expect(alloc.every((n) => n >= 0)).toBe(true);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('handles rounding boundary cases via largest remainder tie-break by input order', () => {
    // 10 / 3 weights equal -> 4,3,3 (first gets extra)
    expect(allocateCouponDiscount(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it('zero total yields zeros', () => {
    expect(allocateCouponDiscount(0, [10, 20])).toEqual([0, 0]);
  });
});

describe('exact quote allocation', () => {
  it('breaks equal remainders by identity, not input order', () => {
    expect(allocateMinorDiscount(1, [{ key: 'b', weight: 3 }, { key: 'a', weight: 3 }])).toEqual([0, 1]);
    expect(allocateMinorDiscount(1, [{ key: 'a', weight: 3 }, { key: 'b', weight: 3 }])).toEqual([1, 0]);
  });
  it('uses exact rational products near safe integer limits', () => {
    const half = 4503599627370495;
    const result = allocateMinorDiscount(half, [{ key: 'a', weight: half }, { key: 'b', weight: half }]);
    expect(result).toEqual([2251799813685248, 2251799813685247]);
    expect(result[0] + result[1]).toBe(half);
  });
  it('rejects overflow, fractional or negative values, duplicate identities and discounts above the base', () => {
    for (const value of [-1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => allocateMinorDiscount(value, [{ key: 'a', weight: 10 }])).toThrow();
    expect(() => allocateMinorDiscount(1, [{ key: 'a', weight: Number.MAX_SAFE_INTEGER }, { key: 'b', weight: 1 }])).toThrow();
    expect(() => allocateMinorDiscount(1, [{ key: 'a', weight: 1 }, { key: 'a', weight: 1 }])).toThrow();
    expect(() => allocateMinorDiscount(2, [{ key: 'a', weight: 1 }])).toThrow();
    expect(allocateMinorDiscount(0, [{ key: 'a', weight: 0 }])).toEqual([0]);
  });
});
