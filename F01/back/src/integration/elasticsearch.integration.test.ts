import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Product, ProductStatus } from '../modules/product/product.domain';
import { ElasticsearchProductIndex } from '../modules/search/elasticsearch-product-index';
import { ElasticsearchProductWriter } from '../modules/search/elasticsearch-product-writer';

const TEST_ES_URL = process.env.TEST_ELASTICSEARCH_URL || 'http://localhost:9200';

async function isEsAvailable(uri: string): Promise<boolean> {
  try {
    const response = await fetch(`${uri}`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

const esAvailable = await isEsAvailable(TEST_ES_URL);
const describeIfEs = esAvailable
  ? describe
  : (name: string, fn: () => void) => describe.skip(`${name} (Elasticsearch unavailable at ${TEST_ES_URL})`, fn);

describeIfEs('Elasticsearch Integration Tests', () => {
  let index: ElasticsearchProductIndex;

  beforeAll(async () => {
    index = new ElasticsearchProductIndex(TEST_ES_URL);
    await index.ensureIndex();
  });

  afterAll(async () => {
    await fetch(`${TEST_ES_URL}/products_v1`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  });

  beforeEach(async () => {
    await index.ensureIndex();
    await fetch(`${TEST_ES_URL}/products/_delete_by_query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: { match_all: {} } }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
    await fetch(`${TEST_ES_URL}/products/_refresh`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  });

  it('creates the products alias', async () => {
    const response = await fetch(`${TEST_ES_URL}/_alias/products`, { signal: AbortSignal.timeout(5000) });
    expect(response.ok).toBe(true);
  });

  it('indexes and searches a product', async () => {
    const product = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Searchable Widget', description: 'A useful widget', price: 19.99, quantity: 3 });
    await index.indexProduct(product);
    await fetch(`${TEST_ES_URL}/products/_refresh`, { method: 'POST', signal: AbortSignal.timeout(5000) });

    const results = await index.search({ search: 'widget' });
    expect(results.map((item) => item.id)).toContain(product.id);
  });

  it('filters by status and vendor', async () => {
    const active = Product.create({ vendorId: 'vendor-a', categoryId: 'c1', name: 'Active Product', description: 'desc', price: 10, quantity: 1, status: ProductStatus.ACTIVE });
    const inactive = Product.create({ vendorId: 'vendor-b', categoryId: 'c1', name: 'Inactive Product', description: 'desc', price: 10, quantity: 1, status: ProductStatus.INACTIVE });
    await index.indexProduct(active);
    await index.indexProduct(inactive);
    await fetch(`${TEST_ES_URL}/products/_refresh`, { method: 'POST', signal: AbortSignal.timeout(5000) });

    const activeResults = await index.search({ status: 'active' });
    expect(activeResults.map((item) => item.id)).toContain(active.id);
    expect(activeResults.map((item) => item.id)).not.toContain(inactive.id);

    const vendorResults = await index.search({ vendorId: 'vendor-b' });
    expect(vendorResults.map((item) => item.id)).toContain(inactive.id);
  });

  it('sorts by price ascending', async () => {
    const cheap = Product.create({ vendorId: 'v', categoryId: 'c', name: 'Cheap', description: 'd', price: 5, quantity: 1 });
    const expensive = Product.create({ vendorId: 'v', categoryId: 'c', name: 'Expensive', description: 'd', price: 50, quantity: 1 });
    await index.indexProduct(cheap);
    await index.indexProduct(expensive);
    await fetch(`${TEST_ES_URL}/products/_refresh`, { method: 'POST', signal: AbortSignal.timeout(5000) });

    const results = await index.search({ sortBy: 'price_asc' });
    const ids = results.map((item) => item.id);
    expect(ids.indexOf(cheap.id)).toBeLessThan(ids.indexOf(expensive.id));
  });

  it('keeps delete unavailable with an explicit error', async () => {
    const writer = new ElasticsearchProductWriter(TEST_ES_URL);
    await expect(writer.delete('any')).rejects.toThrow('ELASTICSEARCH_DELETE_UNAVAILABLE');
  });
});
