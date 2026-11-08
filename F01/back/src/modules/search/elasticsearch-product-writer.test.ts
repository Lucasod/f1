import { describe, expect, it, vi } from 'vitest';
import { ElasticsearchProductWriter } from './elasticsearch-product-writer';

const base = 'http://localhost:9200';
const bulk = (action: string, item: object, errors = false) =>
  new Response(JSON.stringify({ errors, items: [{ [action]: item }] }), { status: 200 });

describe('Elasticsearch product writer', () => {
  it('aborts versioned HTTP on shutdown and sanitizes the transport failure', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('synthetic transport details')), { once: true });
      controller.abort();
    }));
    await expect(new ElasticsearchProductWriter(base, fetcher).putVersioned('p1', {}, Number.MAX_SAFE_INTEGER, controller.signal))
      .rejects.toThrow(/^ELASTICSEARCH_WRITE_FAILED$/);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('uses revision fencing and accepts only identified update results', async () => {
    for (const result of ['created', 'updated', 'noop']) {
      const fetcher = vi.fn().mockResolvedValue(bulk('update', { _id: 'p1', status: result === 'created' ? 201 : 200, result }));
      await expect(new ElasticsearchProductWriter(base, fetcher).putVersioned('p1', { quantity: 1 }, 1)).resolves.toBeUndefined();
    }
    for (const response of [bulk('index', { _id: 'p1', status: 200, result: 'updated' }),
      bulk('update', { _id: 'other', status: 200, result: 'noop' }),
      bulk('update', { _id: 'p1', status: 409, result: 'noop' }),
      bulk('update', { _id: 'p1', status: 200, result: 'noop', error: {} }),
      bulk('update', { _id: 'p1', status: 200, result: 'deleted' }),
      new Response('{}'), new Response('{'), bulk('update', { _id: 'p1', status: 200, result: 'noop' }, true)]) {
      await expect(new ElasticsearchProductWriter(base, vi.fn().mockResolvedValue(response)).putVersioned('p1', {}, 1)).rejects.toThrow('ELASTICSEARCH_WRITE_FAILED');
    }
    const fetcher = vi.fn();
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      await expect(new ElasticsearchProductWriter(base, fetcher).putVersioned('p1', {}, revision)).rejects.toThrow('PRODUCT_SEARCH_REVISION_INVALID');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects deletion before any network request, even if the provider would succeed', async () => {
    const fetcher = vi.fn().mockResolvedValue(bulk('delete', { _id: 'p1', status: 200, result: 'deleted' }));
    await expect(new ElasticsearchProductWriter(base, fetcher).delete('p1')).rejects.toThrow('ELASTICSEARCH_DELETE_UNAVAILABLE');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('writes an identified document through an existing alias using bulk NDJSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(bulk('index', { _id: 'product/1', status: 201, result: 'created' }));
    await new ElasticsearchProductWriter(base, fetcher).put('product/1', { product_id: 'product/1', name: 'Example' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`${base}/products/_bulk?require_alias=true`);
    expect(options.method).toBe('POST');
    expect(options.headers['content-type']).toBe('application/x-ndjson');
    expect(options.body).toBe('{"index":{"_id":"product/1"}}\n{"product_id":"product/1","name":"Example"}\n');
  });

  it('rejects deletion regardless of document ID without a network request', async () => {
    const fetcher = vi.fn();
    const writer = new ElasticsearchProductWriter(base, fetcher);
    for (const id of ['', '.', '..', 'p1']) {
      await expect(writer.delete(id)).rejects.toThrow('ELASTICSEARCH_DELETE_UNAVAILABLE');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for item errors, malformed bulk results and transport errors', async () => {
    const responses = [
      new Response('{}', { status: 404 }), new Response('{}', { status: 503 }),
      bulk('index', { _id: 'p1', status: 404, error: { type: 'index_not_found_exception' } }, true),
      bulk('index', { _id: 'p1', status: 200, result: 'updated', error: { type: 'other' } }, true),
      bulk('index', { _id: 'p1', status: 200, result: 'updated' }, true),
      bulk('index', { _id: 'other', status: 200, result: 'updated' }),
      new Response('{', { status: 200 }), new Response('{}', { status: 200 }),
      new Response(JSON.stringify({ errors: false, items: [] }), { status: 200 }),
    ];
    for (const response of responses) {
      await expect(new ElasticsearchProductWriter(base, vi.fn().mockResolvedValue(response)).put('p1', { product_id: 'p1' })).rejects.toThrow('ELASTICSEARCH_WRITE_FAILED');
    }
    const writer = new ElasticsearchProductWriter(base, vi.fn().mockRejectedValue(new Error('synthetic provider error')));
    await expect(writer.put('p1', { product_id: 'p1' })).rejects.toThrow('ELASTICSEARCH_WRITE_FAILED');
    const failedIndex = vi.fn().mockResolvedValue(bulk('index', { _id: 'p1', status: 400, error: { type: 'mapping_error' } }, true));
    await expect(new ElasticsearchProductWriter(base, failedIndex).put('p1', { product_id: 'p1' })).rejects.toThrow('ELASTICSEARCH_WRITE_FAILED');
  });

  it.each([307, 308])('refuses redirect %i and does not send to a second destination', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status, headers: { location: '/other' } }));
    await expect(new ElasticsearchProductWriter(base, fetcher).put('p1', { product_id: 'p1' })).rejects.toThrow('ELASTICSEARCH_WRITE_FAILED');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
  });

  it('aborts a request that does not respond', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('timeout')));
    }));
    await expect(new ElasticsearchProductWriter(base, fetcher).put('p1', { product_id: 'p1' })).rejects.toThrow('ELASTICSEARCH_WRITE_FAILED');
  }, 7000);

  it('sanitizes invalid URL errors', () => {
    try {
      new ElasticsearchProductWriter('invalid synthetic value');
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as Error).message).toBe('ELASTICSEARCH_URL_INVALID');
    }
  });

  it('rejects empty and path traversal document IDs without a request', async () => {
    const fetcher = vi.fn();
    const writer = new ElasticsearchProductWriter(base, fetcher);
    for (const id of ['', '.', '..']) {
      await expect(writer.put(id, {})).rejects.toThrow('ELASTICSEARCH_PRODUCT_ID_INVALID');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
