import { describe, expect, it, vi } from 'vitest';
import { Product, ProductError } from '../modules/product/product.domain.js';
import { MongoProductRepository } from '../modules/product/product.mongo.repository.js';
import { saveSeedProductIfAbsent } from './seed.js';

const makeProduct = (id: string, vendorId = 'vendor') => Product.reconstruct({
  id, vendorId, categoryId: 'category', name: 'name', description: 'description', price: 1, quantity: 1, images: ['/original'],
});

describe('seed product conflict recovery', () => {
  it('does not duplicate one seed identity when positional IDs differ', async () => {
    const stored = new Map<string, Product>();
    const repo = {
      save: vi.fn(async (value: Product) => {
        if (stored.has(value.id)) throw new Error(ProductError.PRODUCT_CONFLICT);
        stored.set(value.id, value);
        return value;
      }),
      findById: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    const first = Product.reconstruct({ ...makeProduct('position-1'), seedIdentity: 'seed-product:entry-a' } as any);
    const reordered = Product.reconstruct({ ...makeProduct('position-2'), seedIdentity: 'seed-product:entry-a' } as any);
    await saveSeedProductIfAbsent(repo as any, first);
    await saveSeedProductIfAbsent(repo as any, reordered);
    expect(stored.size).toBe(1);
  });
  it('recognizes matching durable identity while preserving edited fields', async () => {
    const existing = Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-a' } as any);
    existing.name = 'edited name';
    const candidate = Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-a' } as any);
    const repo = { save: vi.fn().mockRejectedValue(new Error(ProductError.PRODUCT_CONFLICT)), findById: vi.fn().mockResolvedValue(existing) };
    await expect(saveSeedProductIfAbsent(repo as any, candidate)).resolves.toBeUndefined();
    expect(existing.name).toBe('edited name');
  });

  it('accepts concurrent attempts only when the durable identity is the same', async () => {
    const stored = new Map<string, Product>();
    const repo = {
      save: vi.fn(async (value: Product) => {
        if (stored.has(value.id)) throw new Error(ProductError.PRODUCT_CONFLICT);
        stored.set(value.id, value);
        return value;
      }),
      findById: vi.fn(async (id: string) => stored.get(id) ?? null),
    };
    const entry = () => Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-a' } as any);
    const outcomes = await Promise.allSettled([saveSeedProductIfAbsent(repo as any, entry()), saveSeedProductIfAbsent(repo as any, entry())]);
    expect(outcomes.every(result => result.status === 'fulfilled')).toBe(true);
    expect(stored.size).toBe(1);
  });

  it('rejects different durable identities, different vendors and ambiguous legacy records', async () => {
    const candidate = Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-a' } as any);
    const records = [
      Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-b' } as any),
      Product.reconstruct({ ...makeProduct('first', 'other'), seedIdentity: 'seed-product:entry-a' } as any),
      makeProduct('first'),
    ];
    for (const existing of records) {
      const repo = { save: vi.fn().mockRejectedValue(new Error(ProductError.PRODUCT_CONFLICT)), findById: vi.fn().mockResolvedValue(existing) };
      await expect(saveSeedProductIfAbsent(repo as any, candidate)).rejects.toThrow(ProductError.PRODUCT_CONFLICT);
    }
  });

  it('persists and reconstructs the seed marker only on insertion', async () => {
    let document: any;
    const collection = {
      listIndexes: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ key: { seedIdentity: 1 }, unique: true, partialFilterExpression: { seedIdentity: { $type: 'string' } } }]) })),
      updateOne: vi.fn(async (query: any, update: any) => {
        document = { _id: query._id, ...update.$setOnInsert };
        return { upsertedCount: 1 };
      }),
      findOne: vi.fn(async () => document),
    };
    const repo = new MongoProductRepository({ collection: () => collection } as any);
    const candidate = Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-a' } as any);
    await repo.save(candidate);
    expect(document.seedIdentity).toBe('seed-product:entry-a');
    expect((await repo.findById('first'))?.seedIdentity).toBe('seed-product:entry-a');
    expect(collection.updateOne.mock.calls[0][1]).not.toHaveProperty('$set');
  });

  it('propagates uncertain write outcomes even when an identity might exist', async () => {
    const repo = { save: vi.fn().mockRejectedValue(new Error('ambiguous write')), findById: vi.fn() };
    const candidate = Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-a' } as any);
    await expect(saveSeedProductIfAbsent(repo as any, candidate)).rejects.toThrow('ambiguous write');
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('reports an ambiguous first write and permits a later verified retry without overwriting', async () => {
    let stored: Product | undefined;
    const repo = {
      save: vi.fn(async (value: Product) => {
        if (stored) throw new Error(ProductError.PRODUCT_CONFLICT);
        stored = value;
        throw new Error('ambiguous write');
      }),
      findById: vi.fn(async () => stored ?? null),
    };
    const candidate = Product.reconstruct({ ...makeProduct('first'), seedIdentity: 'seed-product:entry-a' } as any);
    await expect(saveSeedProductIfAbsent(repo as any, candidate)).rejects.toThrow('ambiguous write');
    await expect(saveSeedProductIfAbsent(repo as any, candidate)).resolves.toBeUndefined();
    expect(stored).toBe(candidate);
    expect(repo.save).toHaveBeenCalledTimes(2);
  });
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
