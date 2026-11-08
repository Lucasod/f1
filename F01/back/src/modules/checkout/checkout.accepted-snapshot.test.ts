import { describe, it, expect, vi } from 'vitest';
import { CheckoutService } from './checkout.service';
import { MongoCheckoutAttemptRepository } from './checkout-attempt.mongo.repository';
import { Order, Payment } from '../order/order.domain';
import { MongoPaymentRepository } from '../order/payment.mongo.repository';

vi.mock('../../config', () => ({ config: { commissionPct: 10, frontendUrl: 'http://localhost' } }));

describe('checkout accepted snapshot gate', () => {
  it('creates order and payment from an accepted attempt without re-quoting', async () => {
    const storage = { documents: new Map(), lost: { insert: false, update: false } };
    const db = { collection: (name: string) => ({
      insertOne: async (doc: any) => { if (storage.documents.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); storage.documents.set(doc._id, structuredClone(doc)); },
      findOne: async (filter: any) => structuredClone([...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null),
      updateOne: async (filter: any, update: any) => {
        const doc = [...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v));
        if (!doc) return { matchedCount: 0 };
        if (update.$set) Object.assign(doc, structuredClone(update.$set));
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] += v;
        return { matchedCount: 1 };
      },
    }) };
    const attemptRepo = new MongoCheckoutAttemptRepository(db as any);

    // Build an accepted attempt manually via repository candidate
    const { AcceptedSnapshotV1, attemptIdentity, snapshotHash } = await import('./checkout-attempt');
    const snapshot: AcceptedSnapshotV1 = {
      schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: 'buyer',
      cart: { id: 'buyer', version: 1, generation: 'g', fingerprint: 'fp' },
      address: { id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP' },
      selections: [],
      grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
      commissionBps: 1000, commissionBasis: 'netMinor', shippingMinor: 0, feeMinor: 0,
      groups: [{
        vendorId: 'vendor', vendorName: 'Store', grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
        commissionMinor: 540, vendorNetMinor: 4860,
        items: [{ key: '["vendor","p"]', productId: 'p', productName: 'Product', unitMinor: 3000, quantity: 2, grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400 }],
      }],
    };
    const attempt = {
      id: attemptIdentity('buyer', 'request-0001'),
      owner: 'buyer',
      requestFingerprint: snapshotHash({}),
      input: { shippingAddressId: 'address', selections: [] },
      state: 'ACCEPTED' as const,
      version: 2,
      proposedSnapshot: snapshot,
      proposedHash: snapshotHash(snapshot),
      acceptedSnapshot: snapshot,
      acceptedHash: snapshotHash(snapshot),
      acceptedAt: new Date().toISOString(),
    };
    await attemptRepo.createOrRead(attempt as any);

    const orderRepo = { save: vi.fn(async (o: any) => o), findByPersonId: vi.fn(async () => []), findById: vi.fn(async () => null), update: vi.fn(async (o: any) => o), delete: vi.fn(), insertForAttempt: vi.fn(async (o: any) => { o.id = 'order-test-' + Math.random().toString(36).slice(2, 10); return o; }) } as any;
    const paymentRepo = { save: vi.fn(async (p: any) => p), findByOrderId: vi.fn(async () => []), findById: vi.fn(async () => null), update: vi.fn(async (p: any) => p), delete: vi.fn(), insertForAttempt: vi.fn(async (p: any) => { p.id = 'pay-test-' + Math.random().toString(36).slice(2, 10); return p; }) } as any;
    const cartRepo = { findById: vi.fn() } as any;
    const productRepo = { findById: vi.fn(), decrementStock: vi.fn(), incrementStock: vi.fn() } as any;
    const vendorRepo = { findById: vi.fn() } as any;
    const personRepo = { findById: vi.fn() } as any;
    const cartService = {} as any;
    const paymentProvider = { createSession: vi.fn(async () => ({ id: 'cs_test_x', url: 'https://checkout.stripe.test/x' })), expireSession: vi.fn() } as any;

    const service = new (CheckoutService as any)(
      orderRepo, paymentRepo, cartRepo, productRepo, vendorRepo, personRepo, cartService,
      { commissionPct: 10, frontendUrl: 'http://localhost' }, paymentProvider, undefined, undefined, undefined, attemptRepo
    );

    const result = await service.checkoutFromAcceptedAttempt('buyer', attempt.id);
    expect(result.order).toBeDefined();
    expect(result.payment).toBeDefined();
    expect(result.checkoutUrl).toContain('stripe.test');
    expect(orderRepo.insertForAttempt).toHaveBeenCalled();
    expect(paymentRepo.insertForAttempt).toHaveBeenCalled();
  });

  it('allocates remainder segments so vendor-group subtotal/commission match snapshot exactly (netMinor=1000, quantity=3)', async () => {
    const storage = { documents: new Map(), lost: { insert: false, update: false } };
    const db = { collection: (name: string) => ({
      insertOne: async (doc: any) => { if (storage.documents.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); storage.documents.set(doc._id, structuredClone(doc)); },
      findOne: async (filter: any) => structuredClone([...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null),
      updateOne: async (filter: any, update: any) => {
        const doc = [...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v));
        if (!doc) return { matchedCount: 0 };
        if (update.$set) Object.assign(doc, structuredClone(update.$set));
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] += v;
        return { matchedCount: 1 };
      },
    }) };
    const attemptRepo = new MongoCheckoutAttemptRepository(db as any);

    const { AcceptedSnapshotV1, attemptIdentity, snapshotHash } = await import('./checkout-attempt');
    const snapshot: AcceptedSnapshotV1 = {
      schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: 'buyer',
      cart: { id: 'buyer', version: 1, generation: 'g', fingerprint: 'fp' },
      address: { id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP' },
      selections: [],
      grossMinor: 1000, eligibleMinor: 1000, discountMinor: 0, netMinor: 1000,
      commissionBps: 1000, commissionBasis: 'netMinor', shippingMinor: 0, feeMinor: 0,
      groups: [{
        vendorId: 'vendor', vendorName: 'Store', grossMinor: 1000, eligibleMinor: 1000, discountMinor: 0, netMinor: 1000,
        commissionMinor: 100, vendorNetMinor: 900,
        items: [{ key: '["vendor","p"]', productId: 'p', productName: 'Product', unitMinor: 0, quantity: 3, grossMinor: 1000, eligibleMinor: 1000, discountMinor: 0, netMinor: 1000 }],
      }],
    };
    const attempt = {
      id: attemptIdentity('buyer', 'request-remainder'),
      owner: 'buyer',
      requestFingerprint: snapshotHash({}),
      input: { shippingAddressId: 'address', selections: [] },
      state: 'ACCEPTED' as const,
      version: 2,
      proposedSnapshot: snapshot,
      proposedHash: snapshotHash(snapshot),
      acceptedSnapshot: snapshot,
      acceptedHash: snapshotHash(snapshot),
      acceptedAt: new Date().toISOString(),
    };
    await attemptRepo.createOrRead(attempt as any);

    const orderRepo = { save: vi.fn(async (o: any) => o), findByPersonId: vi.fn(async () => []), findById: vi.fn(async () => null), update: vi.fn(async (o: any) => o), delete: vi.fn(), insertForAttempt: vi.fn(async (o: any) => { o.id = 'order-test-' + Math.random().toString(36).slice(2, 10); return o; }) } as any;
    const paymentRepo = { save: vi.fn(async (p: any) => p), findByOrderId: vi.fn(async () => []), findById: vi.fn(async () => null), update: vi.fn(async (p: any) => p), delete: vi.fn(), insertForAttempt: vi.fn(async (p: any) => { p.id = 'pay-test-' + Math.random().toString(36).slice(2, 10); return p; }) } as any;
    const cartRepo = { findById: vi.fn() } as any;
    const productRepo = { findById: vi.fn(), decrementStock: vi.fn(), incrementStock: vi.fn() } as any;
    const vendorRepo = { findById: vi.fn() } as any;
    const personRepo = { findById: vi.fn() } as any;
    const cartService = {} as any;
    const paymentProvider = { createSession: vi.fn(async () => ({ id: 'cs_test_x', url: 'https://checkout.stripe.test/x' })), expireSession: vi.fn() } as any;

    const service = new (CheckoutService as any)(
      orderRepo, paymentRepo, cartRepo, productRepo, vendorRepo, personRepo, cartService,
      { commissionPct: 10, frontendUrl: 'http://localhost' }, paymentProvider, undefined, undefined, undefined, attemptRepo
    );

    const result = await service.checkoutFromAcceptedAttempt('buyer', attempt.id);
    const order = result.order;
    expect(order.totalAmount).toBe(10);
    const vg = order.vendorGroups[0];
    expect(vg.subtotal).toBe(10);
    expect(vg.commissionAmount).toBe(1);
    expect(vg.vendorNet).toBe(9);
    // segment totalPrices sum to netMinor/100
    const sum = vg.items.reduce((s: number, it: any) => s + it.totalPrice, 0);
    expect(sum).toBe(10);
    // unitPrice stays rounded major
    expect(vg.items.map((it: any) => it.unitPrice)).toEqual(expect.arrayContaining([3.34, 3.33]));
  });

  it('idempotent retry returns the persisted checkout URL instead of a reconstructed mock URL', async () => {
    const storage = { documents: new Map(), lost: { insert: false, update: false } };
    const db = { collection: (name: string) => ({
      insertOne: async (doc: any) => { if (storage.documents.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); storage.documents.set(doc._id, structuredClone(doc)); },
      findOne: async (filter: any) => structuredClone([...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null),
      updateOne: async (filter: any, update: any) => {
        let doc = [...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v));
        if (!doc) {
          doc = { ...structuredClone(filter) };
          storage.documents.set(filter._id, doc);
        }
        if (update.$set) Object.assign(doc, structuredClone(update.$set));
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] ?? 0) + (v as number);
        if (update.$setOnInsert) for (const [k, v] of Object.entries(update.$setOnInsert)) { if (doc[k] === undefined) doc[k] = structuredClone(v); }
        return { matchedCount: 1 };
      },
    }) };
    const attemptRepo = new MongoCheckoutAttemptRepository(db as any);

    const { attemptIdentity, snapshotHash } = await import('./checkout-attempt');
    const snapshot: any = {
      schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: 'buyer',
      cart: { id: 'buyer', version: 1, generation: 'g', fingerprint: 'fp' },
      address: { id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP' },
      selections: [],
      grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
      commissionBps: 1000, commissionBasis: 'netMinor', shippingMinor: 0, feeMinor: 0,
      groups: [{
        vendorId: 'vendor', vendorName: 'Store', grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
        commissionMinor: 540, vendorNetMinor: 4860,
        items: [{ key: '["vendor","p"]', productId: 'p', productName: 'Product', unitMinor: 3000, quantity: 2, grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400 }],
      }],
    };
    const attempt = {
      id: attemptIdentity('buyer', 'request-idempotent'),
      owner: 'buyer',
      requestFingerprint: snapshotHash({}),
      input: { shippingAddressId: 'address', selections: [] },
      state: 'ACCEPTED' as const,
      version: 2,
      proposedSnapshot: snapshot,
      proposedHash: snapshotHash(snapshot),
      acceptedSnapshot: snapshot,
      acceptedHash: snapshotHash(snapshot),
      acceptedAt: new Date().toISOString(),
    };
    await attemptRepo.createOrRead(attempt as any);

    const existingOrder: any = { id: 'order-idempotent', personId: 'buyer', totalAmount: 54, attemptId: attempt.id, acceptedHash: attempt.acceptedHash, vendorGroups: [] };

    const payment = Payment.create({ orderId: existingOrder.id, personId: 'buyer', amount: 54, provider: 'stripe' });
    payment.providerTransactionId = 'cs_stripe_real_123';
    (payment as any).checkoutUrl = 'https://checkout.stripe.com/pay/cs_stripe_real_123';

    const orderRepo = { save: vi.fn(async (o: any) => o), findByPersonId: vi.fn(async () => [existingOrder]), findById: vi.fn(async () => existingOrder), update: vi.fn(async (o: any) => o), delete: vi.fn() } as any;
    const paymentRepo = { save: vi.fn(async (p: any) => p), findByOrderId: vi.fn(async () => [payment]), findById: vi.fn(async () => payment), update: vi.fn(async (p: any) => p), delete: vi.fn() } as any;
    const cartRepo = { findById: vi.fn() } as any;
    const productRepo = { findById: vi.fn(), decrementStock: vi.fn(), incrementStock: vi.fn() } as any;
    const vendorRepo = { findById: vi.fn() } as any;
    const personRepo = { findById: vi.fn() } as any;
    const cartService = {} as any;
    const paymentProvider = { createSession: vi.fn(async () => ({ id: 'cs_test_x', url: 'https://checkout.stripe.test/x' })), expireSession: vi.fn() } as any;

    const service = new (CheckoutService as any)(
      orderRepo, paymentRepo, cartRepo, productRepo, vendorRepo, personRepo, cartService,
      { commissionPct: 10, frontendUrl: 'http://localhost' }, paymentProvider, undefined, undefined, undefined, attemptRepo
    );

    const result = await service.checkoutFromAcceptedAttempt('buyer', attempt.id);
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_stripe_real_123');
    // Must not reconstruct the mock URL.
    expect(result.checkoutUrl).not.toContain('checkout.stripe.test/mock');
  });

  it('idempotent retry through a detached (Mongo-like) repository returns persisted checkoutUrl (CR-010)', async () => {
    const storage = { documents: new Map() };
    const collection = {
      insertOne: async (doc: any) => { if (storage.documents.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); storage.documents.set(doc._id, structuredClone(doc)); },
      findOne: async (filter: any) => structuredClone([...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null),
      updateOne: async (filter: any, update: any) => {
        let doc = [...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v));
        if (!doc) {
          doc = { ...structuredClone(filter) };
          storage.documents.set(filter._id, doc);
        }
        if (update.$set) Object.assign(doc, structuredClone(update.$set));
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] ?? 0) + (v as number);
        if (update.$setOnInsert) for (const [k, v] of Object.entries(update.$setOnInsert)) { if (doc[k] === undefined) doc[k] = structuredClone(v); }
        return { matchedCount: 1 };
      },
      find: (filter: any) => ({
        sort: (_s: any) => ({
          toArray: async () => structuredClone([...storage.documents.values()].filter(d => Object.entries(filter).every(([k, v]) => d[k] === v)))
        })
      })
    };
    const db = { collection: (_name: string) => collection };
    const attemptRepo = new MongoCheckoutAttemptRepository(db as any);

    const { attemptIdentity, snapshotHash } = await import('./checkout-attempt');
    const snapshot: any = {
      schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: 'buyer',
      cart: { id: 'buyer', version: 1, generation: 'g', fingerprint: 'fp' },
      address: { id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP' },
      selections: [],
      grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
      commissionBps: 1000, commissionBasis: 'netMinor', shippingMinor: 0, feeMinor: 0,
      groups: [{
        vendorId: 'vendor', vendorName: 'Store', grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
        commissionMinor: 540, vendorNetMinor: 4860,
        items: [{ key: '["vendor","p"]', productId: 'p', productName: 'Product', unitMinor: 3000, quantity: 2, grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400 }],
      }],
    };
    const attempt = {
      id: attemptIdentity('buyer', 'request-detached'),
      owner: 'buyer',
      requestFingerprint: snapshotHash({}),
      input: { shippingAddressId: 'address', selections: [] },
      state: 'ACCEPTED' as const,
      version: 2,
      proposedSnapshot: snapshot,
      proposedHash: snapshotHash(snapshot),
      acceptedSnapshot: snapshot,
      acceptedHash: snapshotHash(snapshot),
      acceptedAt: new Date().toISOString(),
    };
    await attemptRepo.createOrRead(attempt as any);

    const paymentRepo = new MongoPaymentRepository(db as any);
    const payment = Payment.create({ orderId: 'order-detached', personId: 'buyer', amount: 54, provider: 'stripe' });
    payment.providerTransactionId = 'cs_stripe_real_123';
    payment.checkoutUrl = 'https://checkout.stripe.com/pay/cs_stripe_real_123';
    await paymentRepo.save(payment);

    const existingOrder: any = { id: 'order-detached', personId: 'buyer', totalAmount: 54, attemptId: attempt.id, acceptedHash: attempt.acceptedHash, vendorGroups: [] };

    const orderRepo = { save: vi.fn(async (o: any) => o), findByPersonId: vi.fn(async () => [existingOrder]), findById: vi.fn(async () => existingOrder), update: vi.fn(async (o: any) => o), delete: vi.fn() } as any;
    const cartRepo = { findById: vi.fn() } as any;
    const productRepo = { findById: vi.fn(), decrementStock: vi.fn(), incrementStock: vi.fn() } as any;
    const vendorRepo = { findById: vi.fn() } as any;
    const personRepo = { findById: vi.fn() } as any;
    const cartService = {} as any;
    const paymentProvider = { createSession: vi.fn(async () => ({ id: 'cs_test_x', url: 'https://checkout.stripe.test/x' })), expireSession: vi.fn() } as any;

    const service = new (CheckoutService as any)(
      orderRepo, paymentRepo, cartRepo, productRepo, vendorRepo, personRepo, cartService,
      { commissionPct: 10, frontendUrl: 'http://localhost' }, paymentProvider, undefined, undefined, undefined, attemptRepo
    );

    const result = await service.checkoutFromAcceptedAttempt('buyer', attempt.id);
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_stripe_real_123');
    expect(result.checkoutUrl).not.toContain('checkout.stripe.test/mock');
  });

  it('rejects malformed accepted snapshot item with typed AttemptError (CR-003)', async () => {
    const storage = { documents: new Map(), lost: { insert: false, update: false } };
    const db = { collection: (name: string) => ({
      insertOne: async (doc: any) => { if (storage.documents.has(doc._id)) throw Object.assign(new Error('dup'), { code: 11000 }); storage.documents.set(doc._id, structuredClone(doc)); },
      findOne: async (filter: any) => structuredClone([...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null),
      updateOne: async (filter: any, update: any) => {
        const doc = [...storage.documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v));
        if (!doc) return { matchedCount: 0 };
        if (update.$set) Object.assign(doc, structuredClone(update.$set));
        if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] += v;
        return { matchedCount: 1 };
      },
    }) };
    const attemptRepo = new MongoCheckoutAttemptRepository(db as any);

    const { attemptIdentity, snapshotHash } = await import('./checkout-attempt');
    const snapshot: any = {
      schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: 'buyer',
      cart: { id: 'buyer', version: 1, generation: 'g', fingerprint: 'fp' },
      address: { id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP' },
      selections: [],
      grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
      commissionBps: 1000, commissionBasis: 'netMinor', shippingMinor: 0, feeMinor: 0,
      groups: [{
        vendorId: 'vendor', vendorName: 'Store', grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400,
        commissionMinor: 540, vendorNetMinor: 4860,
        items: [{ key: '["vendor","p"]', productId: 'p', productName: 'Product', unitMinor: 3000, quantity: 0, grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400 }],
      }],
    };
    const attempt = {
      id: attemptIdentity('buyer', 'request-malformed'),
      owner: 'buyer',
      requestFingerprint: snapshotHash({}),
      input: { shippingAddressId: 'address', selections: [] },
      state: 'ACCEPTED' as const,
      version: 2,
      proposedSnapshot: snapshot,
      proposedHash: snapshotHash(snapshot),
      acceptedSnapshot: snapshot,
      acceptedHash: snapshotHash(snapshot),
      acceptedAt: new Date().toISOString(),
    };
    await attemptRepo.createOrRead(attempt as any);

    const orderRepo = { save: vi.fn(async (o: any) => o), findByPersonId: vi.fn(async () => []), findById: vi.fn(async () => null), update: vi.fn(async (o: any) => o), delete: vi.fn(), insertForAttempt: vi.fn(async (o: any) => { o.id = 'order-test-' + Math.random().toString(36).slice(2, 10); return o; }) } as any;
    const paymentRepo = { save: vi.fn(async (p: any) => p), findByOrderId: vi.fn(async () => []), findById: vi.fn(async () => null), update: vi.fn(async (p: any) => p), delete: vi.fn(), insertForAttempt: vi.fn(async (p: any) => { p.id = 'pay-test-' + Math.random().toString(36).slice(2, 10); return p; }) } as any;
    const cartRepo = { findById: vi.fn() } as any;
    const productRepo = { findById: vi.fn(), decrementStock: vi.fn(), incrementStock: vi.fn() } as any;
    const vendorRepo = { findById: vi.fn() } as any;
    const personRepo = { findById: vi.fn() } as any;
    const cartService = {} as any;
    const paymentProvider = { createSession: vi.fn(async () => ({ id: 'cs_test_x', url: 'https://checkout.stripe.test/x' })), expireSession: vi.fn() } as any;

    const service = new (CheckoutService as any)(
      orderRepo, paymentRepo, cartRepo, productRepo, vendorRepo, personRepo, cartService,
      { commissionPct: 10, frontendUrl: 'http://localhost' }, paymentProvider, undefined, undefined, undefined, attemptRepo
    );

    await expect(service.checkoutFromAcceptedAttempt('buyer', attempt.id)).rejects.toMatchObject({ code: 'INVALID_SNAPSHOT_ITEM', status: 409 });
  });
});

