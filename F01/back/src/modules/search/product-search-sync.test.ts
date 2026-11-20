import { describe, expect, it, vi } from 'vitest';
import { Product } from '../product/product.domain';
import { ProductSearchSync, shutdownProductSearch } from './product-search-sync';
import { ElasticsearchProductWriter } from './elasticsearch-product-writer';
import { ElasticsearchProductIndex } from './elasticsearch-product-index';

function fixture(id = 'p1', quantity = 10) {
  return Product.create({ id, vendorId: 'v1', categoryId: 'c1', name: 'Product', description: 'd', price: 10, quantity } as any);
}

function store() {
  const rows = new Map<string, any>();
  const commit = (id = 'p1', quantity = 10) => {
    const old = rows.get(id);
    rows.set(id, { product: fixture(id, quantity), revision: (old?.revision ?? 0) + 1,
      attempts: 0, retryAt: new Date(0), pending: true });
  };
  const copy = (row: any) => ({ ...row });
  const repo = {
    readPendingSearchSnapshots: vi.fn(async (limit: number, now: Date) => [...rows.values()]
      .filter(row => row.pending && row.retryAt <= now).sort((a, b) => +a.retryAt - +b.retryAt)
      .slice(0, limit).map(copy)),
    enqueueSearch: vi.fn(async (id: string) => {
      const row = rows.get(id);
      if (!row) throw new Error('PRODUCT_NOT_FOUND');
      if (!row.pending) Object.assign(row, { pending: true, attempts: 0, retryAt: new Date(0) });
      return copy(row);
    }),
    acknowledgeSearch: vi.fn(async (id: string, revision: number) => {
      const row = rows.get(id);
      if (!row?.pending || row.revision !== revision) return false;
      row.pending = false;
      return true;
    }),
    retrySearch: vi.fn(async (id: string, revision: number, attempts: number, at: Date) => {
      const row = rows.get(id);
      if (!row?.pending || row.revision !== revision || row.attempts !== attempts) return false;
      row.attempts = Math.min(attempts + 1, 30);
      row.retryAt = at;
      return true;
    }),
  };
  return { rows, repo, commit };
}

function delivery() {
  const documents = new Map<string, { revision: number; quantity: number }>();
  const writer = { putVersioned: vi.fn(async (id: string, document: any, revision: number) => {
    if ((documents.get(id)?.revision ?? 0) < revision) documents.set(id, { revision, quantity: document.quantity });
  }) };
  return { documents, writer };
}

describe('durable product search recovery (isolated ports)', () => {
  it('restarts without seed and delivers only the latest committed state after outage', async () => {
    const s = store(); const d = delivery(); let now = new Date(1000);
    s.commit();
    const first = new ProductSearchSync(s.repo, { putVersioned: vi.fn().mockRejectedValue(new Error('unavailable')) }, async () => {}, { now: () => now });
    await first.tick();
    expect(s.rows.get('p1')).toMatchObject({ pending: true, attempts: 1 });
    s.commit('p1', 4); s.commit('p1', 7);
    await first.stop();
    const restarted = new ProductSearchSync(s.repo, d.writer, async () => {}, { now: () => now });
    await restarted.tick();
    expect(d.documents.get('p1')).toEqual({ revision: 3, quantity: 7 });
    expect(s.rows.get('p1').pending).toBe(false);
    await restarted.stop();
  });

  it('two workers with N delayed past N+1 cannot regress or acknowledge the newer intent', async () => {
    const s = store(); const d = delivery(); s.commit();
    let release!: () => void; let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const delayed = { putVersioned: vi.fn(async (...args: Parameters<typeof d.writer.putVersioned>) => {
      entered(); await blocked; await d.writer.putVersioned(...args);
    }) };
    const a = new ProductSearchSync(s.repo, delayed, async () => {});
    const b = new ProductSearchSync(s.repo, d.writer, async () => {});
    const old = a.tick(); await ready; s.commit('p1', 2); await b.tick(); release(); await old;
    expect(d.documents.get('p1')).toEqual({ revision: 2, quantity: 2 });
    expect(s.repo.acknowledgeSearch).toHaveBeenCalledWith('p1', 1);
    expect(s.rows.get('p1').revision).toBe(2);
    await a.stop(); await b.stop();
  });

  it('acknowledging N leaves a not-yet-delivered N+1 pending', async () => {
    const s = store(); const d = delivery(); s.commit();
    d.writer.putVersioned.mockImplementationOnce(async () => { s.commit('p1', 1); });
    const worker = new ProductSearchSync(s.repo, d.writer, async () => {});
    await worker.tick();
    expect(s.rows.get('p1')).toMatchObject({ revision: 2, pending: true });
    await worker.tick();
    expect(s.rows.get('p1').pending).toBe(false);
    await worker.stop();
  });

  it('persists backoff, bounds batches and lets healthy products progress', async () => {
    const s = store(); const d = delivery(); let now = new Date(1000);
    s.commit('bad'); s.commit('good');
    d.writer.putVersioned.mockImplementation(async id => { if (id === 'bad') throw new Error('mapping'); });
    const worker = new ProductSearchSync(s.repo, d.writer, async () => {}, { batchSize: 1, now: () => now });
    await worker.tick(); await worker.tick();
    expect(s.rows.get('bad')).toMatchObject({ pending: true, attempts: 1, retryAt: new Date(2000) });
    expect(s.rows.get('good').pending).toBe(false);
    await worker.tick(); expect(d.writer.putVersioned).toHaveBeenCalledTimes(2);
    now = new Date(2000); await worker.tick();
    expect(s.rows.get('bad')).toMatchObject({ attempts: 2, retryAt: new Date(4000) });
    await worker.stop();
  });

  it('replays after send-before-ack failure without losing pending or duplicating content', async () => {
    const s = store(); const d = delivery(); s.commit();
    s.repo.acknowledgeSearch.mockRejectedValueOnce(new Error('ambiguous'));
    const worker = new ProductSearchSync(s.repo, d.writer, async () => {}, { now: () => new Date(1000) });
    await worker.tick(); expect(s.rows.get('p1').pending).toBe(true);
    const restarted = new ProductSearchSync(s.repo, d.writer, async () => {}, { now: () => new Date(5000) });
    await restarted.tick(); expect(s.rows.get('p1').pending).toBe(false);
    expect(d.writer.putVersioned).toHaveBeenCalledTimes(2);
    expect(d.documents.size).toBe(1);
    await worker.stop(); await restarted.stop();
  });

  it('runtime adapter ignores stale memory payloads and counts only acknowledged deliveries', async () => {
    const s = store(); const d = delivery(); s.commit('p1', 3);
    const sync = new ProductSearchSync(s.repo, d.writer, async () => {});
    const http = vi.fn(); const index = new ElasticsearchProductIndex('http://localhost:9200', http, sync);
    await index.indexProduct(fixture('p1', 99));
    expect(d.documents.get('p1')?.quantity).toBe(3);
    expect(http).not.toHaveBeenCalled();
    const rebuilt = await index.rebuildFromMongo(Promise.resolve([fixture('p1', 88)]));
    expect(rebuilt).toMatchObject({ indexed: 1, failed: 0 });
    d.writer.putVersioned.mockRejectedValue(new Error('offline'));
    const failed = await index.rebuildFromMongo([fixture('p1', 88)]);
    expect(failed).toMatchObject({ indexed: 0, failed: 1 });
    expect(s.rows.get('p1').pending).toBe(true);
    await sync.stop();
  });

  it('retries ensureIndex after boot failure and closes Mongo only after aborted delivery drains', async () => {
    const s = store(); s.commit(); const order: string[] = [];
    const ensure = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const writer = { putVersioned: vi.fn(async (_id, _doc, _rev, signal: AbortSignal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { order.push('aborted'); resolve(); }, { once: true }));
    }) };
    let now = new Date(1000);
    const sync = new ProductSearchSync(s.repo, writer, ensure, { now: () => now });
    await sync.tick(); expect(writer.putVersioned).not.toHaveBeenCalled();
    now = new Date(5000);
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const implementation = writer.putVersioned.getMockImplementation()!;
    writer.putVersioned.mockImplementation(async (...args) => { entered(); await implementation(...args); });
    const tick = sync.tick(); await ready;
    await shutdownProductSearch(sync, async () => { order.push('mongo-closed'); }); await tick;
    expect(order).toEqual(['aborted', 'mongo-closed']);
    expect(s.rows.get('p1').pending).toBe(true);
    await expect(sync.publish('p1')).rejects.toThrow('PRODUCT_SEARCH_STOPPED');
  });

  it('does not overlap ticks and start schedules autonomous recovery', async () => {
    vi.useFakeTimers();
    try {
      const s = store(); const d = delivery(); s.commit();
      const worker = new ProductSearchSync(s.repo, d.writer, async () => {}, { intervalMs: 100 });
      worker.start(); await vi.advanceTimersByTimeAsync(200);
      expect(s.rows.get('p1').pending).toBe(false);
      const a = worker.tick(); const b = worker.tick(); await Promise.all([a, b]);
      await worker.stop(); const calls = s.repo.readPendingSearchSnapshots.mock.calls.length;
      await vi.advanceTimersByTimeAsync(500); expect(s.repo.readPendingSearchSnapshots).toHaveBeenCalledTimes(calls);
    } finally { vi.useRealTimers(); }
  });

  it('fences actual HTTP bulk update envelopes, replacing full documents and accepting noop', async () => {
    const http = vi.fn(async () => new Response(JSON.stringify({ errors: false,
      items: [{ update: { _id: 'p1', status: 200, result: 'noop' } }] })));
    await new ElasticsearchProductWriter('http://localhost:9200', http).putVersioned('p1', { quantity: 3 }, 2);
    const [url, options] = http.mock.calls[0] as any;
    expect(url).toContain('require_alias=true'); expect(options.redirect).toBe('error');
    const [action, body] = options.body.trim().split('\n').map(JSON.parse);
    expect(action).toEqual({ update: { _id: 'p1', retry_on_conflict: 3 } });
    expect(body.upsert).toEqual({ quantity: 3, search_revision: 2 });
    expect(body.script.params).toEqual({ revision: 2, document: body.upsert });
    expect(body.script.source).toContain('ctx._source.clear()');
    expect(body.script.source).toContain("ctx.op = 'noop'");
  });

  it('ambiguous HTTP timeout after application replays as noop through the same revision fence', async () => {
    const s = store(); s.commit(); let applied = 0; let now = new Date(1000);
    const revisions = new Map<string, number>(); let timeout = true;
    const http = vi.fn(async (_url, options) => {
      const [action, body] = String(options.body).trim().split('\n').map(JSON.parse);
      const id = action.update._id; const revision = body.script.params.revision;
      const newer = (revisions.get(id) ?? 0) < revision;
      if (newer) { revisions.set(id, revision); applied++; }
      if (timeout) { timeout = false; throw new Error('synthetic timeout after send'); }
      return new Response(JSON.stringify({ errors: false, items: [{ update: { _id: id, status: 200, result: 'noop' } }] }));
    });
    const worker = new ProductSearchSync(s.repo, new ElasticsearchProductWriter('http://localhost:9200', http), async () => {}, { now: () => now });
    await worker.tick(); expect(s.rows.get('p1')).toMatchObject({ pending: true, attempts: 1 });
    now = new Date(5000); await worker.tick();
    expect(s.rows.get('p1').pending).toBe(false); expect(applied).toBe(1);
    await worker.stop();
  });

  it('HTTP item errors and malformed responses persist retry and do not starve another product', async () => {
    const s = store(); s.commit('bad'); s.commit('good');
    const http = vi.fn(async (_url, options) => {
      const action = JSON.parse(String(options.body).split('\n')[0]); const id = action.update._id;
      if (id === 'bad') return new Response('{');
      return new Response(JSON.stringify({ errors: false, items: [{ update: { _id: id, status: 201, result: 'created' } }] }));
    });
    const worker = new ProductSearchSync(s.repo, new ElasticsearchProductWriter('http://localhost:9200', http), async () => {}, { now: () => new Date(1000), batchSize: 1 });
    await worker.tick(); await worker.tick();
    expect(s.rows.get('bad')).toMatchObject({ pending: true, retryAt: new Date(2000) });
    expect(s.rows.get('good').pending).toBe(false);
    await worker.stop();
  });

  it('supports explicit source shapes by ID and rejects failed/invalid sources rather than empty success', async () => {
    const s = store(); const d = delivery(); s.commit('p1', 2);
    const sync = new ProductSearchSync(s.repo, d.writer, async () => {});
    const index = new ElasticsearchProductIndex('http://localhost:9200', vi.fn(), sync);
    const products = [fixture('p1', 99)];
    for (const source of [products, () => products, { products }, { findAll() { return products; } }, Promise.resolve(products)]) {
      expect(await index.rebuildFromMongo(source)).toMatchObject({ total: 1, indexed: 1 });
      expect(d.documents.get('p1')?.quantity).toBe(2);
    }
    expect(await index.rebuildFromMongo([])).toMatchObject({ total: 0, indexed: 0, failed: 0 });
    for (const source of [undefined, 12, {}, () => ({}), [{ name: 'no ID' }]]) {
      await expect(index.rebuildFromMongo(source)).rejects.toThrow('PRODUCT_SEARCH_SOURCE_INVALID');
    }
    await expect(index.rebuildFromMongo(() => { throw new Error('synthetic provider error'); })).rejects.toThrow('PRODUCT_SEARCH_SOURCE_FAILED');
    await sync.stop();
  });
});
