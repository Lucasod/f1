import { describe, it, expect, beforeEach } from 'vitest';
import {
  CouponError,
  canonicalCode,
  couponIdentity,
  safeMinor,
  sumMinor,
  priceToMinor,
  validateTerms,
  InMemoryCouponRepository,
} from './coupon.domain';

const baseTerms = {
  code: 'SAVE',
  discountType: 'percentBps' as const,
  value: 1000,
  startsAt: '2026-11-01T00:00:00Z',
  endsAt: '2026-12-01T00:00:00Z',
};

describe('Coupon Domain', () => {
  describe('canonicalCode', () => {
    it('should normalize a valid code to uppercase and trim whitespace', () => {
      expect(canonicalCode(' save ')).toBe('SAVE');
      expect(canonicalCode('save-10_off')).toBe('SAVE-10_OFF');
      expect(canonicalCode('a_b-c')).toBe('A_B-C');
    });

    it('should accept codes within the allowed length (1 to 64)', () => {
      expect(canonicalCode('A')).toBe('A');
      expect(canonicalCode('A'.repeat(64))).toBe('A'.repeat(64));
    });

    it('should reject empty or whitespace-only codes', () => {
      expect(() => canonicalCode('')).toThrow(CouponError);
      expect(() => canonicalCode('   ')).toThrow(CouponError);
      expect(() => canonicalCode('')).toThrowError('INVALID_COUPON');
    });

    it('should reject codes with disallowed characters', () => {
      expect(() => canonicalCode('SAVE!')).toThrow(CouponError);
      expect(() => canonicalCode('SAVE@X')).toThrow(CouponError);
      expect(() => canonicalCode('SAVE X')).toThrow(CouponError);
    });

    it('should reject codes longer than 64 characters', () => {
      expect(() => canonicalCode('A'.repeat(65))).toThrow(CouponError);
    });

    it('should reject non-string input', () => {
      expect(() => canonicalCode(null as unknown as string)).toThrow(CouponError);
      expect(() => canonicalCode(123 as unknown as string)).toThrow(CouponError);
      expect(() => canonicalCode(undefined as unknown as string)).toThrow(CouponError);
    });
  });

  describe('couponIdentity', () => {
    it('should produce a stable identity for the same vendor and code', () => {
      const a = couponIdentity('vendor-1', 'SAVE');
      const b = couponIdentity('vendor-1', 'save');
      expect(a).toBe(b);
      expect(a).toBe(JSON.stringify(['vendor-1', 'SAVE']));
    });

    it('should differentiate by vendor and by code', () => {
      expect(couponIdentity('vendor-1', 'SAVE')).not.toBe(couponIdentity('vendor-2', 'SAVE'));
      expect(couponIdentity('vendor-1', 'SAVE')).not.toBe(couponIdentity('vendor-1', 'OTHER'));
    });
  });

  describe('safeMinor', () => {
    it('should accept zero and positive safe integers', () => {
      expect(safeMinor(0)).toBe(0);
      expect(safeMinor(1)).toBe(1);
      expect(safeMinor(1000)).toBe(1000);
      expect(safeMinor(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should reject negative values', () => {
      expect(() => safeMinor(-1)).toThrow(CouponError);
      expect(() => safeMinor(-1)).toThrowError('INVALID_MONEY');
    });

    it('should reject non-integers and non-safe values', () => {
      expect(() => safeMinor(1.5)).toThrow(CouponError);
      expect(() => safeMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(CouponError);
      expect(() => safeMinor(NaN)).toThrow(CouponError);
      expect(() => safeMinor(Infinity)).toThrow(CouponError);
    });
  });

  describe('sumMinor', () => {
    it('should sum an array of minor amounts', () => {
      expect(sumMinor([])).toBe(0);
      expect(sumMinor([100, 200, 300])).toBe(600);
      expect(sumMinor([0, 0])).toBe(0);
    });

    it('should validate each element and the total', () => {
      expect(() => sumMinor([100, -5])).toThrow(CouponError);
      expect(() => sumMinor([100, 1.5])).toThrow(CouponError);
    });
  });

  describe('priceToMinor', () => {
    it('should convert major prices to minor cents', () => {
      expect(priceToMinor(10)).toBe(1000);
      expect(priceToMinor(10.01)).toBe(1001);
      expect(priceToMinor(0)).toBe(0);
      expect(priceToMinor(0.05)).toBe(5);
    });

    it('should reject negative, non-finite and sub-cent noise prices', () => {
      expect(() => priceToMinor(-1)).toThrow(CouponError);
      expect(() => priceToMinor(NaN)).toThrow(CouponError);
      expect(() => priceToMinor(Infinity)).toThrow(CouponError);
      // 0.005 BRL = 0.5 minor -> sub-cent noise is rejected
      expect(() => priceToMinor(0.005)).toThrow(CouponError);
    });
  });

  describe('validateTerms', () => {
    it('should accept valid percentBps terms', () => {
      const terms = validateTerms(baseTerms, 'vendor-1');
      expect(terms.code).toBe('SAVE');
      expect(terms.discountType).toBe('percentBps');
      expect(terms.value).toBe(1000);
      expect(terms.vendorId).toBe('vendor-1');
      expect(terms.revision).toBe(1);
      expect(terms.id).toBe(couponIdentity('vendor-1', 'SAVE'));
    });

    it('should accept valid fixedMinorBRL terms', () => {
      const terms = validateTerms({ ...baseTerms, discountType: 'fixedMinorBRL', value: 500 }, 'vendor-1');
      expect(terms.discountType).toBe('fixedMinorBRL');
      expect(terms.value).toBe(500);
    });

    it('should canonicalize and uppercase the code', () => {
      const terms = validateTerms({ ...baseTerms, code: ' save ' }, 'vendor-1');
      expect(terms.code).toBe('SAVE');
      expect(terms.id).toBe(couponIdentity('vendor-1', 'SAVE'));
    });

    it('should normalize dates to ISO canonical form', () => {
      const terms = validateTerms(
        { ...baseTerms, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' },
        'vendor-1'
      );
      expect(terms.startsAt).toBe('2026-11-01T00:00:00.000Z');
      expect(terms.endsAt).toBe('2026-12-01T00:00:00.000Z');
    });

    it('should sort include/exclude lists', () => {
      const terms = validateTerms(
        { ...baseTerms, includeProducts: ['p2', 'p1'], excludeCategories: ['cat-b', 'cat-a'] },
        'vendor-1'
      );
      expect(terms.includeProducts).toEqual(['p1', 'p2']);
      expect(terms.excludeCategories).toEqual(['cat-a', 'cat-b']);
    });

    it('should default include/exclude lists to empty arrays', () => {
      const terms = validateTerms(baseTerms, 'vendor-1');
      expect(terms.includeProducts).toEqual([]);
      expect(terms.excludeProducts).toEqual([]);
      expect(terms.includeCategories).toEqual([]);
      expect(terms.excludeCategories).toEqual([]);
    });

    it('should accept minimumEligibleMinor when provided', () => {
      const terms = validateTerms({ ...baseTerms, minimumEligibleMinor: 1000 }, 'vendor-1');
      expect(terms.minimumEligibleMinor).toBe(1000);
    });

    it('should reject non-object input', () => {
      expect(() => validateTerms(null as unknown as Record<string, unknown>, 'vendor-1')).toThrow(CouponError);
      expect(() => validateTerms('SAVE' as unknown as Record<string, unknown>, 'vendor-1')).toThrow(CouponError);
      expect(() => validateTerms([1, 2] as unknown as Record<string, unknown>, 'vendor-1')).toThrow(CouponError);
    });

    it('should reject disallowed keys', () => {
      expect(() =>
        validateTerms({ ...baseTerms, foo: 'bar' } as unknown as Record<string, unknown>, 'vendor-1')
      ).toThrow(CouponError);
    });

    it('should reject invalid discountType', () => {
      expect(() => validateTerms({ ...baseTerms, discountType: 'freeShipping' as any }, 'vendor-1')).toThrow(
        CouponError
      );
    });

    it('should reject zero value', () => {
      expect(() => validateTerms({ ...baseTerms, value: 0 }, 'vendor-1')).toThrow(CouponError);
    });

    it('should reject negative value', () => {
      expect(() => validateTerms({ ...baseTerms, value: -100 }, 'vendor-1')).toThrow(CouponError);
    });

    it('should reject percentBps value above 10000', () => {
      expect(() => validateTerms({ ...baseTerms, value: 10001 }, 'vendor-1')).toThrow(CouponError);
    });

    it('should reject malformed dates', () => {
      expect(() => validateTerms({ ...baseTerms, startsAt: 'bad' }, 'vendor-1')).toThrow(CouponError);
      expect(() => validateTerms({ ...baseTerms, startsAt: '2026-11-01' }, 'vendor-1')).toThrow(CouponError);
    });

    it('should reject startsAt equal to or after endsAt', () => {
      expect(() => validateTerms({ ...baseTerms, startsAt: '2026-12-01T00:00:00Z' }, 'vendor-1')).toThrow(
        CouponError
      );
      expect(() => validateTerms({ ...baseTerms, startsAt: '2026-12-02T00:00:00Z' }, 'vendor-1')).toThrow(
        CouponError
      );
    });

    it('should reject duplicate or empty list entries and oversized lists', () => {
      expect(() => validateTerms({ ...baseTerms, includeProducts: ['p1', 'p1'] }, 'vendor-1')).toThrow(CouponError);
      expect(() => validateTerms({ ...baseTerms, includeProducts: [''] }, 'vendor-1')).toThrow(CouponError);
      expect(() => validateTerms({ ...baseTerms, includeProducts: ['   '] }, 'vendor-1')).toThrow(CouponError);
      expect(() =>
        validateTerms({ ...baseTerms, includeProducts: Array(201).fill('p') }, 'vendor-1')
      ).toThrow(CouponError);
      expect(() => validateTerms({ ...baseTerms, includeProducts: ['p'.repeat(201)] }, 'vendor-1')).toThrow(
        CouponError
      );
    });

    it('should reject invalid minimumEligibleMinor', () => {
      expect(() => validateTerms({ ...baseTerms, minimumEligibleMinor: -1 }, 'vendor-1')).toThrow(CouponError);
      expect(() => validateTerms({ ...baseTerms, minimumEligibleMinor: 1.5 }, 'vendor-1')).toThrow(CouponError);
    });
  });

  describe('InMemoryCouponRepository', () => {
    let repo: InMemoryCouponRepository;

    beforeEach(() => {
      repo = new InMemoryCouponRepository();
    });

    it('should insert, find and list terms for a vendor', async () => {
      const terms = validateTerms(baseTerms, 'vendor-1');
      await repo.insert(terms);

      const found = await repo.find('vendor-1', 'SAVE');
      expect(found).not.toBeNull();
      expect(found!.code).toBe('SAVE');
      expect(found!.vendorId).toBe('vendor-1');

      const list = await repo.list('vendor-1');
      expect(list).toHaveLength(1);
      expect(list[0].code).toBe('SAVE');

      expect(await repo.list('vendor-2')).toEqual([]);
      expect(await repo.find('vendor-1', 'OTHER')).toBeNull();
    });

    it('should reject duplicate insert with COUPON_CONFLICT', async () => {
      const terms = validateTerms(baseTerms, 'vendor-1');
      await repo.insert(terms);
      await expect(repo.insert(terms)).rejects.toMatchObject({ code: 'COUPON_CONFLICT' });
    });

    it('should treat canonicalized codes as the same identity', async () => {
      const terms = validateTerms({ ...baseTerms, code: ' save ' }, 'vendor-1');
      await repo.insert(terms);
      await expect(
        repo.insert(validateTerms({ ...baseTerms, code: 'SAVE', value: 999 } as any, 'vendor-1'))
      ).rejects.toMatchObject({ code: 'COUPON_CONFLICT' });
    });

    it('should return detached clones so callers cannot mutate stored terms', async () => {
      const terms = validateTerms({ ...baseTerms, includeProducts: ['p1'] }, 'vendor-1');
      await repo.insert(terms);

      const found = await repo.find('vendor-1', 'SAVE')!;
      found.includeProducts.push('mutated');

      const again = await repo.find('vendor-1', 'SAVE')!;
      expect(again.includeProducts).toEqual(['p1']);

      const listed = (await repo.list('vendor-1'))[0];
      listed.includeProducts.push('mutated-too');
      expect((await repo.find('vendor-1', 'SAVE')!)!.includeProducts).toEqual(['p1']);
    });

    it('should isolate vendors in list and reject same-vendor duplicates', async () => {
      await repo.insert(validateTerms({ ...baseTerms, code: 'FIRST' }, 'vendor-1'));
      await repo.insert(validateTerms({ ...baseTerms, code: 'SECOND' }, 'vendor-1'));
      await repo.insert(validateTerms({ ...baseTerms, code: 'OTHER' }, 'vendor-2'));

      const list1 = await repo.list('vendor-1');
      expect(list1.map(t => t.code).sort()).toEqual(['FIRST', 'SECOND']);

      const list2 = await repo.list('vendor-2');
      expect(list2.map(t => t.code)).toEqual(['OTHER']);

      await expect(repo.insert(validateTerms({ ...baseTerms, code: 'FIRST' }, 'vendor-1'))).rejects.toMatchObject({
        code: 'COUPON_CONFLICT',
      });
    });
  });
});
