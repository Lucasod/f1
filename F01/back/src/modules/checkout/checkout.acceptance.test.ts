import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CheckoutService } from './checkout.service';
import { createCheckoutRoutes } from './checkout.routes';
import { CouponService } from '../coupon/coupon.service';
import { validateTerms } from '../coupon/coupon.domain';
import { MongoCheckoutAttemptRepository } from './checkout-attempt.mongo.repository';

vi.mock('../../config', () => ({ config: {} }));
vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, res: any, next: any) => {
    const id = req.header('x-person');
    if (!id) return res.sendStatus(401);
    req.user = { sub: id, roles: id === 'admin' ? ['ADMIN', 'CONSUMER'] : ['CONSUMER', 'VENDOR'] }; next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

// Detached command-faithful storage, shared across reconstructed adapters/services.
export function attemptDatabase() {
  const documents = new Map<string, any>();
  const lost = { insert: false, update: false };
  const db = { collection: (name: string) => {
    if (name !== 'checkout_attempts') throw new Error('Unexpected collection');
    return {
      insertOne: async (doc: any) => {
        if (documents.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        documents.set(doc._id, structuredClone(doc));
        if (lost.insert) { lost.insert = false; throw new Error('response lost'); }
      },
      findOne: async (filter: any) => structuredClone([...documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null),
      updateOne: async (filter: any, update: any) => {
        const doc = [...documents.values()].find(d => Object.entries(filter).every(([k, v]) => d[k] === v));
        if (!doc) return { matchedCount: 0 };
        if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
        Object.assign(doc, structuredClone(update.$set));
        for (const [k, v] of Object.entries(update.$inc ?? {})) doc[k] += v;
        if (lost.update) { lost.update = false; throw new Error('response lost'); }
        return { matchedCount: 1 };
      },
    };
  } };
  return { db, documents, lost };
}

async function fixture() {
  const storage = attemptDatabase();
  const product = { id: 'p', vendorId: 'vendor', categoryId: 'root', name: 'Product', status: 'active', price: 30, quantity: 10 };
  const vendor = { id: 'vendor', personId: 'seller', storeName: 'Store', status: 'active', commissionPct: 99 };
  const address = { id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP', isPrimary: false };
  const cart = { id: 'buyer', version: 1, generation: 'generation', isEmpty: false, items: [{ productId: 'p', vendorId: 'vendor', quantity: 2, unitPrice: 20 }] };
  let terms = validateTerms({ code: 'SAVE', discountType: 'percentBps', value: 1000, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }, 'vendor');
  const writes = { save: vi.fn(), update: vi.fn(), delete: vi.fn(), decrementStock: vi.fn(), incrementStock: vi.fn(), createSession: vi.fn() };
  const products = { ...writes, findById: async () => structuredClone(product) };
  const vendors = { findById: async () => structuredClone(vendor) };
  const categories = { findAll: async () => [{ id: 'root', parentId: null }] };
  const coupons = new CouponService({ find: async () => structuredClone(terms) } as any, vendors as any, products as any, categories as any, () => new Date('2026-11-08T12:00:00Z'));
  const make = async () => {
    const repo = new MongoCheckoutAttemptRepository(storage.db as any);
    const service = new (CheckoutService as any)(writes, writes, { ...writes, findById: async () => structuredClone(cart) }, products, vendors, { findById: async () => ({ roles: ['CONSUMER', 'VENDOR'], addresses: [structuredClone(address)] }) }, {}, { commissionPct: 10 }, writes, categories, undefined, coupons, repo);
    const app = express(); app.use(express.json());
    app.use('/checkout', createCheckoutRoutes({ authService: {} as any, personRepo: {} as any, checkoutService: service }));
    app.use((_err: any, _req: any, res: any, _next: any) => res.status(503).json({ error: 'RECOVERABLE' }));
    return app;
  };
  const input = { requestId: 'request-0001', shippingAddressId: 'address', couponSelections: [{ vendorId: 'vendor', code: 'SAVE' }] };
  const prepare = async (app: any, body = input, owner = 'buyer') => request(app).post('/checkout/attempts').set('x-person', owner).send(body);
  const accept = async (app: any, attempt: any, owner = 'buyer') => request(app).post(`/checkout/attempts/${attempt.id}/accept`).set('x-person', owner).send({ expectedVersion: attempt.version, expectedHash: attempt.proposedHash });
  const noWrites = () => { for (const spy of Object.values(writes)) expect(spy).not.toHaveBeenCalled(); };
  return { ...storage, product, vendor, address, cart, make, input, prepare, accept, noWrites, setTerms: (value: typeof terms) => { terms = value; }, terms };
}

describe('durable explicit checkout acceptance', () => {
  it('rejects a suspended store without creating an acceptance or financial writes', async () => {
    const f = await fixture(); f.vendor.status = 'suspended';
    const response = await f.prepare(await f.make());
    expect(response.status).toBe(409); expect(response.body.error).toBe('VENDOR_NOT_AVAILABLE');
    expect(f.documents.size).toBe(0); f.noWrites();
  });

  it('parallel preparation selects one proposal; primary flag changes do not change delivery equality', async () => {
    const f = await fixture(); const app = await f.make();
    const results = await Promise.all([f.prepare(app), f.prepare(await f.make())]);
    expect(results.map(r => r.status)).toEqual([201, 201]); expect(results[0].body).toEqual(results[1].body);
    expect(f.documents.size).toBe(1); f.address.isPrimary = true;
    const accepted = await f.accept(app, results[0].body.attempt); expect(accepted.status).toBe(200);
    const malformed = await request(app).post(`/checkout/attempts/${results[0].body.attempt.id}/accept`).set('x-person', 'buyer').send({ expectedVersion: 1, expectedHash: results[0].body.attempt.proposedHash, snapshot: {} });
    expect(malformed.status).toBe(400); f.noWrites();
  });
  it('creates, explicitly accepts and reloads an identical detached snapshot after reconstruction without financial effects', async () => {
    const f = await fixture(); const app = await f.make();
    const prepared = await f.prepare(app); expect(prepared.status).toBe(201);
    expect(prepared.headers['cache-control']).toBe('no-store');
    const p = prepared.body.attempt;
    expect(p.state).toBe('PROPOSED'); expect(p.acceptedSnapshot).toBeUndefined();
    const accepted = await f.accept(app, p); expect(accepted.status).toBe(200);
    const a = accepted.body.attempt;
    expect(a.state).toBe('ACCEPTED'); expect(a.acceptedHash).toBe(p.proposedHash);
    expect(a.acceptedSnapshot).toMatchObject({ schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: 'buyer', cart: { id: 'buyer', version: 1 }, grossMinor: 6000, eligibleMinor: 6000, discountMinor: 600, netMinor: 5400, shippingMinor: 0, feeMinor: 0, commissionBps: 1000, commissionBasis: 'netMinor' });
    expect(a.acceptedSnapshot.groups[0]).toMatchObject({ commissionMinor: 540, vendorNetMinor: 4860, coupon: f.terms, items: [{ unitMinor: 3000, quantity: 2, grossMinor: 6000, discountMinor: 600, netMinor: 5400 }] });
    expect(a.acceptedSnapshot.address.isPrimary).toBeUndefined();
    const restored = await request(await f.make()).get(`/checkout/attempts/${p.id}`).set('x-person', 'buyer');
    expect(restored.status).toBe(200); expect(restored.body.attempt).toEqual(a);
    a.acceptedSnapshot.address.street = 'tampered';
    expect((await f.prepare(await f.make())).body.attempt).toEqual(restored.body.attempt);
    f.noWrites();
  });

  it.each(['cart', 'price', 'terms', 'validity', 'address'] as const)('requires a new explicit proposal after %s changes', async change => {
    const f = await fixture(); const app = await f.make();
    const prepared = await f.prepare(app); expect(prepared.status).toBe(201); const p = prepared.body.attempt;
    if (change === 'cart') { f.cart.items[0].quantity++; f.cart.version++; }
    if (change === 'price') f.product.price++;
    if (change === 'terms') f.setTerms({ ...f.terms, value: 2000 });
    if (change === 'validity') f.setTerms({ ...f.terms, endsAt: '2026-11-02T00:00:00.000Z' });
    if (change === 'address') f.address.number = '2';
    const changed = await f.accept(app, p); expect(changed.status).toBe(409); expect(changed.body.error).toBe('QUOTE_CHANGED');
    expect(changed.body.attempt.version).toBeGreaterThan(p.version);
    expect(changed.body.attempt.acceptedSnapshot).toBeUndefined();
    expect((await f.accept(app, p)).status).toBe(409);
    if (change !== 'validity') {
      const confirmed = await f.accept(app, changed.body.attempt);
      expect(confirmed.status).toBe(200); expect(confirmed.body.attempt.state).toBe('ACCEPTED');
    } else expect(changed.body.attempt.state).toBe('SUPERSEDED');
    f.noWrites();
  });

  it('recovers applied insert/CAS timeouts and parallel exact accepts, rejects changed intent/hash and foreign owner', async () => {
    const f = await fixture(); const app = await f.make(); f.lost.insert = true;
    const prepared = await f.prepare(app); expect([201, 503]).toContain(prepared.status);
    const retry = await f.prepare(await f.make()); expect(retry.status).toBe(201); const p = retry.body.attempt;
    expect(f.documents.size).toBe(1);
    f.lost.update = true;
    const results = await Promise.all([f.accept(app, p), f.accept(await f.make(), p)]);
    expect(results.every(r => [200, 503].includes(r.status))).toBe(true);
    const recovered = await f.accept(await f.make(), p); expect(recovered.status).toBe(200);
    expect(recovered.body.attempt.acceptedHash).toBe(p.proposedHash);
    f.product.price = 99;
    expect((await f.accept(await f.make(), p)).body.attempt).toEqual(recovered.body.attempt);
    expect((await f.accept(app, { ...p, proposedHash: '0'.repeat(64) })).status).toBe(409);
    expect((await f.prepare(app, { ...f.input, shippingAddressId: 'other' })).status).toBe(409);
    expect((await f.accept(app, p, 'other')).status).toBe(404);
    expect((await request(app).get(`/checkout/attempts/${p.id}`).set('x-person', 'other')).status).toBe(404);
    expect((await request(app).get(`/checkout/attempts/missing`).set('x-person', 'other')).status).toBe(404);
    f.noWrites();
  });

  it('rejects unauthenticated/admin/self-store/forged inputs and retains discounted POST503', async () => {
    const f = await fixture(); const app = await f.make();
    expect((await request(app).post('/checkout/attempts').send(f.input)).status).toBe(401);
    expect((await f.prepare(app, f.input, 'admin')).status).toBe(403);
    expect((await f.prepare(app, { ...f.input, snapshot: {} } as any)).status).toBe(400);
    expect((await f.prepare(app, { ...f.input, requestId: 'x'.repeat(201) })).status).toBe(400);
    f.vendor.personId = 'buyer'; expect((await f.prepare(app)).status).toBe(403);
    expect((await request(app).post('/checkout').set('x-person', 'buyer').send(f.input)).status).toBe(503);
    f.noWrites();
  });
});
