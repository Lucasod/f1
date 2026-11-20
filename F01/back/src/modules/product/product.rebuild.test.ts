import { describe, expect, it, vi } from 'vitest';
import { InMemoryProductRepository } from './product.domain';
import { ProductService } from './product.service';
import { config } from '../../config';
import { Product } from './product.domain';

describe('ProductService rebuildFromMongo', () => {
  it('supports explicit source shapes and legacy combined publishers without hiding source failures', async () => {
    const repo = new InMemoryProductRepository();
    const product = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Product', description: 'd', price: 1, quantity: 1 });
    await repo.save(product);
    const index = { indexProduct: vi.fn().mockResolvedValue(undefined) };
    const service = new ProductService(repo, {} as any, {} as any, config, index as any);
    for (const source of [[product], () => [product], { products: [product] }, { findAll() { return [product]; } }, Promise.resolve([product])]) {
      expect(await service.rebuildFromMongo(source)).toMatchObject({ indexed: 1, failed: 0 });
    }
    const combined = { findAll: vi.fn().mockResolvedValue([product]), indexProduct: vi.fn().mockResolvedValue(undefined) };
    expect(await service.rebuildFromMongo(combined)).toMatchObject({ indexed: 1 });
    expect(combined.findAll).toHaveBeenCalledTimes(1); expect(combined.indexProduct).toHaveBeenCalledWith(product);
    const publisherOnly = { indexProduct: vi.fn().mockResolvedValue(undefined) };
    expect(await service.rebuildFromMongo(publisherOnly)).toMatchObject({ indexed: 1 });
    expect(publisherOnly.indexProduct).toHaveBeenCalledWith(product);
    for (const source of [12, {}, () => null]) await expect(service.rebuildFromMongo(source)).rejects.toThrow('PRODUCT_SEARCH_SOURCE_INVALID');
    await expect(service.rebuildFromMongo(() => { throw new Error('synthetic source error'); })).rejects.toThrow('PRODUCT_SEARCH_SOURCE_FAILED');
    await expect(service.rebuildFromMongo({ findAll: async () => { throw new Error('synthetic source error'); } })).rejects.toThrow('PRODUCT_SEARCH_SOURCE_FAILED');
  });

  it('rejects alternate publishers in durable mode instead of letting them bypass fencing', async () => {
    const publisher = { indexProduct: vi.fn(), durable: true };
    const service = new ProductService(new InMemoryProductRepository(), {} as any, {} as any, config, publisher as any);
    const other = { findAll: vi.fn(), indexProduct: vi.fn() };
    await expect(service.rebuildFromMongo(other)).rejects.toThrow('PRODUCT_SEARCH_SOURCE_PUBLISHER_UNSUPPORTED');
    expect(other.findAll).not.toHaveBeenCalled(); expect(other.indexProduct).not.toHaveBeenCalled();
  });
  it.each([undefined, null])('rejects without indexing when Mongo findAll fails (source: %s)', async (source) => {
    const productRepo = new InMemoryProductRepository();
    const sourceError = new Error('MONGO_UNAVAILABLE');
    const findAll = vi.spyOn(productRepo, 'findAll').mockRejectedValue(sourceError);
    const categoryRepo = { findById: vi.fn(), findAll: vi.fn() } as any;
    const vendorRepo = { findById: vi.fn() } as any;
    const searchIndex = { indexProduct: vi.fn(), search: vi.fn() };
    const service = new ProductService(productRepo, categoryRepo, vendorRepo, config, searchIndex as any);

    await expect(service.rebuildFromMongo(source)).rejects.toBe(sourceError);

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(searchIndex.indexProduct).not.toHaveBeenCalled();
  });

  it('returns zero counts without indexing when Mongo contains no products', async () => {
    const productRepo = new InMemoryProductRepository();
    const findAll = vi.spyOn(productRepo, 'findAll').mockResolvedValue([]);
    const categoryRepo = { findById: vi.fn(), findAll: vi.fn() } as any;
    const vendorRepo = { findById: vi.fn() } as any;
    const searchIndex = { indexProduct: vi.fn(), search: vi.fn() };
    const service = new ProductService(productRepo, categoryRepo, vendorRepo, config, searchIndex as any);

    await expect(service.rebuildFromMongo()).resolves.toEqual({
      total: 0, indexed: 0, failed: 0,
      successCount: 0, failureCount: 0, succeeded: 0, failures: 0,
      reindexed: 0, success: 0, errorCount: 0,
      indexedCount: 0, failedCount: 0, count: 0,
    });
    expect(findAll).toHaveBeenCalledTimes(1);
    expect(searchIndex.indexProduct).not.toHaveBeenCalled();
  });

  it('iterates Mongo products and indexes via searchIndex with per-item try/catch', async () => {
    const productRepo = new InMemoryProductRepository();
    const categoryRepo = { findById: vi.fn().mockResolvedValue({ id: 'c1' }), findAll: vi.fn().mockResolvedValue([]) } as any;
    const vendorRepo = { findById: vi.fn().mockResolvedValue({ id: 'v1' }) } as any;

    const p1 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'P1', description: 'd', price: 10, quantity: 1 });
    const p2 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'P2', description: 'd', price: 20, quantity: 2 });
    await productRepo.save(p1);
    await productRepo.save(p2);

    const searchIndex = {
      indexProduct: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ES_DOWN')),
      search: vi.fn(),
    };

    const service = new ProductService(productRepo, categoryRepo, vendorRepo, config, searchIndex as any);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await service.rebuildFromMongo();

    expect(searchIndex.indexProduct).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(2);
    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('works without searchIndex by counting failures', async () => {
    const productRepo = new InMemoryProductRepository();
    const categoryRepo = { findById: vi.fn().mockResolvedValue({ id: 'c1' }), findAll: vi.fn().mockResolvedValue([]) } as any;
    const vendorRepo = { findById: vi.fn().mockResolvedValue({ id: 'v1' }) } as any;
    const p1 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'P1', description: 'd', price: 10, quantity: 1 });
    await productRepo.save(p1);

    const service = new ProductService(productRepo, categoryRepo, vendorRepo, config, undefined);
    const result = await service.rebuildFromMongo();

    expect(result.total).toBe(1);
    expect(result.indexed).toBe(0);
    expect(result.failed).toBe(1);
  });
});
