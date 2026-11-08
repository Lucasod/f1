import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDevelopmentSeed, runSeed, resetDeterministicIdGenerator } from './seed.js';
import { InMemoryPersonRepository } from '../modules/person/person.domain.js';
import { InMemoryVendorRepository } from '../modules/vendor/vendor.domain.js';
import { Product, ProductError, ProductStatus, InMemoryProductRepository, InMemoryCategoryRepository } from '../modules/product/product.domain.js';
import { SeedRepositories } from '../shared/seed.types.js';

describe('seed search index reindex', () => {
  let repositories: SeedRepositories;
  beforeEach(() => {
    resetDeterministicIdGenerator();
    const personRepo = new InMemoryPersonRepository();
    const vendorRepo = new InMemoryVendorRepository();
    const categoryRepo = new InMemoryCategoryRepository();
    const productRepo = new InMemoryProductRepository();
    repositories = { personRepo, vendorRepo, categoryRepo, productRepo };
  });

  it('reindexes seeded products when searchIndex is provided', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };
    await runSeed(repositories, searchIndex as any);
    const products = await repositories.productRepo.findAll();
    expect(searchIndex.indexProduct).toHaveBeenCalledTimes(products.length);
  });

  it('does not fail seed when indexing throws', async () => {
    const searchIndex = { indexProduct: vi.fn().mockRejectedValue(new Error('ES_DOWN')) };
    await expect(runSeed(repositories, searchIndex as any)).resolves.toBeUndefined();
    const products = await repositories.productRepo.findAll();
    expect(products.length).toBe(12);
  });

  it('does not call indexProduct when no searchIndex', async () => {
    const spy = vi.fn();
    await runSeed(repositories);
    expect(spy).not.toHaveBeenCalled();
  });

  it('reindexes via runDevelopmentSeed partial catalog', async () => {
    await runSeed(repositories);
    const products = await repositories.productRepo.findAll();
    await repositories.productRepo.delete(products[1].id);
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };
    await runDevelopmentSeed(repositories, searchIndex as any);
    expect(searchIndex.indexProduct).toHaveBeenCalled();
  });
  it('indexes edited persisted fields rather than fixtures during partial catalog recovery', async () => {
    await runSeed(repositories);
    const products = await repositories.productRepo.findAll();
    const edited = Product.reconstruct({
      ...products[0], name: 'Edited product', description: 'Edited description',
      price: 7.25, quantity: 0, status: ProductStatus.INACTIVE, images: ['/edited'],
    });
    await repositories.productRepo.update(edited);
    await repositories.productRepo.delete(products[1].id);
    const save = vi.spyOn(repositories.productRepo, 'save');
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    await runDevelopmentSeed(repositories, searchIndex);

    expect(searchIndex.indexProduct).toHaveBeenCalledWith(edited);
    expect(searchIndex.indexProduct.mock.calls.map(([product]) => product))
      .toEqual(expect.arrayContaining(await repositories.productRepo.findAll()));
    expect(searchIndex.indexProduct).toHaveBeenCalledTimes(12);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('indexes the persisted ID for a matching seed identity without duplicating it', async () => {
    await runSeed(repositories);
    const products = await repositories.productRepo.findAll();
    const relocated = Product.reconstruct({ ...products[0], id: 'persisted-seed-product' });
    await repositories.productRepo.delete(products[0].id);
    await repositories.productRepo.save(relocated);
    await repositories.productRepo.delete(products[1].id);
    const save = vi.spyOn(repositories.productRepo, 'save');
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    await runDevelopmentSeed(repositories, searchIndex);

    expect(searchIndex.indexProduct).toHaveBeenCalledWith(relocated);
    expect(searchIndex.indexProduct.mock.calls.some(([product]) => product.id === products[0].id)).toBe(false);
    expect((await repositories.productRepo.findAll()).filter(product => product.seedIdentity === relocated.seedIdentity))
      .toEqual([relocated]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('indexes the stored representation returned by reads after a successful insertion', async () => {
    const save = repositories.productRepo.save.bind(repositories.productRepo);
    vi.spyOn(repositories.productRepo, 'save').mockImplementation(product => save(Product.reconstruct({
      ...product, price: 3.5, quantity: 2, status: ProductStatus.INACTIVE,
    })));
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    await runSeed(repositories, searchIndex);

    const persisted = await repositories.productRepo.findAll();
    expect(searchIndex.indexProduct.mock.calls.map(([product]) => product)).toEqual(persisted);
    expect(searchIndex.indexProduct).toHaveBeenCalledTimes(12);
  });

  it('does not index a candidate when product save fails', async () => {
    vi.spyOn(repositories.productRepo, 'save').mockRejectedValue(new Error('WRITE_FAILED'));
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    await expect(runSeed(repositories, searchIndex)).rejects.toThrow('WRITE_FAILED');

    expect(searchIndex.indexProduct).not.toHaveBeenCalled();
    expect(await repositories.productRepo.findAll()).toEqual([]);
  });

  it('indexes the verified persisted winner of a concurrent seed insertion', async () => {
    const save = repositories.productRepo.save.bind(repositories.productRepo);
    vi.spyOn(repositories.productRepo, 'save').mockImplementation(async product => {
      await save(Product.reconstruct({ ...product, price: 4.5, quantity: 0, status: ProductStatus.OUT_OF_STOCK }));
      throw new Error(ProductError.PRODUCT_CONFLICT);
    });
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    await runSeed(repositories, searchIndex);

    expect(searchIndex.indexProduct.mock.calls.map(([product]) => product))
      .toEqual(await repositories.productRepo.findAll());
  });

  it('fails closed when a successful save has no authoritative product to index', async () => {
    vi.spyOn(repositories.productRepo, 'save').mockImplementation(async product => product);
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    await expect(runSeed(repositories, searchIndex)).rejects.toThrow(ProductError.PRODUCT_CONFLICT);

    expect(searchIndex.indexProduct).not.toHaveBeenCalled();
  });
});
