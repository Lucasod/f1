import { describe, expect, it, vi } from 'vitest';
import { MongoProductRepository } from './product.mongo.repository';

describe('seed image repair', () => {
  it('updates only an unchanged legacy fixture and enqueues search synchronization', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const repo = new MongoProductRepository({ collection: () => ({ updateOne }) } as never);
    expect(await repo.repairSeedImage('product', 'vendor', 'seed-id', 'seed/products/old/main.webp')).toBe(true);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: 'product', vendorId: 'vendor', seedIdentity: 'seed-id', images: ['seed/products/old/main.webp'] });
    expect(update.$set).toMatchObject({ images: ['products/vendor/product/main.webp'], searchPending: true });
    expect(update.$inc).toEqual({ searchRevision: 1 });
  });
  it('leaves an edited or missing image unchanged', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    const repo = new MongoProductRepository({ collection: () => ({ updateOne }) } as never);
    expect(await repo.repairSeedImage('product', 'vendor', 'seed-id', 'seed/products/old/main.webp')).toBe(false);
  });
});
