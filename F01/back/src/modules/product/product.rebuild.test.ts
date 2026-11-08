import { describe, expect, it, vi } from 'vitest';
import { InMemoryProductRepository } from './product.domain';
import { ProductService } from './product.service';
import { config } from '../../config';
import { Product } from './product.domain';

describe('ProductService rebuildFromMongo', () => {
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
