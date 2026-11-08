import { describe, expect, it, vi } from 'vitest';
import { InMemoryProductRepository } from './product.domain';
import { ProductService } from './product.service';
import { config } from '../../config';

describe('ProductService Elasticsearch resilience', () => {
  function makeRepos(searchIndex: any) {
    const productRepo = new InMemoryProductRepository();
    const categoryRepo = { findById: vi.fn().mockResolvedValue({ id: 'c1' }), findAll: vi.fn().mockResolvedValue([]) } as any;
    const vendorRepo = { findById: vi.fn().mockResolvedValue({ id: 'v1' }) } as any;
    const service = new ProductService(productRepo, categoryRepo, vendorRepo, config, searchIndex);
    return { service, productRepo, categoryRepo, vendorRepo };
  }

  it('createProduct returns Mongo result and logs warning when ES indexing fails', async () => {
    const searchIndex = { indexProduct: vi.fn().mockRejectedValue(new Error('ES_DOWN')), search: vi.fn() };
    const { service } = makeRepos(searchIndex);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const product = await service.createProduct('v1', {
      vendorId: 'v1',
      categoryId: 'c1',
      name: 'Widget',
      description: 'd',
      price: 10,
      quantity: 2,
    });

    expect(product.name).toBe('Widget');
    expect(searchIndex.indexProduct).toHaveBeenCalledWith(expect.objectContaining({ id: product.id }));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('createProduct indexes successfully when ES is available', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service } = makeRepos(searchIndex);

    const product = await service.createProduct('v1', {
      vendorId: 'v1',
      categoryId: 'c1',
      name: 'Widget',
      description: 'd',
      price: 10,
      quantity: 2,
    });

    expect(searchIndex.indexProduct).toHaveBeenCalledWith(expect.objectContaining({ id: product.id }));
  });

  it('updateProduct returns Mongo result when ES indexing fails', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });
    searchIndex.indexProduct.mockRejectedValue(new Error('ES_DOWN'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const updated = await service.updateProduct(created.id, 'v1', { name: 'Widget2' }, false);

    expect(updated.name).toBe('Widget2');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('updateProductStock returns Mongo result when ES indexing fails', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });
    searchIndex.indexProduct.mockRejectedValue(new Error('ES_DOWN'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const updated = await service.updateProductStock(created.id, 'v1', 5, false);

    expect(updated.quantity).toBe(5);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('inactivateProduct returns Mongo result when ES indexing fails', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });
    searchIndex.indexProduct.mockRejectedValue(new Error('ES_DOWN'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const updated = await service.inactivateProduct(created.id, 'v1', false);

    expect(updated.status).toBe('inactive');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('activateProduct returns Mongo result when ES indexing fails', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2, status: 'inactive' as any,
    });
    await service.inactivateProduct(created.id, 'v1', false);
    searchIndex.indexProduct.mockRejectedValue(new Error('ES_DOWN'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const updated = await service.activateProduct(created.id, 'v1', false);

    expect(updated.status).toBe('active');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('listProducts falls back to Mongo findAll when ES search fails', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn().mockRejectedValue(new Error('ES_DOWN')) };
    const { service, productRepo } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = await service.listProducts({ search: 'Widget' });

    expect(results.map((p: any) => p.id)).toContain(created.id);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('listProducts uses ES search when available', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn().mockResolvedValue([]) };
    const { service } = makeRepos(searchIndex);

    await service.listProducts({ search: 'Widget' });

    expect(searchIndex.search).toHaveBeenCalled();
  });
});

describe('ProductService deleteProduct (CR003)', () => {
  function makeRepos(searchIndex: any) {
    const productRepo = new InMemoryProductRepository();
    const categoryRepo = { findById: vi.fn().mockResolvedValue({ id: 'c1' }), findAll: vi.fn().mockResolvedValue([]) } as any;
    const vendorRepo = { findById: vi.fn().mockResolvedValue({ id: 'v1' }) } as any;
    const service = new ProductService(productRepo, categoryRepo, vendorRepo, config, searchIndex);
    return { service, productRepo, categoryRepo, vendorRepo };
  }

  it('inactivates the product and indexes it in ES instead of hard deleting', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service, productRepo } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });
    searchIndex.indexProduct.mockClear();

    await service.deleteProduct(created.id, 'v1', false);

    const after = await productRepo.findById(created.id);
    expect(after).not.toBeNull();
    expect(after.status).toBe('inactive');
    expect(searchIndex.indexProduct).toHaveBeenCalledWith(expect.objectContaining({ id: created.id, status: 'inactive' }));
  });

  it('does not call repo.delete', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service, productRepo } = makeRepos(searchIndex);
    const deleteSpy = vi.spyOn(productRepo, 'delete');
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });

    await service.deleteProduct(created.id, 'v1', false);

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('returns successfully and logs warning when ES indexing fails (best-effort)', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service, productRepo } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });
    searchIndex.indexProduct.mockRejectedValue(new Error('ES_DOWN'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(service.deleteProduct(created.id, 'v1', false)).resolves.toBeUndefined();

    const after = await productRepo.findById(created.id);
    expect(after).not.toBeNull();
    expect(after.status).toBe('inactive');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('inactivates and updates repo even without searchIndex', async () => {
    const { service, productRepo } = makeRepos(undefined);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });

    await service.deleteProduct(created.id, 'v1', false);

    const after = await productRepo.findById(created.id);
    expect(after).not.toBeNull();
    expect(after.status).toBe('inactive');
  });

  it('throws PRODUCT_NOT_FOUND for missing product', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service } = makeRepos(searchIndex);
    await expect(service.deleteProduct('nope', 'v1', false)).rejects.toThrow('PRODUCT_NOT_FOUND');
  });

  it('throws PRODUCT_OWNERSHIP_VIOLATION for non-owner', async () => {
    const searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined), search: vi.fn() };
    const { service } = makeRepos(searchIndex);
    const created = await service.createProduct('v1', {
      vendorId: 'v1', categoryId: 'c1', name: 'Widget', description: 'd', price: 10, quantity: 2,
    });
    await expect(service.deleteProduct(created.id, 'v2', false)).rejects.toThrow('PRODUCT_OWNERSHIP_VIOLATION');
  });
});
