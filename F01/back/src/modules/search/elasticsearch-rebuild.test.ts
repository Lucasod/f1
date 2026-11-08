import { describe, expect, it, vi } from 'vitest';
import { Product } from '../product/product.domain';
import { ElasticsearchProductIndex } from './elasticsearch-product-index';

const base = 'http://localhost:9200';

describe('ElasticsearchProductIndex rebuildFromMongo', () => {
  it('iterates products, indexes via writer, and counts successes/failures', async () => {
    const p1 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'P1', description: 'd', price: 10, quantity: 1 });
    const p2 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'P2', description: 'd', price: 20, quantity: 2 });

    let bulkCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (String(url).includes('/_alias/products')) {
        return new Response('{}', { status: 200 });
      }
      bulkCalls += 1;
      if (bulkCalls === 1) {
        return new Response(JSON.stringify({ errors: false, items: [{ index: { _id: p1.id, status: 201, result: 'created' } }] }), { status: 200 });
      }
      return new Response('{}', { status: 500 });
    });

    const index = new ElasticsearchProductIndex(base, fetcher);
    const result = await index.rebuildFromMongo([p1, p2]);

    expect(result.total).toBe(2);
    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
  });

  it('accepts a product repository with findAll', async () => {
    const p1 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'P1', description: 'd', price: 10, quantity: 1 });
    const repo = { findAll: vi.fn().mockResolvedValue([p1]) };

    const fetcher = vi.fn(async (url: string) => {
      if (String(url).includes('/_alias/products')) return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ errors: false, items: [{ index: { _id: p1.id, status: 201, result: 'created' } }] }), { status: 200 });
    });

    const index = new ElasticsearchProductIndex(base, fetcher);
    const result = await index.rebuildFromMongo(repo as any);

    expect(repo.findAll).toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('does not throw when an item fails', async () => {
    const p1 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'P1', description: 'd', price: 10, quantity: 1 });
    const fetcher = vi.fn(async (url: string) => {
      if (String(url).includes('/_alias/products')) return new Response('{}', { status: 200 });
      return new Response('{}', { status: 500 });
    });
    const index = new ElasticsearchProductIndex(base, fetcher);
    await expect(index.rebuildFromMongo([p1])).resolves.toBeDefined();
  });
});
