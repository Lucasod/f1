import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Product, ProductStatus } from '../product/product.domain';
import {
  ElasticsearchProductIndex,
  ProductSearchFilters,
  resolveProductSource,
  toDocument,
} from './elasticsearch-product-index';

function mockResponse(body: unknown, status = 200, ok = true) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function bulkResponse(id: string, result = 'created', status = 201) {
  return mockResponse(
    { errors: false, items: [{ index: { _id: id, result, status } }] },
    status
  );
}

const baseUrl = 'http://localhost:9200';

function productDoc(overrides: Record<string, unknown> = {}) {
  return {
    product_id: 'prod-1',
    vendor_id: 'vendor-1',
    category_id: 'cat-1',
    name: 'Widget',
    description: 'A nice widget',
    price: 10,
    quantity: 5,
    in_stock: true,
    status: ProductStatus.ACTIVE,
    images: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function searchResponse(hits: any[] = [productDoc()]) {
  return mockResponse(
    {
      hits: {
        hits: hits.map((h, i) => ({ _id: h.product_id, _source: h, sort: [i] })),
      },
    },
    200,
    true
  );
}

describe('ElasticsearchProductIndex', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockResponse({}, 200, true)); // alias exists by default
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should accept a valid HTTP Elasticsearch URL', () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      expect(index).toBeInstanceOf(ElasticsearchProductIndex);
    });

    it('should accept a valid HTTPS Elasticsearch URL', () => {
      const index = new ElasticsearchProductIndex('https://es.example.com:9200');
      expect(index).toBeInstanceOf(ElasticsearchProductIndex);
    });

    it('should reject a value that is not a URL', () => {
      expect(() => new ElasticsearchProductIndex('not-a-url')).toThrow(
        'ELASTICSEARCH_URL_INVALID'
      );
    });

    it('should reject non-HTTP(S) protocols', () => {
      expect(() => new ElasticsearchProductIndex('ftp://localhost:9200')).toThrow(
        'ELASTICSEARCH_URL_INVALID'
      );
    });

    it('should reject URLs with query string or hash', () => {
      expect(() => new ElasticsearchProductIndex('http://localhost:9200?q=1')).toThrow(
        'ELASTICSEARCH_URL_INVALID'
      );
      expect(() => new ElasticsearchProductIndex('http://localhost:9200#x')).toThrow(
        'ELASTICSEARCH_URL_INVALID'
      );
    });

    it('should strip trailing slash and report not durable', () => {
      const index = new ElasticsearchProductIndex('http://localhost:9200/');
      expect(index.durable).toBe(false);
    });
  });

  describe('ensureIndex', () => {
    it('should create index and alias when alias does not exist (404)', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock
        .mockResolvedValueOnce(mockResponse({}, 404, false)) // GET _alias/products -> 404
        .mockResolvedValueOnce(mockResponse({}, 200, true)) // PUT products_v1
        .mockResolvedValueOnce(mockResponse({}, 200, true)); // POST _aliases

      await index.ensureIndex();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const createCall = fetchMock.mock.calls[1];
      expect(String(createCall[0])).toContain('/products_v1');
      expect(createCall[1].method).toBe('PUT');
      const body = JSON.parse(createCall[1].body as string);
      expect(body.mappings.properties.category_path.type).toBe('keyword');
      expect(body.mappings.properties.name.type).toBe('text');
    });

    it('should do nothing when alias already exists', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      // default mock returns alias exists (200)
      await index.ensureIndex();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/_alias/products');
    });

    it('should throw ELASTICSEARCH_INDEX_FAILED on alias error other than 404', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock.mockResolvedValueOnce(mockResponse({}, 500, false));
      await expect(index.ensureIndex()).rejects.toThrow(
        'ELASTICSEARCH_INDEX_FAILED'
      );
    });

    it('should throw ELASTICSEARCH_INDEX_FAILED when index creation fails', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock
        .mockResolvedValueOnce(mockResponse({}, 404, false))
        .mockResolvedValueOnce(mockResponse({}, 500, false));
      await expect(index.ensureIndex()).rejects.toThrow(
        'ELASTICSEARCH_INDEX_FAILED'
      );
    });

    it('should throw ELASTICSEARCH_INDEX_FAILED when alias creation fails', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock
        .mockResolvedValueOnce(mockResponse({}, 404, false))
        .mockResolvedValueOnce(mockResponse({}, 200, true))
        .mockResolvedValueOnce(mockResponse({}, 500, false));
      await expect(index.ensureIndex()).rejects.toThrow(
        'ELASTICSEARCH_INDEX_FAILED'
      );
    });

    it('should throw ELASTICSEARCH_INDEX_FAILED when fetch throws', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock.mockRejectedValueOnce(new Error('network down'));
      await expect(index.ensureIndex()).rejects.toThrow(
        'ELASTICSEARCH_INDEX_FAILED'
      );
    });
  });

  describe('durable', () => {
    it('should be false when no sync is provided', () => {
      expect(new ElasticsearchProductIndex(baseUrl).durable).toBe(false);
    });

    it('should be true when a sync is provided', () => {
      const sync = { publish: vi.fn() };
      expect(new ElasticsearchProductIndex(baseUrl, fetch, sync).durable).toBe(
        true
      );
    });
  });

  describe('indexProduct', () => {
    const product = Product.reconstruct({
      id: 'prod-1',
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
      name: 'Widget',
      description: 'A nice widget',
      price: 10,
      quantity: 5,
      status: ProductStatus.ACTIVE,
      images: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    } as any);

    it('should index a product via the writer when not durable', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      // ensureIndex (alias exists) then bulk put
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true));
      fetchMock.mockResolvedValueOnce(bulkResponse('prod-1', 'created', 201));

      await index.indexProduct(product);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [bulkUrl, bulkInit] = fetchMock.mock.calls[1];
      expect(String(bulkUrl)).toContain('/_bulk');
      expect(bulkInit.method).toBe('POST');
      const ndjson = bulkInit.body as string;
      const lines = ndjson.split('\n').filter(Boolean);
      expect(JSON.parse(lines[0])).toEqual({ index: { _id: 'prod-1' } });
      const doc = JSON.parse(lines[1]);
      expect(doc.product_id).toBe('prod-1');
      expect(doc.name).toBe('Widget');
      expect(doc.in_stock).toBe(true);
    });

    it('should delegate to sync.publish when durable and not touch fetch', async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const sync = { publish };
      const index = new ElasticsearchProductIndex(baseUrl, fetch, sync);

      await index.indexProduct(product);

      expect(publish).toHaveBeenCalledWith('prod-1');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should index with in_stock false when quantity is zero', async () => {
      const outOfStock = Product.reconstruct({ ...product, id: 'prod-2', quantity: 0 } as any);
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex
      fetchMock.mockResolvedValueOnce(bulkResponse('prod-2', 'updated', 200));

      await index.indexProduct(outOfStock);

      const [, bulkInit] = fetchMock.mock.calls[1];
      const ndjson = bulkInit.body as string;
      const doc = JSON.parse(ndjson.split('\n').filter(Boolean)[1]);
      expect(doc.in_stock).toBe(false);
    });
  });

  describe('search', () => {
    // index.search calls ensureIndex (1 fetch: GET _alias -> alias exists)
    // then _search (1 fetch). Queue both responses in order.
    function setupSearch(customResponse: ReturnType<typeof mockResponse>) {
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex
      fetchMock.mockResolvedValueOnce(customResponse); // _search
    }

    it('should return all products with match_all when no filters', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      setupSearch(searchResponse([productDoc(), productDoc()]));

      const products = await index.search({});

      expect(products).toHaveLength(2);
      expect(products[0].name).toBe('Widget');
      const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(String(url)).toContain('/_search');
      const body = JSON.parse(init.body as string);
      expect(body.query.bool).toEqual({ must: [{ match_all: {} }], filter: [] });
    });

    it('should perform textual multi_match search on name and description', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      setupSearch(searchResponse());

      await index.search({ search: 'gadget' });

      const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(init.body as string);
      expect(body.query.bool.must).toEqual([
        { multi_match: { query: 'gadget', fields: ['name', 'description'] } },
      ]);
    });

    it('should filter by status', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      setupSearch(searchResponse());

      await index.search({ status: ProductStatus.ACTIVE });

      const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(init.body as string);
      expect(body.query.bool.filter).toContainEqual({
        term: { status: ProductStatus.ACTIVE },
      });
    });

    it('should filter by vendorId', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      setupSearch(searchResponse());

      await index.search({ vendorId: 'vendor-1' });

      const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(init.body as string);
      expect(body.query.bool.filter).toContainEqual({
        term: { vendor_id: 'vendor-1' },
      });
    });

    it('should filter by categoryIds', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      setupSearch(searchResponse());

      await index.search({ categoryIds: ['cat-1', 'cat-2'] });

      const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const body = JSON.parse(init.body as string);
      expect(body.query.bool.filter).toContainEqual({
        terms: { category_id: ['cat-1', 'cat-2'] },
      });
    });

    it('should return empty results when Elasticsearch returns no hits', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      setupSearch(searchResponse([]));

      const products = await index.search({});

      expect(products).toEqual([]);
    });

    it('should throw ELASTICSEARCH_SEARCH_FAILED when response is not ok', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex
      fetchMock.mockResolvedValueOnce(mockResponse({}, 500, false)); // _search
      await expect(index.search({})).rejects.toThrow(
        'ELASTICSEARCH_SEARCH_FAILED'
      );
    });

    it('should throw ELASTICSEARCH_SEARCH_FAILED when response body is invalid JSON', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response); // _search
      await expect(index.search({})).rejects.toThrow(
        'ELASTICSEARCH_SEARCH_FAILED'
      );
    });

    it('should throw ELASTICSEARCH_SEARCH_FAILED when fetch throws', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex
      fetchMock.mockRejectedValueOnce(new Error('network down')); // _search
      await expect(index.search({})).rejects.toThrow(
        'ELASTICSEARCH_SEARCH_FAILED'
      );
    });
  });

  describe('removeProduct', () => {
    it('should throw ELASTICSEARCH_DELETE_UNAVAILABLE', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      await expect(index.removeProduct('prod-1')).rejects.toThrow(
        'ELASTICSEARCH_DELETE_UNAVAILABLE'
      );
    });
  });

  describe('rebuildFromMongo / rebuildFromSource', () => {
    it('should index all products from an array source and report counts', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      const p1 = Product.reconstruct({
        id: 'p1', vendorId: 'v', categoryId: 'c', name: 'A', description: 'd', price: 1, quantity: 1, status: ProductStatus.ACTIVE
      } as any);
      const p2 = Product.reconstruct({
        id: 'p2', vendorId: 'v', categoryId: 'c', name: 'B', description: 'd', price: 2, quantity: 0, status: ProductStatus.ACTIVE
      } as any);
      // ensureIndex + write for p1, then ensureIndex + write for p2
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex p1
      fetchMock.mockResolvedValueOnce(bulkResponse('p1', 'created', 201)); // write p1
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex p2
      fetchMock.mockResolvedValueOnce(bulkResponse('p2', 'created', 201)); // write p2

      const result = await index.rebuildFromMongo([p1, p2]);

      expect(result.total).toBe(2);
      expect(result.indexed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('should count failures when indexing throws', async () => {
      const index = new ElasticsearchProductIndex(baseUrl);
      const p1 = Product.reconstruct({
        id: 'p1', vendorId: 'v', categoryId: 'c', name: 'A', description: 'd', price: 1, quantity: 1, status: ProductStatus.ACTIVE
      } as any);
      const p2 = Product.reconstruct({
        id: 'p2', vendorId: 'v', categoryId: 'c', name: 'B', description: 'd', price: 2, quantity: 0, status: ProductStatus.ACTIVE
      } as any);
      fetchMock.mockResolvedValueOnce(mockResponse({}, 200, true)); // ensureIndex
      fetchMock.mockResolvedValueOnce(bulkResponse('p1', 'created', 201));
      fetchMock.mockRejectedValueOnce(new Error('down')); // p2 fails

      const result = await index.rebuildFromMongo([p1, p2]);

      expect(result.total).toBe(2);
      expect(result.indexed).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('resolveProductSource', () => {
    it('should accept an array of products', async () => {
      const products = [{ id: 'p1', name: 'A' }];
      const result = await resolveProductSource(products);
      expect(result).toEqual(products);
    });

    it('should accept a function returning products', async () => {
      const result = await resolveProductSource(async () => [{ id: 'p1' }]);
      expect(result).toEqual([{ id: 'p1' }]);
    });

    it('should accept an object with a products array', async () => {
      const result = await resolveProductSource({ products: [{ id: 'p1' }] });
      expect(result).toEqual([{ id: 'p1' }]);
    });

    it('should accept an object with a findAll function', async () => {
      const result = await resolveProductSource({
        findAll: async () => [{ id: 'p1' }],
      });
      expect(result).toEqual([{ id: 'p1' }]);
    });

    it('should accept a thenable', async () => {
      const result = await resolveProductSource(Promise.resolve([{ id: 'p1' }]));
      expect(result).toEqual([{ id: 'p1' }]);
    });

    it('should throw PRODUCT_SEARCH_SOURCE_INVALID for invalid source', async () => {
      await expect(resolveProductSource({})).rejects.toThrow(
        'PRODUCT_SEARCH_SOURCE_INVALID'
      );
      await expect(
        resolveProductSource([{ name: 'no id' } as any])
      ).rejects.toThrow('PRODUCT_SEARCH_SOURCE_INVALID');
    });

    it('should throw PRODUCT_SEARCH_SOURCE_FAILED when source function throws', async () => {
      await expect(
        resolveProductSource(async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('PRODUCT_SEARCH_SOURCE_FAILED');
    });
  });

  describe('toDocument roundtrip', () => {
    it('should convert a product to a search document', () => {
      const product = Product.reconstruct({
        id: 'p1',
        vendorId: 'v',
        categoryId: 'c',
        name: 'Widget',
        description: 'A widget',
        price: 9.99,
        quantity: 3,
        status: ProductStatus.ACTIVE,
        images: ['http://localhost/img.jpg'],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      } as any);

      const doc = toDocument(product);
      expect(doc.product_id).toBe('p1');
      expect(doc.vendor_id).toBe('v');
      expect(doc.category_id).toBe('c');
      expect(doc.name).toBe('Widget');
      expect(doc.price).toBe(9.99);
      expect(doc.quantity).toBe(3);
      expect(doc.in_stock).toBe(true);
      expect(doc.status).toBe(ProductStatus.ACTIVE);
      expect(doc.images).toEqual(['http://localhost/img.jpg']);
    });
  });
});
