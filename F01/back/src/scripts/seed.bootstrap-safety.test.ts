import { expect, it, vi } from 'vitest';
import { MongoProductRepository } from '../modules/product/product.mongo.repository';
import { runSeed, runDevelopmentSeed } from './seed';

it.each(['runSeed', 'runDevelopmentSeed'])('%s checks the seed index before any bootstrap writes', async entry => {
  const listIndexes = vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) }));
  const products = new MongoProductRepository({ collection: () => ({
    listIndexes, find: () => ({ toArray: async () => [] }),
  }) } as any);
  const categoryWrite = vi.fn().mockRejectedValue(new Error('unexpected write'));
  const personWrite = vi.fn();
  const vendorWrite = vi.fn();
  const repos = { productRepo: products, categoryRepo: { save: categoryWrite }, personRepo: { save: personWrite, update: personWrite }, vendorRepo: { save: vendorWrite } } as any;
  await expect((entry === 'runSeed' ? runSeed : runDevelopmentSeed)(repos)).rejects.toThrow('PRODUCT_SEED_INDEX_UNAVAILABLE');
  expect(categoryWrite).not.toHaveBeenCalled();
  expect(personWrite).not.toHaveBeenCalled();
  expect(vendorWrite).not.toHaveBeenCalled();
});
