import { describe, expect, it, vi } from 'vitest';
import { Product } from './product.domain';
import { MongoProductRepository } from './product.mongo.repository';

const seededProduct = () => Product.reconstruct({ id: 'p', vendorId: 'v', categoryId: 'c', name: 'n', description: 'd', price: 1, quantity: 1, seedIdentity: 'seed:entry' });

describe('seed identity storage prerequisite', () => {
  it('does not write a seed product without a verified unique partial identity index', async () => {
    const updateOne = vi.fn();
    const listIndexes = vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([{ key: { _id: 1 }, unique: true }]) }));
    const repo = new MongoProductRepository({ collection: () => ({ updateOne, listIndexes }) } as any);
    await expect(repo.save(seededProduct())).rejects.toThrow('PRODUCT_SEED_INDEX_UNAVAILABLE');
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('fails closed if index inspection fails', async () => {
    const updateOne = vi.fn();
    const listIndexes = vi.fn(() => ({ toArray: vi.fn().mockRejectedValue(new Error('inspection failed')) }));
    const repo = new MongoProductRepository({ collection: () => ({ updateOne, listIndexes }) } as any);
    await expect(repo.save(seededProduct())).rejects.toThrow('PRODUCT_SEED_INDEX_UNAVAILABLE');
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('rejects a unique index that excludes some string identities', async () => {
    const updateOne = vi.fn();
    const index = { key: { seedIdentity: 1 }, unique: true, partialFilterExpression: { seedIdentity: { $type: 'string' }, vendorId: 'v' } };
    const repo = new MongoProductRepository({ collection: () => ({ updateOne, listIndexes: () => ({ toArray: async () => [index] }) }) } as any);
    await expect(repo.save(seededProduct())).rejects.toThrow('PRODUCT_SEED_INDEX_UNAVAILABLE');
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('permits a seed insert only after the precise unique partial index is observed', async () => {
    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 });
    const index = { key: { seedIdentity: 1 }, unique: true, partialFilterExpression: { seedIdentity: { $type: 'string' } } };
    const repo = new MongoProductRepository({ collection: () => ({ updateOne, listIndexes: () => ({ toArray: async () => [index] }) }) } as any);
    await expect(repo.save(seededProduct())).resolves.toMatchObject({ seedIdentity: 'seed:entry' });
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});
