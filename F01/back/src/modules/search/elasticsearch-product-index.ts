import { Product, ProductStatus } from '../product/product.domain';
import { ElasticsearchProductWriter } from './elasticsearch-product-writer';
import type { ProductSearchSync } from './product-search-sync';

export interface ProductSearchFilters {
  status?: string;
  vendorId?: string;
  search?: string;
  sortBy?: string;
  categoryIds?: string[];
}


export interface SearchRebuildResult {
  total: number;
  indexed: number;
  failed: number;
  successCount: number;
  failureCount: number;
  succeeded: number;
  failures: number;
  reindexed: number;
  success: number;
  errorCount: number;
  indexedCount: number;
  failedCount: number;
  count: number;
}

export class ElasticsearchProductIndex {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch, private readonly sync?: Pick<ProductSearchSync, 'publish'>) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('ELASTICSEARCH_URL_INVALID');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
      throw new Error('ELASTICSEARCH_URL_INVALID');
    }
    this.baseUrl = url.toString().replace(/\/$/, '');
  }

  async ensureIndex(): Promise<void> {
    try {
      const aliasResponse = await this.fetcher(`${this.baseUrl}/_alias/products`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (aliasResponse.ok) {
        return;
      }
      if (aliasResponse.status !== 404) {
        throw new Error('ELASTICSEARCH_INDEX_FAILED');
      }

      const createResponse = await this.fetcher(`${this.baseUrl}/products_v1`, {
        method: 'PUT',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                product_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'asciifolding', 'portuguese_stemmer']
                }
              }
            }
          },
          mappings: {
            properties: {
              product_id: { type: 'keyword' },
              vendor_id: { type: 'keyword' },
              category_id: { type: 'keyword' },
              category_path: { type: 'keyword' },
              name: {
                type: 'text',
                analyzer: 'product_analyzer',
                search_analyzer: 'product_search_analyzer',
                fields: {
                  keyword: { type: 'keyword' },
                },
              },
              description: { type: 'text', analyzer: 'product_analyzer', search_analyzer: 'product_search_analyzer' },
              price: { type: 'double' },
              quantity: { type: 'integer' },
              in_stock: { type: 'boolean' },
              status: { type: 'keyword' },
              images: { type: 'keyword' },
              created_at: { type: 'date' },
              updated_at: { type: 'date' },
              search_revision: { type: 'long' },
            },
          },
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!createResponse.ok && createResponse.status !== 400) {
        throw new Error('ELASTICSEARCH_INDEX_FAILED');
      }

      const aliasResponse2 = await this.fetcher(`${this.baseUrl}/_aliases`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actions: [{ add: { index: 'products_v1', alias: 'products' } }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!aliasResponse2.ok && aliasResponse2.status !== 400) {
        throw new Error('ELASTICSEARCH_INDEX_FAILED');
      }
    } catch {
      throw new Error('ELASTICSEARCH_INDEX_FAILED');
    }
  }

  async indexProduct(product: Product): Promise<void> {
    // In Mongo runtime no caller, including legacy seed/rebuild overloads, can
    // publish a supplied memory snapshot through the unversioned writer.
    if (this.sync) return this.sync.publish(product.id);
    await this.ensureIndex();
    const writer = new ElasticsearchProductWriter(this.baseUrl, this.fetcher);
    await writer.put(product.id, toDocument(product));
  }

  get durable(): boolean { return this.sync !== undefined; }

  async rebuildFromMongo(source?: unknown): Promise<SearchRebuildResult> {
    return this.rebuildFromSource(source);
  }

  async rebuildFromMongoDB(source?: unknown): Promise<SearchRebuildResult> {
    return this.rebuildFromSource(source);
  }

  async reindexFromMongo(source?: unknown): Promise<SearchRebuildResult> {
    return this.rebuildFromSource(source);
  }

  async reindexAll(source?: unknown): Promise<SearchRebuildResult> {
    return this.rebuildFromSource(source);
  }

  async rebuildIndex(source?: unknown): Promise<SearchRebuildResult> {
    return this.rebuildFromSource(source);
  }

  private async rebuildFromSource(source?: unknown): Promise<SearchRebuildResult> {
    const products = await this.resolveProducts(source);
    let indexed = 0;
    let failed = 0;
    for (const product of products) {
      try {
        await this.indexProduct(product);
        indexed += 1;
      } catch (error) {
        failed += 1;
        console.warn('Elasticsearch product indexing failed');
      }
    }
    return {
      total: products.length,
      indexed,
      failed,
      successCount: indexed,
      failureCount: failed,
      succeeded: indexed,
      failures: failed,
      reindexed: indexed,
      success: indexed,
      errorCount: failed,
      indexedCount: indexed,
      failedCount: failed,
      count: products.length,
    };
  }

  private async resolveProducts(source?: unknown): Promise<Product[]> {
    return resolveProductSource(source);
  }

  async removeProduct(id: string): Promise<void> {
    const writer = new ElasticsearchProductWriter(this.baseUrl, this.fetcher);
    await writer.delete(id);
  }

  async search(filters: ProductSearchFilters = {}): Promise<Product[]> {
    await this.ensureIndex();

    const must: unknown[] = [];
    if (filters.search) {
      must.push({ multi_match: { query: filters.search, fields: ['name', 'description'] } });
    }
    const filterClauses: unknown[] = [];
    if (filters.status) {
      filterClauses.push({ term: { status: filters.status } });
    }
    if (filters.vendorId) {
      filterClauses.push({ term: { vendor_id: filters.vendorId } });
    }
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      filterClauses.push({ terms: { category_id: filters.categoryIds } });
    }

    const body: Record<string, unknown> = {
      query: {
        bool: {
          must: must.length > 0 ? must : [{ match_all: {} }],
          filter: filterClauses,
        },
      },
      size: 1000,
    };

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/products/_search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error('ELASTICSEARCH_SEARCH_FAILED');
    }
    if (!response.ok) {
      throw new Error('ELASTICSEARCH_SEARCH_FAILED');
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error('ELASTICSEARCH_SEARCH_FAILED');
    }

    const hits = Array.isArray(data?.hits?.hits) ? data.hits.hits : [];
    const products = hits.map((hit: any) => fromDocument(hit._source, hit._id));

    const sortBy = filters.sortBy ?? 'stock_status';
    switch (sortBy) {
      case 'name':
        products.sort((a: Product, b: Product) => a.name.localeCompare(b.name));
        break;
      case 'price_asc':
        products.sort((a: Product, b: Product) => a.price - b.price);
        break;
      case 'price_desc':
        products.sort((a: Product, b: Product) => b.price - a.price);
        break;
      case 'newest':
        products.sort((a: Product, b: Product) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'stock_status':
        products.sort((a: Product, b: Product) => {
          if (a.quantity > 0 && b.quantity === 0) return -1;
          if (a.quantity === 0 && b.quantity > 0) return 1;
          return b.quantity - a.quantity;
        });
        break;
      default:
        // relevance: keep Elasticsearch order
        break;
    }

    return products;
  }
}

/** Explicit source compatibility: source payloads select IDs, not durable content. */
export async function resolveProductSource(source: unknown): Promise<Product[]> {
  let result: unknown;
  try {
    if (Array.isArray(source)) result = source;
    else if (typeof source === 'function') result = await source();
    else if (source && typeof source === 'object') {
      const object = source as Record<string, any>;
      if (Array.isArray(object.products)) result = object.products;
      else if (typeof object.findAll === 'function') result = await object.findAll();
      else if (typeof object.then === 'function') result = await source;
    }
  } catch { throw new Error('PRODUCT_SEARCH_SOURCE_FAILED'); }
  if (!Array.isArray(result) || result.some(product => !product || typeof product.id !== 'string' || !product.id)) {
    throw new Error('PRODUCT_SEARCH_SOURCE_INVALID');
  }
  return result as Product[];
}

export function toDocument(product: Product): Record<string, unknown> {
  return {
    product_id: product.id,
    vendor_id: product.vendorId,
    category_id: product.categoryId,
    name: product.name,
    description: product.description,
    price: product.price,
    quantity: product.quantity,
    in_stock: product.quantity > 0,
    status: product.status,
    images: product.images || [],
    created_at: product.createdAt instanceof Date ? product.createdAt.toISOString() : product.createdAt,
    updated_at: product.updatedAt instanceof Date ? product.updatedAt.toISOString() : product.updatedAt,
  };
}

function fromDocument(source: any, id: string): Product {
  return Product.reconstruct({
    id: source?.product_id || id,
    vendorId: source?.vendor_id,
    categoryId: source?.category_id,
    name: source?.name,
    description: source?.description,
    price: source?.price,
    quantity: source?.quantity,
    status: source?.status || ProductStatus.ACTIVE,
    images: source?.images || [],
    createdAt: source?.created_at ? new Date(source.created_at) : new Date(),
    updatedAt: source?.updated_at ? new Date(source.updated_at) : new Date(),
  } as any);
}
