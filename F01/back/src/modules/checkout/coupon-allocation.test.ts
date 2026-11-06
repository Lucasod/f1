import { describe, it, expect } from 'vitest';
import { allocateCouponDiscount } from './coupon-allocation';

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
