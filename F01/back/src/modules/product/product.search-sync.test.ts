import { describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { Product, ProductError, ProductStatus } from './product.domain';
import { MongoProductRepository } from './product.mongo.repository';
import { saveSeedProductIfAbsent, runSeed, runDevelopmentSeed } from '../../scripts/seed';
import { ProductSearchSync } from '../search/product-search-sync';
import { ElasticsearchProductIndex } from '../search/elasticsearch-product-index';
import { ProductService } from './product.service';
import { config } from '../../config';
import { InMemoryCategoryRepository } from './product.domain';
import { InMemoryVendorRepository, Vendor } from '../vendor/vendor.domain';
import { InMemoryPersonRepository, Person } from '../person/person.domain';
import { InMemoryCartRepository } from '../cart/cart.domain';
import { CartService } from '../cart/cart.service';
import { CheckoutService } from '../checkout/checkout.service';
import { StripeService } from '../stripe/stripe.service';
import { InMemoryOrderRepository, InMemoryPaymentRepository } from '../order/order.domain';
import { PaymentService } from '../order/payment.service';

// Deliberately models only the commands used here, not MongoDB server semantics.
// Every mutation is synchronous between match and write, then returns a promise.
function atomicStore() {
  const documents = new Map<string, any>();
  const clone = <T>(value: T): T => structuredClone(value);
  function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, value]: [string, any]) => {
      if (key === '$or') return value.some((part: any) => matches(doc, part));
      if (value instanceof Date) return doc[key] instanceof Date && doc[key].getTime() === value.getTime();
      if (key === '$expr') {
        // Assert the exact production expression separately; model its contract here.
        const read = value.$cond[1].$and.some((part: any) => part.$lte);
        return Number.isSafeInteger(doc.searchRevision) && doc.searchRevision >= (read ? 1 : 0)
          && (read ? doc.searchRevision <= Number.MAX_SAFE_INTEGER : doc.searchRevision < Number.MAX_SAFE_INTEGER);
      }
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.entries(value).every(([operator, operand]: [string, any]) => {
          if (operator === '$exists') return (doc[key] !== undefined) === operand;
          if (operator === '$gte') return doc[key] >= operand;
          if (operator === '$gt') return doc[key] > operand;
          if (operator === '$lte') return doc[key] <= operand;
          throw new Error('UNMODELED_FILTER');
        });
      }
      return doc[key] === value;
    });
  }
  const collection = {
    listIndexes: () => ({ toArray: async () => [{
      key: { seedIdentity: 1 }, unique: true,
      partialFilterExpression: { seedIdentity: { $type: 'string' } },
    }] }),
    updateOne: vi.fn(async (filter: any, update: any, options?: any) => {
      const existing = documents.get(filter._id);
      if (existing && matches(existing, filter)) {
        const next = clone(existing);
        Object.assign(next, clone(update.$set ?? {}));
        for (const [key, amount] of Object.entries(update.$inc ?? {})) {
          next[key] = (next[key] ?? 0) + (amount as number);
        }
        documents.set(next._id, next);
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }
      if (options?.upsert) {
        if (existing) throw Object.assign(new Error('DUPLICATE_ID'), { code: 11000 });
        const next = { _id: filter._id, ...clone(update.$setOnInsert) };
        if (next.seedIdentity && [...documents.values()].some(doc => doc.seedIdentity === next.seedIdentity)) {
          throw Object.assign(new Error('DUPLICATE_SEED_IDENTITY'), { code: 11000 });
        }
        documents.set(next._id, next);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }),
    findOne: vi.fn(async (filter: any) => {
      const doc = documents.get(filter._id);
      return doc && matches(doc, filter) ? clone(doc) : null;
    }),
    find: vi.fn((filter: any) => {
      let limit = Number.MAX_SAFE_INTEGER;
      let byId = false;
      const cursor = {
        sort: vi.fn((sort: any) => { byId = !sort.searchRetryAt; return cursor; }),
        limit: vi.fn((value: number) => { limit = value; return cursor; }),
        toArray: async () => [...documents.values()].filter(doc => matches(doc, filter))
          .sort((a, b) => (byId ? 0 : Number(a.searchRetryAt) - Number(b.searchRetryAt)) || a._id.localeCompare(b._id))
          .slice(0, limit).map(clone),
      };
      return cursor;
    }),
    deleteOne: vi.fn(async (filter: any) => { documents.delete(filter._id); }),
  };
  const db = { collection: () => collection } as unknown as Db;
  return { documents, collection, repo: new MongoProductRepository(db), restart: () => new MongoProductRepository(db) };
}

function product(id = 'product-1', seedIdentity?: string) {
  return Product.reconstruct({
    id, seedIdentity, vendorId: 'vendor-1', categoryId: 'category-1', name: 'Product',
    description: 'Description', price: 10, quantity: 10, status: ProductStatus.ACTIVE,
  });
}

function pending(repo: MongoProductRepository, limit = 100) {
  return repo.readPendingSearchSnapshots(limit, new Date());
}

describe('Mongo product atomic search capture (no services)', () => {
  it('creates content and intent in the same create-only command, including seed saves', async () => {
    const { repo, collection, documents } = atomicStore();
    const saved = await repo.save(product('seed-product', 'catalog-product'));
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: saved.id });
    expect(options).toEqual({ upsert: true });
    expect(Object.keys(update)).toEqual(['$setOnInsert']);
    expect(update.$setOnInsert).toMatchObject({ name: saved.name, quantity: 10,
      searchRevision: 1, searchPending: true, searchAttempts: 0, searchRetryAt: new Date(0) });
    expect(documents.get(saved.id)).toMatchObject(update.$setOnInsert);
    expect(saved).not.toHaveProperty('searchRevision');
  });

  it('keeps intent across process recreation without ES or seed recovery', async () => {
    const store = atomicStore();
    await store.repo.save(product());
    await store.repo.decrementStock('product-1', 3);
    const snapshots = await pending(store.restart());
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ revision: 2, product: { id: 'product-1', quantity: 7 } });
    expect(snapshots[0].product).not.toHaveProperty('searchPending');
    expect(snapshots[0].product).not.toHaveProperty('searchRevision');
    expect(store.collection.find).toHaveBeenCalledWith({ searchPending: true, searchRetryAt: { $lte: expect.any(Date) } }, { timeoutMS: 5000 });
  });

  it('captures the actual seed save path without ES and never resets an existing seed revision', async () => {
    const { repo, collection } = atomicStore();
    const fixture = product('seed-product', 'catalog-product');
    await saveSeedProductIfAbsent(repo, fixture);
    await repo.incrementStock(fixture.id, 5);
    collection.updateOne.mockClear();
    await saveSeedProductIfAbsent(repo, fixture);
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(await pending(repo)).toMatchObject([{ revision: 2, product: { id: fixture.id, quantity: 15 } }]);
  });

  it.each(['update', 'decrementStock', 'incrementStock'] as const)(
    'captures %s and its revision in exactly one guarded write', async writer => {
      const { repo, collection, documents } = atomicStore();
      await repo.save(product());
      documents.get('product-1').searchAttempts = 5;
      collection.updateOne.mockClear();
      if (writer === 'update') await repo.update(Product.reconstruct({ ...product(), price: 17, status: ProductStatus.INACTIVE }));
      else await repo[writer]('product-1', 2);
      expect(collection.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update, options] = collection.updateOne.mock.calls[0];
      expect(options).toBeUndefined();
      expect(filter._id).toBe('product-1');
      expect(filter.$or).toEqual([
        { searchRevision: { $exists: false } },
        { $expr: { $cond: [
          { $isNumber: '$searchRevision' },
          { $and: [
            { $gte: ['$searchRevision', 0] },
            { $lt: ['$searchRevision', Number.MAX_SAFE_INTEGER] },
            { $eq: [{ $mod: ['$searchRevision', 1] }, 0] },
          ] },
          false,
        ] } },
      ]);
      expect(update.$inc.searchRevision).toBe(1);
      expect(update.$set).toMatchObject({ searchPending: true, searchAttempts: 0, searchRetryAt: new Date(0) });
      expect(documents.get('product-1')).toMatchObject({ searchRevision: 2, searchPending: true, searchAttempts: 0,
        quantity: writer === 'decrementStock' ? 8 : writer === 'incrementStock' ? 12 : 10 });
      if (writer === 'update') expect(documents.get('product-1')).toMatchObject({ price: 17, status: ProductStatus.INACTIVE });
      if (writer === 'decrementStock') expect(filter.quantity).toEqual({ $gte: 2 });
    },
  );

  it('captures edits, inactivation, reservation, compensation and refund monotonically', async () => {
    const { repo } = atomicStore();
    await repo.save(product());
    await repo.update(Product.reconstruct({ ...product(), price: 19 }));
    await repo.update(Product.reconstruct({ ...product(), price: 19, status: ProductStatus.INACTIVE }));
    await repo.decrementStock('product-1', 4);
    await repo.incrementStock('product-1', 1);
    await repo.incrementStock('product-1', 3);
    expect(await pending(repo)).toMatchObject([{ revision: 6, product: { quantity: 10, price: 19, status: ProductStatus.INACTIVE } }]);
  });

  it('does not mutate content or intent on create conflict or duplicate seed identity', async () => {
    const { repo, documents } = atomicStore();
    await repo.save(product('product-1', 'catalog-product'));
    const before = structuredClone([...documents]);
    await expect(repo.save(Product.reconstruct({ ...product('product-1'), price: 999 }))).rejects.toThrow(ProductError.PRODUCT_CONFLICT);
    await expect(repo.save(product('other-id', 'catalog-product'))).rejects.toThrow(ProductError.PRODUCT_CONFLICT);
    expect([...documents]).toEqual(before);
  });

  it.each(['update', 'decrementStock', 'incrementStock'] as const)(
    'does not create phantom intent on missing %s', async writer => {
      const { repo, documents } = atomicStore();
      const call = writer === 'update' ? repo.update(product()) : repo[writer]('product-1', 1);
      await expect(call).rejects.toThrow(ProductError.PRODUCT_NOT_FOUND);
      expect(documents.size).toBe(0);
    },
  );

  it('does not increment intent when stock is insufficient, even concurrently', async () => {
    const { repo, documents } = atomicStore();
    await repo.save(product());
    expect(await Promise.all([repo.decrementStock('product-1', 8), repo.decrementStock('product-1', 8)]))
      .toEqual([true, false]);
    expect(documents.get('product-1')).toMatchObject({ quantity: 2, searchRevision: 2 });
  });

  it.each(['update', 'decrementStock', 'incrementStock'] as const)(
    'initializes legacy revision atomically during %s without a separate backfill', async writer => {
      const { repo, documents, collection } = atomicStore();
      documents.set('product-1', { _id: 'product-1', ...product() });
      collection.updateOne.mockClear();
      if (writer === 'update') await repo.update(product());
      else await repo[writer]('product-1', 1);
      expect(collection.updateOne).toHaveBeenCalledTimes(1);
      expect(documents.get('product-1')).toMatchObject({ searchRevision: 1, searchPending: true });
    },
  );

  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, -1, 1.5, null, '1', NaN, Infinity])(
    'rejects unsafe stored revision %s before any business mutation', async revision => {
      const { repo, documents } = atomicStore();
      await repo.save(product());
      documents.get('product-1').searchRevision = revision;
      const before = structuredClone([...documents]);
      await expect(repo.update(product())).rejects.toThrow('PRODUCT_SEARCH_REVISION_INVALID');
      await expect(repo.decrementStock('product-1', 1)).rejects.toThrow('PRODUCT_SEARCH_REVISION_INVALID');
      await expect(repo.incrementStock('product-1', 1)).rejects.toThrow('PRODUCT_SEARCH_REVISION_INVALID');
      expect([...documents]).toEqual(before);
    },
  );

  it('allows the final safe revision but rejects the next mutation', async () => {
    const { repo, documents } = atomicStore();
    await repo.save(product());
    documents.get('product-1').searchRevision = Number.MAX_SAFE_INTEGER - 1;
    await repo.incrementStock('product-1', 1);
    expect((await pending(repo))[0].revision).toBe(Number.MAX_SAFE_INTEGER);
    await expect(repo.incrementStock('product-1', 1)).rejects.toThrow('PRODUCT_SEARCH_REVISION_INVALID');
  });

  it('rejects physical delete before removing either product or embedded intent', async () => {
    const { repo, documents, collection } = atomicStore();
    await repo.save(product());
    await expect(repo.delete('product-1')).rejects.toThrow('PRODUCT_SEARCH_PHYSICAL_DELETE_UNAVAILABLE');
    expect(collection.deleteOne).not.toHaveBeenCalled();
    expect(documents.has('product-1')).toBe(true);
    await expect(repo.delete('missing')).rejects.toThrow('PRODUCT_SEARCH_PHYSICAL_DELETE_UNAVAILABLE');
  });

  it('does not fabricate a pending snapshot on ambiguous commit outcome', async () => {
    const { repo, collection, restart } = atomicStore();
    const commit = collection.updateOne.getMockImplementation()!;
    collection.updateOne.mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new Error('MONGO_AMBIGUOUS');
    });
    await expect(repo.save(product())).rejects.toThrow('MONGO_AMBIGUOUS');
    expect(await pending(restart())).toMatchObject([{ revision: 1, product: { id: 'product-1' } }]);
    expect(collection.find).toHaveBeenCalledTimes(1);
  });

  it('reads bounded due snapshots without acknowledging, and never leaks metadata via ordinary reads', async () => {
    const { repo, documents } = atomicStore();
    expect(await pending(repo)).toEqual([]);
    for (const id of ['a', 'b', 'c']) await repo.save(product(id));
    documents.get('a').searchRetryAt = new Date(Date.now() + 60_000);
    const batch = await pending(repo, 1);
    expect(batch).toMatchObject([{ revision: 1, product: { id: 'b' } }]);
    expect(await pending(repo, 1)).toEqual(batch);
    for (const read of [repo.findById('b'), repo.findAll(), repo.findByVendorId('vendor-1'), repo.findByCategoryId('category-1')]) {
      const value = await read;
      expect(JSON.stringify(value)).not.toMatch(/searchRevision|searchPending|searchRetryAt|searchAttempts/);
    }
    for (const limit of [0, -1, 101, 1.5, Infinity]) {
      await expect(pending(repo, limit)).rejects.toThrow('PRODUCT_SEARCH_BATCH_INVALID');
    }
  });

  it('returns a detached snapshot/revision pair from one persisted read', async () => {
    const { repo, documents } = atomicStore();
    await repo.save(product());
    const batch = await pending(repo);
    await repo.decrementStock('product-1', 1);
    expect(batch).toMatchObject([{ revision: 1, product: { quantity: 10 } }]);
    batch[0].product.images.push('not-persisted');
    expect(documents.get('product-1').images).toEqual([]);
    expect(await pending(repo)).toMatchObject([{ revision: 2, product: { quantity: 9 } }]);
  });

  it('never manufactures intent or success when storage fails before commit', async () => {
    const { repo, documents, collection } = atomicStore();
    collection.updateOne.mockRejectedValueOnce(new Error('MONGO_UNAVAILABLE'));
    await expect(repo.save(product())).rejects.toThrow('MONGO_UNAVAILABLE');
    expect(documents.size).toBe(0);
    expect(await pending(repo)).toEqual([]);
    await repo.save(product());
    const before = structuredClone([...documents]);
    for (const writer of ['update', 'decrementStock', 'incrementStock'] as const) {
      collection.updateOne.mockRejectedValueOnce(new Error('MONGO_UNAVAILABLE'));
      const call = writer === 'update' ? repo.update(product()) : repo[writer]('product-1', 1);
      await expect(call).rejects.toThrow('MONGO_UNAVAILABLE');
      expect([...documents]).toEqual(before);
    }
  });

  it('refuses a corrupt pending revision rather than publishing an unbound snapshot', async () => {
    const { repo, documents } = atomicStore();
    await repo.save(product());
    for (const revision of [undefined, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      documents.get('product-1').searchRevision = revision;
      await expect(pending(repo)).rejects.toThrow('PRODUCT_SEARCH_REVISION_INVALID');
      expect(documents.get('product-1').searchPending).toBe(true);
    }
    await expect(repo.readPendingSearchSnapshots(1, new Date(NaN))).rejects.toThrow('PRODUCT_SEARCH_BATCH_INVALID');
  });

  it('CAS acknowledgment and retry never clear or postpone a newer revision', async () => {
    const { repo, collection, documents } = atomicStore();
    await repo.save(product());
    await repo.decrementStock('product-1', 2);
    expect(await repo.acknowledgeSearch('product-1', 1)).toBe(false);
    expect(await repo.retrySearch('product-1', 1, 0, new Date(5000))).toBe(false);
    expect(await repo.retrySearch('product-1', 2, 0, new Date(5000))).toBe(true);
    expect(await repo.retrySearch('product-1', 2, 0, new Date(6000))).toBe(false);
    expect(documents.get('product-1')).toMatchObject({ searchRevision: 2, searchPending: true, searchAttempts: 1, searchRetryAt: new Date(5000) });
    expect(collection.updateOne).toHaveBeenLastCalledWith(
      { _id: 'product-1', searchRevision: 2, searchPending: true, searchAttempts: 0 },
      { $set: { searchAttempts: 1, searchRetryAt: new Date(6000) } }, expect.objectContaining({ timeoutMS: 5000 }));
    expect(await repo.acknowledgeSearch('product-1', 2)).toBe(true);
    expect(documents.get('product-1').searchPending).toBe(false);
  });

  it('retry CAS still excludes a stale writer when the attempt counter is saturated', async () => {
    const { repo, documents } = atomicStore(); await repo.save(product());
    documents.get('product-1').searchAttempts = 30;
    expect(await repo.retrySearch('product-1', 1, 30, new Date(5000), new Date(0))).toBe(true);
    expect(await repo.retrySearch('product-1', 1, 30, new Date(6000), new Date(0))).toBe(false);
    expect(documents.get('product-1').searchRetryAt).toEqual(new Date(5000));
  });

  it('enqueue initializes legacy metadata by CAS only, never resets revision or business fields', async () => {
    const { repo, documents, collection } = atomicStore();
    documents.set('product-1', { _id: 'product-1', ...product() });
    const before = structuredClone(documents.get('product-1'));
    expect(await repo.enqueueSearch('product-1')).toMatchObject({ revision: 1, product: { quantity: 10 } });
    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'product-1', searchRevision: { $exists: false } });
    expect(update).toEqual({ $set: { searchRevision: 1, searchPending: true, searchAttempts: 0, searchRetryAt: new Date(0) } });
    expect(documents.get('product-1')).toMatchObject(before);
    await repo.incrementStock('product-1', 1);
    await repo.retrySearch('product-1', 2, 0, new Date(5000));
    await repo.enqueueSearch('product-1');
    expect(documents.get('product-1')).toMatchObject({ quantity: 11, searchRevision: 2, searchAttempts: 1, searchRetryAt: new Date(5000) });
    await repo.acknowledgeSearch('product-1', 2);
    expect(await repo.enqueueSearch('product-1')).toMatchObject({ revision: 2 });
    expect(documents.get('product-1').searchPending).toBe(true);
    await expect(repo.enqueueSearch('missing')).rejects.toThrow(ProductError.PRODUCT_NOT_FOUND);
  });

  it('real Mongo command adapter plus service producers converge after restart without seed', async () => {
    const s = atomicStore(); let now = new Date(1000);
    const failing = { putVersioned: vi.fn().mockRejectedValue(new Error('offline')) };
    const sync = new ProductSearchSync(s.repo, failing, async () => {}, { now: () => now });
    const index = new ElasticsearchProductIndex('http://localhost:9200', vi.fn(), sync);
    const service = new ProductService(s.repo, { findById: async () => ({ id: 'category-1' }) } as any,
      { findById: async () => ({ id: 'vendor-1' }) } as any, config, index);
    const saved = await service.createProduct('vendor-1', { vendorId: 'vendor-1', categoryId: 'category-1', name: 'Product', description: 'd', price: 10, quantity: 10 });
    await service.updateProduct(saved.id, 'vendor-1', { price: 15 }, false);
    await service.updateProductStock(saved.id, 'vendor-1', 12, false);
    await service.inactivateProduct(saved.id, 'vendor-1', false);
    await service.activateProduct(saved.id, 'vendor-1', false);
    await s.repo.decrementStock(saved.id, 3); // checkout reservation, same captured Mongo writer
    await s.repo.incrementStock(saved.id, 1); // checkout compensation
    await s.repo.incrementStock(saved.id, 2); // payment stock restoration
    await service.deleteProduct(saved.id, 'vendor-1', false);
    expect(s.documents.get(saved.id)).toMatchObject({ searchRevision: 9, searchPending: true, quantity: 12, status: ProductStatus.INACTIVE });
    await sync.stop(); now = new Date(100_000);
    const writer = { putVersioned: vi.fn().mockResolvedValue(undefined) };
    const restarted = new ProductSearchSync(s.restart(), writer, async () => {}, { now: () => now });
    await restarted.tick();
    expect(writer.putVersioned).toHaveBeenCalledWith(saved.id, expect.objectContaining({ price: 15, quantity: 12, status: ProductStatus.INACTIVE }), 9, expect.any(AbortSignal));
    expect(s.documents.get(saved.id).searchPending).toBe(false);
    await restarted.stop();
  });

  it('legacy enqueue racing a stock write rereads instead of overwriting content or revision', async () => {
    const s = atomicStore();
    s.documents.set('product-1', { _id: 'product-1', ...product() });
    const update = s.collection.updateOne.getMockImplementation()!;
    s.collection.updateOne.mockImplementationOnce(async (...args) => {
      await s.repo.decrementStock('product-1', 3);
      return update(...args);
    });
    expect(await s.repo.enqueueSearch('product-1')).toMatchObject({ revision: 1, product: { quantity: 7 } });
    expect(s.documents.get('product-1')).toMatchObject({ searchRevision: 1, quantity: 7 });
  });

  it('rotates bounded batches so a repeatedly mutated low ID cannot starve another product', async () => {
    const s = atomicStore(); await s.repo.save(product('a')); await s.repo.save(product('b'));
    const writer = { putVersioned: vi.fn().mockResolvedValue(undefined) };
    const worker = new ProductSearchSync(s.repo, writer, async () => {}, { batchSize: 1 });
    await worker.tick();
    await s.repo.incrementStock('a', 1);
    await worker.tick();
    expect(s.documents.get('b').searchPending).toBe(false);
    expect(s.documents.get('a').searchPending).toBe(true);
    await worker.tick(); expect(s.documents.get('a').searchPending).toBe(false);
    await worker.stop();
  });

  it('worker selection quarantines corrupt revisions without starving healthy or final-safe revisions', async () => {
    const s = atomicStore();
    for (const id of ['a', 'b']) await s.repo.save(product(id));
    s.documents.get('a').searchRevision = 'invalid';
    s.documents.get('b').searchRevision = Number.MAX_SAFE_INTEGER;
    const writer = { putVersioned: vi.fn().mockResolvedValue(undefined) };
    const worker = new ProductSearchSync(s.repo, writer, async () => {}, { batchSize: 1 });
    await worker.tick();
    expect(writer.putVersioned).toHaveBeenCalledTimes(1);
    expect(writer.putVersioned.mock.calls[0][2]).toBe(Number.MAX_SAFE_INTEGER);
    expect(s.documents.get('a').searchPending).toBe(true);
    expect(s.documents.get('b').searchPending).toBe(false);
    const filter = s.collection.find.mock.calls[0][0];
    expect(filter.$expr).toEqual({ $cond: [{ $isNumber: '$searchRevision' }, { $and: [
      { $gte: ['$searchRevision', 1] }, { $lte: ['$searchRevision', Number.MAX_SAFE_INTEGER] },
      { $eq: [{ $mod: ['$searchRevision', 1] }, 0] },
    ] }, false] });
    await worker.stop();
  });

  it.each([false, true])('real checkout/payment producers retain durable latest stock during ES outage (provider fails: %s)', async providerFails => {
    const s = atomicStore(); await s.repo.save(product());
    const vendors = new InMemoryVendorRepository();
    const vendor = Vendor.create({ personId: 'seller', storeName: 'Store', slug: 'store', commissionPct: 10 });
    vendor.id = 'vendor-1'; await vendors.save(vendor);
    const people = new InMemoryPersonRepository();
    const buyer = Person.create({ name: 'Buyer', mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
      contactInfos: [{ type: 'email', value: 'buyer@example.test', isPrimary: true }],
      addresses: [{ id: 'address', street: 'Street', number: '1', neighborhood: 'Area', city: 'City', state: 'TS', isPrimary: true }] });
    await people.save(buyer);
    const carts = new InMemoryCartRepository(); const cart = new CartService(carts, s.repo, vendors, config);
    const orders = new InMemoryOrderRepository(); const payments = new InMemoryPaymentRepository();
    const sync = new ProductSearchSync(s.repo, { putVersioned: vi.fn().mockRejectedValue(new Error('offline')) }, async () => {});
    const index = new ElasticsearchProductIndex('http://localhost:9200', vi.fn(), sync);
    const provider = { createSession: providerFails ? vi.fn().mockRejectedValue(new Error('synthetic provider failure'))
      : vi.fn().mockResolvedValue({ id: 'cs_test_session', url: 'https://checkout.stripe.test/session' }) };
    const mockStripeService = {
      getOrCreateCustomer: vi.fn().mockResolvedValue({ customerId: 'cus_test123', isNew: true }),
      createCheckoutSessionWithCustomer: providerFails
        ? vi.fn().mockRejectedValue(new Error('synthetic stripe service failure'))
        : vi.fn().mockResolvedValue({ id: 'cs_test_session', url: 'https://checkout.stripe.test/session' })
    } as unknown as StripeService;
    const checkout = new CheckoutService(orders, payments, carts, s.repo, vendors, people, cart, config, provider, undefined, index, undefined, undefined, mockStripeService);
    await cart.addItem(buyer.id, 'product-1', 2);
    if (providerFails) {
      await expect(checkout.checkout(buyer.id, 'address')).rejects.toThrow();
      expect(s.documents.get('product-1')).toMatchObject({ quantity: 10, searchRevision: 3 });
    } else {
      const result = await checkout.checkout(buyer.id, 'address');
      expect(result.order).toBeDefined();
      expect(s.documents.get('product-1')).toMatchObject({ quantity: 8, searchRevision: 2 });
      const payment = (await payments.findByOrderId(result.order.id))[0];
      const service = new PaymentService(payments, orders, s.repo, undefined, undefined, undefined, index);
      expect((await service.failPayment(payment.id)).status).toBe('failed');
      expect(s.documents.get('product-1')).toMatchObject({ quantity: 10, searchRevision: 3 });
    }
    await sync.stop();
    const writer = { putVersioned: vi.fn().mockResolvedValue(undefined) };
    const restarted = new ProductSearchSync(s.restart(), writer, async () => {}, { now: () => new Date(Date.now() + 120_000) });
    await restarted.tick();
    expect(writer.putVersioned).toHaveBeenCalledWith('product-1', expect.objectContaining({ quantity: 10 }), 3, expect.any(AbortSignal));
    expect(s.documents.get('product-1').searchPending).toBe(false);
    await restarted.stop();
  });

  it('real seed and full/partial recovery use durable persisted IDs and survive restart without reseeding', async () => {
    const s = atomicStore();
    const repositories = { productRepo: s.repo, personRepo: new InMemoryPersonRepository(),
      vendorRepo: new InMemoryVendorRepository(), categoryRepo: new InMemoryCategoryRepository() };
    const sync = new ProductSearchSync(s.repo, { putVersioned: vi.fn().mockRejectedValue(new Error('offline')) }, async () => {});
    const index = new ElasticsearchProductIndex('http://localhost:9200', vi.fn(), sync);
    await runSeed(repositories, index);
    expect(s.documents.size).toBe(12);
    const [first, second] = [...s.documents.values()];
    s.documents.delete(first._id); s.documents.set('stored-id', { ...first, _id: 'stored-id', quantity: 2 });
    s.documents.delete(second._id); // isolated fixture: simulate a historically partial catalog
    await runDevelopmentSeed(repositories, index);
    expect(s.documents.size).toBe(12);
    expect(s.documents.get('stored-id').quantity).toBe(2);
    const accountSave = vi.spyOn(repositories.personRepo, 'save');
    const accountRead = vi.spyOn(repositories.personRepo, 'findByEmail');
    await runDevelopmentSeed(repositories, index);
    expect(accountSave).not.toHaveBeenCalled(); expect(accountRead).not.toHaveBeenCalled();
    await sync.stop();
    const writer = { putVersioned: vi.fn().mockResolvedValue(undefined) };
    const restarted = new ProductSearchSync(s.restart(), writer, async () => {}, { now: () => new Date(Date.now() + 120_000) });
    await restarted.tick();
    expect(writer.putVersioned).toHaveBeenCalledTimes(12);
    expect(writer.putVersioned).toHaveBeenCalledWith('stored-id', expect.objectContaining({ quantity: 2 }), 1, expect.any(AbortSignal));
    expect([...s.documents.values()].every(doc => !doc.searchPending)).toBe(true);
    await restarted.stop();
  });
});
