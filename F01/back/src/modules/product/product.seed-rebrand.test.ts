import { describe, expect, it, vi } from 'vitest';
import { MongoProductRepository } from './product.mongo.repository';

describe('seed product rebrand', () => {
  it('changes only the expected original name, description and image, and queues search', async () => {
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const repo = new MongoProductRepository({ collection: () => ({ updateOne }) } as never);
    const change = { productId: 'p', vendorId: 'v', seedIdentity: 'seed', oldName: 'Old', oldDescription: 'Old description', oldImage: 'products/v/p/main.webp', newName: 'New', newDescription: 'New description', newImage: 'products/v/p/main-new.png' };
    expect(await repo.rebrandSeedProduct(change)).toBe(true);
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: 'p', vendorId: 'v', seedIdentity: 'seed', name: 'Old', description: 'Old description', images: ['products/v/p/main.webp'] });
    expect(update.$set).toMatchObject({ name: 'New', description: 'New description', images: ['products/v/p/main-new.png'], searchPending: true });
    expect(update.$inc).toEqual({ searchRevision: 1 });
  });
});
