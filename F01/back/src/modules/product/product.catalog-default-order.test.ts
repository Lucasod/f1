import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { InMemoryProductRepository, Product } from './product.domain';
import { MongoProductRepository } from './product.mongo.repository';
import { createProductRoutes } from './product.routes';

const makeProduct = (id: string, quantity: number, createdAt: string) => Product.reconstruct({
  id, vendorId: 'vendor', categoryId: 'category', name: id, description: id, price: 1, quantity,
  status: 'active' as any, createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
});

describe('default catalog stock ordering', () => {
  it('lists active and out-of-stock products only in catalog mode before pagination', async () => {
    const repo = new InMemoryProductRepository();
    const available = makeProduct('available', 2, '2026-01-01');
    const depleted = makeProduct('depleted', 2, '2026-01-02');
    depleted.updateStock(0);
    const inactive = Product.reconstruct({ ...makeProduct('inactive', 2, '2026-01-03'), status: 'inactive' as any });
    const discontinued = Product.reconstruct({ ...makeProduct('discontinued', 0, '2026-01-04'), status: 'discontinued' as any });
    for (const product of [depleted, inactive, discontinued, available]) await repo.save(product);
    const app = express();
    app.use(createProductRoutes({ authService: {} as any, vendorRepo: {} as any, personRepo: {} as any, storageAdapter: {} as any,
      productService: { listProducts: (filters: any) => repo.findAll(filters) } as any }));
    const first = await request(app).get('/?catalog=true&limit=1&page=1');
    const second = await request(app).get('/?catalog=true&limit=1&page=2');
    expect(first.body.products.map((p: any) => p.id)).toEqual(['available']);
    expect(second.body.products.map((p: any) => p.id)).toEqual(['depleted']);
    expect(first.body.total).toBe(2);
    const generic = await request(app).get('/?status=active');
    expect(generic.body.products.map((p: any) => p.id)).toEqual(['available']);
    const privateIntersection = await request(app).get('/?catalog=true&status=inactive');
    expect(privateIntersection.body.products).toEqual([]);
  });

  it('applies catalog, vendor and category filters before pagination with the Mongo repository', async () => {
    const active = makeProduct('active', 1, '2026-01-01');
    const out = makeProduct('out', 1, '2026-01-02');
    out.updateStock(0);
    const hidden = Product.reconstruct({ ...makeProduct('hidden', 1, '2026-01-03'), status: 'inactive' as any });
    const other = Product.reconstruct({ ...makeProduct('other', 1, '2026-01-04'), vendorId: 'another' });
    const docs = [out, hidden, active, other].map(product => ({ ...product, _id: product.id }));
    const repo = new MongoProductRepository({ collection: () => ({ find: (query: any) => ({ toArray: async () => docs.filter(doc => !query.vendorId || doc.vendorId === query.vendorId) }) }) } as any);
    const app = express();
    app.use(createProductRoutes({ authService: {} as any, vendorRepo: {} as any, personRepo: {} as any, storageAdapter: {} as any,
      productService: { listProducts: (filters: any) => repo.findAll(filters), listCategories: async () => [] } as any }));
    const first = await request(app).get('/?catalog=true&vendorId=vendor&categoryId=category&limit=1&page=1');
    const second = await request(app).get('/?catalog=true&vendorId=vendor&categoryId=category&limit=1&page=2');
    expect(first.body.products.map((p: any) => p.id)).toEqual(['active']);
    expect(second.body.products.map((p: any) => p.id)).toEqual(['out']);
    expect(first.body.total).toBe(2);
  });
  it('puts available products before newer unavailable products before pagination', async () => {
    const repo = new InMemoryProductRepository();
    await repo.save(makeProduct('new-out', 0, '2026-01-02'));
    await repo.save(makeProduct('older-stock', 1, '2026-01-01'));
    const app = express();
    app.use(createProductRoutes({ authService: {} as any, vendorRepo: {} as any, personRepo: {} as any, storageAdapter: {} as any,
      productService: { listProducts: (filters: any) => repo.findAll(filters) } as any }));
    const first = await request(app).get('/?limit=1&page=1');
    const second = await request(app).get('/?limit=1&page=2');
    expect(first.body.products[0].id).toBe('older-stock');
    expect(second.body.products[0].id).toBe('new-out');
  });

  it('orders a mocked Mongo repository default listing by stock', async () => {
    const docs = [makeProduct('new-out', 0, '2026-01-02'), makeProduct('older-stock', 1, '2026-01-01')]
      .map(product => ({ ...product, _id: product.id }));
    const repo = new MongoProductRepository({ collection: () => ({ find: () => ({ toArray: async () => docs }) }) } as any);
    expect((await repo.findAll()).map(product => product.id)).toEqual(['older-stock', 'new-out']);
  });

  it('preserves an explicit newest sort and the vendor filter', async () => {
    const repo = new InMemoryProductRepository();
    await repo.save(makeProduct('older-stock', 1, '2026-01-01'));
    await repo.save(makeProduct('new-out', 0, '2026-01-02'));
    await repo.save(Product.reconstruct({ ...makeProduct('another-vendor', 1, '2026-01-03'), vendorId: 'other' }));
    expect((await repo.findAll({ vendorId: 'vendor', sortBy: 'newest' })).map(product => product.id)).toEqual(['new-out', 'older-stock']);
  });
});
