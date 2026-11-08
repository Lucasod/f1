import { describe, expect, it, vi } from 'vitest';
import { BSON } from 'mongodb';
import express from 'express';
import request from 'supertest';
import { InMemoryProductRepository, Product, ProductStatus } from './product.domain';
import { MongoProductRepository } from './product.mongo.repository';
import { createProductRoutes } from './product.routes';

describe('product literal search', () => {
  it('demonstrates the BSON NUL limitation and memory behavior without a database', async () => {
    const search = 'a\0b';
    expect(() => BSON.serialize({ name: new RegExp(search, 'i') })).toThrow();
    const memory = new InMemoryProductRepository();
    const product = Product.create({ vendorId: 'v', categoryId: 'c', name: `text ${search}`, description: 'other', price: 1, quantity: 1 });
    await memory.save(product);
    expect((await memory.findAll({ search })).map(item => item.id)).toEqual([product.id]);
  });

  it.each(['memory', 'mongo'])('rejects NUL before reaching the %s repository', async kind => {
    const memory = new InMemoryProductRepository();
    const mongo = new MongoProductRepository({ collection: () => ({
      find: (query: any) => { BSON.serialize(query); return { toArray: async () => [] }; },
    }) } as any);
    const listProducts = vi.fn((filters: any) => (kind === 'memory' ? memory : mongo).findAll(filters));
    const app = express();
    app.use(createProductRoutes({ authService: {} as any, vendorRepo: {} as any, personRepo: {} as any, storageAdapter: {} as any,
      productService: { listProducts } as any }));
    const response = await request(app).get('/').query({ search: 'a\0b', status: 'active', vendorId: 'v', sortBy: 'name' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_SEARCH');
    expect(listProducts).not.toHaveBeenCalled();
  });

  it.each(['memory', 'mongo'])('preserves literal search, vendor, status and sort through the %s endpoint', async kind => {
    const products = [
      Product.create({ vendorId: 'v', categoryId: 'c', name: 'z C++', description: 'other', price: 1, quantity: 1 }),
      Product.create({ vendorId: 'v', categoryId: 'c', name: 'a C++', description: 'other', price: 1, quantity: 1 }),
      Product.create({ vendorId: 'other', categoryId: 'c', name: 'b C++', description: 'other', price: 1, quantity: 1 }),
      Product.create({ vendorId: 'v', categoryId: 'c', name: 'c C++', description: 'other', price: 1, quantity: 1, status: ProductStatus.INACTIVE }),
      Product.create({ vendorId: 'v', categoryId: 'c', name: 'd Cxx', description: 'other', price: 1, quantity: 1 }),
    ];
    const memory = new InMemoryProductRepository();
    for (const product of products) await memory.save(product);
    const docs = products.map(product => ({ ...product, _id: product.id }));
    const mongo = new MongoProductRepository({ collection: () => ({ find: (query: any) => {
      BSON.serialize(query);
      return { toArray: async () => docs.filter(doc => (!query.status || doc.status === query.status)
        && (!query.vendorId || doc.vendorId === query.vendorId)
        && (!query.$or || query.$or.some((clause: any) => clause.name?.test(doc.name) || clause.description?.test(doc.description)))) };
    } }) } as any);
    const app = express();
    app.use(createProductRoutes({ authService: {} as any, vendorRepo: {} as any, personRepo: {} as any, storageAdapter: {} as any,
      productService: { listProducts: (filters: any) => (kind === 'memory' ? memory : mongo).findAll(filters) } as any }));
    const response = await request(app).get('/').query({ search: 'C++', status: 'active', vendorId: 'v', sortBy: 'name' });
    expect(response.status).toBe(200);
    expect(response.body.products.map((product: any) => product.name)).toEqual(['a C++', 'z C++']);
    expect(response.body.total).toBe(2);
  });

  it.each(['[', '.*', 'C++', '(a+)+$', '\\', 'PHONE'])(
    'matches %s literally in name or description like the in-memory repository',
    async search => {
      const products = [
        Product.create({ vendorId: 'v', categoryId: 'c', name: `Name ${search}`, description: 'other', price: 1, quantity: 1, status: ProductStatus.ACTIVE }),
        Product.create({ vendorId: 'v', categoryId: 'c', name: 'other', description: `Description ${search.toLowerCase()}`, price: 1, quantity: 1, status: ProductStatus.ACTIVE }),
        Product.create({ vendorId: 'v', categoryId: 'c', name: 'unrelated', description: 'ordinary text', price: 1, quantity: 1, status: ProductStatus.ACTIVE }),
      ];
      const memory = new InMemoryProductRepository();
      for (const product of products) await memory.save(product);
      const docs = products.map(product => ({ ...product, _id: product.id }));
      const mongo = new MongoProductRepository({ collection: () => ({
        find: (query: any) => ({ toArray: async () => docs.filter(doc =>
          query.$or.some((clause: any) => clause.name?.test(doc.name) || clause.description?.test(doc.description))
        ) }),
      }) } as any);
      expect((await mongo.findAll({ search })).map(product => product.id).sort())
        .toEqual((await memory.findAll({ search })).map(product => product.id).sort());
    },
  );
});
