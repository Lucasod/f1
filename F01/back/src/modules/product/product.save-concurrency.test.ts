import { describe, expect, it, vi } from 'vitest';
import { InMemoryProductRepository, Product } from './product.domain';
import { MongoProductRepository } from './product.mongo.repository';

function product(images: string[]) {
  return Product.reconstruct({ id: 'same-id', vendorId: 'vendor', categoryId: 'category', name: 'name', description: 'description', price: 1, quantity: 1, images });
}

describe('product creation conflicts', () => {
  it('atomically rejects concurrent in-memory saves with the same seed identity and different IDs', async () => {
    const repo = new InMemoryProductRepository();
    const first = Product.reconstruct({ ...product(['/first']), id: 'one', seedIdentity: 'seed:a' });
    const second = Product.reconstruct({ ...product(['/second']), id: 'two', seedIdentity: 'seed:a' });
    const outcomes = await Promise.allSettled([repo.save(first), repo.save(second)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.message)).toEqual(['PRODUCT_CONFLICT']);
    expect(await repo.findAll()).toHaveLength(1);
  });
  it('does not let repeated in-memory saves replace existing images', async () => {
    const repo = new InMemoryProductRepository();
    await repo.save(product(['/first']));
    await expect(repo.save(product(['/stale']))).rejects.toThrow('PRODUCT_CONFLICT');
    expect((await repo.findById('same-id'))!.images).toEqual(['/first']);
  });

  it('allows only one concurrent creation of the same Mongo product ID', async () => {
    const stored = new Map<string, any>();
    const collection = {
      updateOne: async (filter: any, update: any, options: any) => {
        if (stored.has(filter._id)) {
          if (update.$set) Object.assign(stored.get(filter._id), update.$set);
          return { matchedCount: 1, upsertedCount: 0 };
        }
        if (options.upsert) {
          stored.set(filter._id, { ...update.$setOnInsert, ...update.$set });
          return { matchedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, upsertedCount: 0 };
      },
    };
    const repo = new MongoProductRepository({ collection: () => collection } as any);
    const outcomes = await Promise.allSettled([repo.save(product(['/first'])), repo.save(product(['/second']))]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => (outcome as PromiseRejectedResult).reason.message)).toEqual(['PRODUCT_CONFLICT']);
    expect(stored.get('same-id').images).toEqual(['/first']);
  });

  it('maps a duplicate-key race to conflict and propagates other storage failures', async () => {
    const updateOne = vi.fn().mockRejectedValueOnce({ code: 11000 }).mockRejectedValueOnce(new Error('database unavailable'));
    const repo = new MongoProductRepository({ collection: () => ({ updateOne }) } as any);
    await expect(repo.save(product(['/first']))).rejects.toThrow('PRODUCT_CONFLICT');
    await expect(repo.save(product(['/first']))).rejects.toThrow('database unavailable');
  });
});
