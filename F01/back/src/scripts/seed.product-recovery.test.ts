import { describe, expect, it, vi } from 'vitest';
import { Product, ProductError } from '../modules/product/product.domain.js';
import { saveSeedProductIfAbsent } from './seed.js';

const makeProduct = (id: string, vendorId = 'vendor') => Product.reconstruct({
  id, vendorId, categoryId: 'category', name: 'name', description: 'description', price: 1, quantity: 1, images: ['/original'],
});

describe('seed product conflict recovery', () => {
  it('fails closed for the same ID and vendor when seed identity cannot be established', async () => {
    const existing = makeProduct('first');
    existing.name = 'different seed entry';
    const repo = { save: vi.fn().mockRejectedValue(new Error(ProductError.PRODUCT_CONFLICT)), findById: vi.fn().mockResolvedValue(existing) };
    await expect(saveSeedProductIfAbsent(repo as any, makeProduct('first'))).rejects.toThrow('PRODUCT_CONFLICT');
    expect(existing.name).toBe('different seed entry');
  });

  it('does not treat a concurrent same-ID creation as a verified prior seed entry', async () => {
    const stored = new Map<string, Product>();
    const repo = {
      save: vi.fn(async (value: Product) => {
        if (stored.has(value.id)) throw new Error(ProductError.PRODUCT_CONFLICT);
        stored.set(value.id, value);
        return value;
      }),
      findById: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    const first = makeProduct('first');
    const second = makeProduct('first');
    second.name = 'different seed entry';
    const outcomes = await Promise.allSettled([saveSeedProductIfAbsent(repo as any, first), saveSeedProductIfAbsent(repo as any, second)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(stored.get('first')).toBe(first);
  });
  it('preserves an existing product and stops before later products on an unverified conflict', async () => {
    const original = makeProduct('first');
    const stored = new Map([['first', original]]);
    const repo = {
      save: vi.fn(async (value: Product) => {
        if (stored.has(value.id)) throw new Error(ProductError.PRODUCT_CONFLICT);
        stored.set(value.id, value);
        return value;
      }),
      findById: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    const candidates = [makeProduct('first'), makeProduct('second')];
    candidates[0].images = ['/replacement'];
    for (let run = 0; run < 2; run++) {
      await expect((async () => {
        for (const item of candidates) await saveSeedProductIfAbsent(repo as any, item);
      })()).rejects.toThrow(ProductError.PRODUCT_CONFLICT);
    }
    expect(stored.size).toBe(1);
    expect(stored.get('first')).toBe(original);
    expect(stored.get('first')!.images).toEqual(['/original']);
    expect(stored.has('second')).toBe(false);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('propagates conflicts without a matching ID or with an unexpected owner', async () => {
    for (const existing of [null, makeProduct('other'), makeProduct('first', 'other-vendor')]) {
      const repo = { save: vi.fn().mockRejectedValue(new Error(ProductError.PRODUCT_CONFLICT)), findById: vi.fn().mockResolvedValue(existing) };
      await expect(saveSeedProductIfAbsent(repo as any, makeProduct('first'))).rejects.toThrow(ProductError.PRODUCT_CONFLICT);
    }
  });

  it('does not suppress unrelated save errors or attempt verification reads', async () => {
    const read = vi.fn();
    const repo = { save: vi.fn().mockRejectedValueOnce(new Error('storage failure')).mockRejectedValueOnce(new Error(ProductError.PRODUCT_CONFLICT)), findById: read };
    await expect(saveSeedProductIfAbsent(repo as any, makeProduct('first'))).rejects.toThrow('storage failure');
    expect(read).not.toHaveBeenCalled();
    await expect(saveSeedProductIfAbsent(repo as any, makeProduct('first'))).rejects.toThrow(ProductError.PRODUCT_CONFLICT);
    expect(read).not.toHaveBeenCalled();
  });
});
