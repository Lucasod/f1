import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CheckoutService } from './checkout.service';
import { createCheckoutRoutes } from './checkout.routes';
import { MongoCouponRepository } from '../coupon/coupon.mongo.repository';
import { CouponService } from '../coupon/coupon.service';
import { createCouponRoutes } from '../coupon/coupon.routes';

vi.mock('../../config', () => ({ config: { currency: 'BRL' } }));
vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, res: any, next: any) => {
    const id = req.header('x-test-person');
    if (!id) return res.sendStatus(401);
    req.user = { sub: id, roles: [id === 'admin' ? 'ADMIN' : id.startsWith('seller') ? 'VENDOR' : 'CONSUMER'] }; next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => roles.some(r => req.user.roles.includes(r)) ? next() : res.sendStatus(403),
}));

describe('persisted coupon HTTP quote', () => {
  it.each([30, 10])('keeps cart pricing before and after a catalogue-priced quote at %s without financial writes', async (catalogPrice) => {
    const products = { findById: async () => ({ id: 'p', vendorId: 'vendor', categoryId: 'root', name: 'Product', price: catalogPrice, quantity: 10 }), decrementStock: vi.fn(), incrementStock: vi.fn() };
    const vendors = { findById: async () => ({ id: 'vendor', personId: 'seller', storeName: 'Store', commissionPct: 10 }) };
    const cart = { isEmpty: false, items: [{ productId: 'p', vendorId: 'vendor', quantity: 2, unitPrice: 20 }] };
    const carts = { findById: async () => cart, save: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const finance = { save: vi.fn(), update: vi.fn(), delete: vi.fn(), createSession: vi.fn() };
    const terms = { vendorId: 'vendor', code: 'SAVE', discountType: 'percentBps', value: 1000, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', includeProducts: [], excludeProducts: [], includeCategories: [], excludeCategories: [] };
    const coupons = new CouponService({ find: async () => terms } as any, vendors as any, products as any, { findAll: async () => [{ id: 'root', parentId: null }] } as any, () => new Date('2026-11-08T12:00:00Z'));
    const checkout = new CheckoutService(finance as any, finance as any, carts as any, products as any, vendors as any, { findById: async () => ({ addresses: [] }) } as any, {} as any, {} as any, finance as any, undefined, undefined, coupons);
    const app = express(); app.use(express.json());
    app.use('/checkout', createCheckoutRoutes({ authService: {} as any, checkoutService: checkout, personRepo: {} as any }));
    const plain = async () => {
      const response = await request(app).get('/checkout/preview').set('x-test-person', 'buyer');
      expect(response.status).toBe(200);
      expect(response.body.preview).toMatchObject({ purchasable: true, grossMinor: 4000, netMinor: 4000, totalAmount: 40, discountAmount: 0 });
      expect(response.body.preview.vendorGroups[0]).toMatchObject({ subtotal: 40, commissionAmount: 4, vendorNet: 36, items: [{ quantity: 2, unitPrice: 20, totalPrice: 40, grossMinor: 4000, discountMinor: 0, netMinor: 4000 }] });
      return response.body.preview;
    };
    const before = await plain();
    const quote = await request(app).get('/checkout/preview').query({ couponSelections: JSON.stringify([{ vendorId: 'vendor', code: 'SAVE' }]) }).set('x-test-person', 'buyer');
    expect(quote.status).toBe(200);
    expect(quote.body.preview).toMatchObject({ purchasable: false, grossMinor: catalogPrice * 200, discountMinor: catalogPrice * 20, netMinor: catalogPrice * 180, totalAmount: catalogPrice * 1.8 });
    expect(quote.body.preview.vendorGroups[0].items[0].unitPrice).toBe(catalogPrice);
    expect(await plain()).toEqual(before);
    expect((await request(app).post('/checkout').set('x-test-person', 'buyer').send({ shippingAddressId: 'address', couponSelections: [{ vendorId: 'vendor', code: 'SAVE' }] })).status).toBe(503);
    expect(cart.items[0].unitPrice).toBe(20);
    for (const spy of [...Object.values(finance), products.decrementStock, products.incrementStock, carts.save, carts.update, carts.delete]) expect(spy).not.toHaveBeenCalled();
  });

  it('creates and lists vendor terms, restores in another service and quotes eligible cents without financial writes', async () => {
    const documents = new Map<string, any>();
    const db = { collection: () => ({
      insertOne: async (doc: any) => {
        if (documents.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        documents.set(doc._id, structuredClone(doc));
      },
      findOne: async (query: any) => structuredClone(documents.get(query._id) ?? null),
      find: (query: any) => ({ toArray: async () => structuredClone([...documents.values()].filter(d => d.vendorId === query.vendorId)) }),
    }) };
    const products = [
      { id: 'p1', vendorId: 'a', categoryId: 'child', name: 'Eligible', price: 10.01, quantity: 10 },
      { id: 'p2', vendorId: 'a', categoryId: 'excluded', name: 'Excluded', price: 9.99, quantity: 10 },
      { id: 'p3', vendorId: 'b', categoryId: 'root', name: 'Other store', price: 5, quantity: 10 },
    ];
    const vendors = [{ id: 'a', personId: 'seller-a', storeName: 'A', commissionPct: 10 }, { id: 'b', personId: 'seller-b', storeName: 'B', commissionPct: 10 }];
    const productRepo = { findById: vi.fn(async (id: string) => products.find(p => p.id === id)), decrementStock: vi.fn(), incrementStock: vi.fn() };
    const vendorRepo = { findById: async (id: string) => vendors.find(v => v.id === id), findByPersonId: async (id: string) => vendors.find(v => v.personId === id) };
    const categoryRepo = { findAll: async () => [{ id: 'root', parentId: null }, { id: 'child', parentId: 'root' }, { id: 'excluded', parentId: 'root' }] };
    const cartRepo = { findById: async () => ({ isEmpty: false, items: products.map(p => ({ productId: p.id, vendorId: p.vendorId, quantity: 1, unitPrice: 999 })) }), save: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const personRepo = { findById: async () => ({ addresses: [] }) };
    const finance = { save: vi.fn(), update: vi.fn(), delete: vi.fn(), createSession: vi.fn() };
    const app = express(); app.use(express.json());
    const make = () => new CouponService(new MongoCouponRepository(db as any), vendorRepo as any, productRepo as any, categoryRepo as any, () => new Date('2026-11-08T12:00:00Z'));
    app.use('/coupons', createCouponRoutes({ authService: {} as any, couponService: make() }));
    const coupons = make();
    const checkout = new CheckoutService(finance as any, finance as any, cartRepo as any, productRepo as any, vendorRepo as any, personRepo as any, {} as any, {} as any, finance as any, categoryRepo as any, undefined, coupons);
    app.use('/checkout', createCheckoutRoutes({ authService: {} as any, checkoutService: checkout, personRepo: personRepo as any }));
    const terms = { code: ' save ', discountType: 'percentBps', value: 1000, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', includeProducts: [], excludeProducts: [], includeCategories: ['root'], excludeCategories: ['excluded'] };
    const created = await request(app).post('/coupons').set('x-test-person', 'seller-a').send(terms);
    expect(created.status).toBe(201);
    expect(created.body.coupon).toMatchObject({ vendorId: 'a', code: 'SAVE', revision: 1, value: 1000 });
    expect((await request(app).get('/coupons').set('x-test-person', 'seller-a')).body.coupons).toEqual([created.body.coupon]);
    const response = await request(app).get('/checkout/preview').query({ couponSelections: JSON.stringify([{ vendorId: 'a', code: 'SAVE' }]) }).set('x-test-person', 'buyer');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.preview).toMatchObject({ currency: 'BRL', calculationVersion: 'coupon-quote-v1', purchasable: false, grossMinor: 2500, eligibleMinor: 1001, discountMinor: 100, netMinor: 2400, totalAmount: 24, discountAmount: 1 });
    const group = response.body.preview.vendorGroups.find((g: any) => g.id === 'a');
    expect(group.coupon).toEqual(created.body.coupon);
    expect(group.items.map((i: any) => [i.productId, i.grossMinor, i.discountMinor, i.netMinor])).toEqual([['p1', 1001, 100, 901], ['p2', 999, 0, 999]]);
    expect((await request(app).post('/checkout').set('x-test-person', 'buyer').send({ shippingAddressId: 'address', couponSelections: [{ vendorId: 'a', code: 'SAVE' }] })).status).toBe(503);
    for (const spy of [...Object.values(finance), productRepo.decrementStock, productRepo.incrementStock, cartRepo.save, cartRepo.update, cartRepo.delete]) expect(spy).not.toHaveBeenCalled();
  });
});
