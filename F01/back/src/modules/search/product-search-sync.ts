import type { PendingProductSearchSnapshot } from '../product/product.mongo.repository';
import { toDocument } from './elasticsearch-product-index';

export interface ProductSearchStore {
  readPendingSearchSnapshots(limit: number, now: Date, afterId?: string): Promise<PendingProductSearchSnapshot[]>;
  enqueueSearch(id: string): Promise<PendingProductSearchSnapshot>;
  acknowledgeSearch(id: string, revision: number): Promise<boolean>;
  retrySearch(id: string, revision: number, attempts: number, at: Date, expectedRetryAt?: Date): Promise<boolean>;
}

interface VersionedProductWriter {
  putVersioned(id: string, document: Record<string, unknown>, revision: number, signal?: AbortSignal): Promise<void>;
}

/** Projection delivery, not a domain event log. Mongo snapshots are the only payload source. */
export class ProductSearchSync {
  private readonly abort = new AbortController();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly now: () => Date;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private activeTick?: Promise<void>;
  private stopped = false;
  private started = false;
  private afterId = '';

  constructor(private readonly store: ProductSearchStore, private readonly writer: VersionedProductWriter,
    private readonly ensureIndex: () => Promise<void>, options: { now?: () => Date; batchSize?: number; intervalMs?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.batchSize = options.batchSize ?? 25;
    this.intervalMs = options.intervalMs ?? 1000;
    if (!Number.isSafeInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 100
      || !Number.isSafeInteger(this.intervalMs) || this.intervalMs < 10 || this.intervalMs > 60_000) {
      throw new Error('PRODUCT_SEARCH_OPTIONS_INVALID');
    }
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    const promise = Promise.resolve().then(operation);
    this.operations.add(promise);
    void promise.then(() => this.operations.delete(promise), () => this.operations.delete(promise));
    return promise;
  }

  /** Compatibility publication resolves only after delivery+CAS, never after enqueue alone. */
  publish(id: string): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('PRODUCT_SEARCH_STOPPED'));
    return this.track(async () => {
      const snapshot = await this.store.enqueueSearch(id);
      if (this.stopped) throw new Error('PRODUCT_SEARCH_STOPPED');
      if (snapshot.retryAt && snapshot.retryAt > this.now()) throw new Error('PRODUCT_SEARCH_PENDING');
      if (!await this.deliver(snapshot)) throw new Error('PRODUCT_SEARCH_PENDING');
    });
  }

  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.activeTick) return this.activeTick;
    const operation = this.track(async () => {
      try {
        const snapshots = await this.store.readPendingSearchSnapshots(this.batchSize, this.now(), this.afterId);
        for (const snapshot of snapshots) {
          if (this.stopped) break;
          await this.deliver(snapshot);
          this.afterId = snapshot.product.id;
        }
      } catch {
        // Store outages retain durable intent. The next scheduled tick retries.
      }
    });
    this.activeTick = operation;
    void operation.then(() => { this.activeTick = undefined; });
    return operation;
  }

  private async deliver(snapshot: PendingProductSearchSnapshot): Promise<boolean> {
    const { product, revision } = snapshot;
    const attempts = snapshot.attempts ?? 0;
    try {
      if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(attempts) || attempts < 0 || attempts > 30) {
        throw new Error('PRODUCT_SEARCH_REVISION_INVALID');
      }
      await this.ensureIndex();
      if (this.stopped) return false;
      await this.writer.putVersioned(product.id, toDocument(product), revision, this.abort.signal);
      if (this.stopped) return false;
      return await this.store.acknowledgeSearch(product.id, revision);
    } catch {
      if (!this.stopped) {
        const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
        try { await this.store.retrySearch(product.id, revision, attempts, new Date(this.now().getTime() + delay), snapshot.retryAt); } catch { /* pending survives */ }
      }
      return false;
    }
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    const run = async () => {
      await this.tick();
      if (!this.stopped) { this.timer = setTimeout(run, this.intervalMs); this.timer.unref?.(); }
    };
    void run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.abort.abort();
    // HTTP is abortable/5s bounded, Mongo sync commands have timeoutMS=5s.
    // No new operations are admitted, nor are acknowledgments issued after abort.
    await Promise.allSettled([...this.operations]);
  }
}

export async function shutdownProductSearch(sync: ProductSearchSync | undefined, closeMongo: () => Promise<void>): Promise<void> {
  await sync?.stop();
  await closeMongo();
}
