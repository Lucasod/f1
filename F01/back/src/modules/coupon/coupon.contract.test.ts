import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CouponService } from './coupon.service';
import { InMemoryCouponRepository, validateTerms } from './coupon.domain';
import { createCouponRoutes } from './coupon.routes';
import { CheckoutService } from '../checkout/checkout.service';
import { createCheckoutRoutes } from '../checkout/checkout.routes';

vi.mock('../../config', () => ({ config: {} }));
vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, res: any, next: any) => {
    const id = req.header('x-person'); if (!id) return res.sendStatus(401);
    req.user = { sub: id, roles: [id === 'admin' ? 'ADMIN' : id.startsWith('seller') ? 'VENDOR' : 'CONSUMER'] }; next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => roles.some(r => req.user.roles.includes(r)) ? next() : res.sendStatus(403),
}));

const input = { code: 'SAVE', discountType: 'percentBps', value: 1000, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' };
function setup() {
  const products = [
    { id: 'a1', vendorId: 'a', categoryId: 'child', price: 10.01, name: 'A1', quantity: 100 },
    { id: 'a2', vendorId: 'a', categoryId: 'excluded', price: 9.99, name: 'A2', quantity: 100 },
    { id: 'b1', vendorId: 'b', categoryId: 'root', price: 1, name: 'B1', quantity: 100 },
  ];
  const vendors = ['a', 'b'].map(id => ({ id, personId: 'seller-' + id, storeName: id, commissionPct: 10 }));
  const categories = [{ id: 'root', parentId: null as string | null }, { id: 'child', parentId: 'root' }, { id: 'excluded', parentId: 'root' }];
  const productRepo = { findById: async (id: string) => products.find(p => p.id === id), decrementStock: vi.fn(), incrementStock: vi.fn() };
  const vendorRepo = { findById: async (id: string) => vendors.find(v => v.id === id), findByPersonId: async (id: string) => vendors.find(v => v.personId === id) };
  const categoryRepo = { findAll: async () => categories };
  let items = products.map(p => ({ productId: p.id, vendorId: p.vendorId, quantity: 1, unitPrice: 999 }));
  const cart = { findById: async () => ({ isEmpty: false, items }), save: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const financial = { save: vi.fn(), update: vi.fn(), delete: vi.fn(), createSession: vi.fn() };
  const coupons = new CouponService(new InMemoryCouponRepository(), vendorRepo as any, productRepo as any, categoryRepo as any, () => new Date('2026-11-08T12:00:00Z'));
  const checkout = new CheckoutService(financial as any, financial as any, cart as any, productRepo as any, vendorRepo as any, { findById: async () => ({ addresses: [] }) } as any, {} as any, {} as any, financial as any, categoryRepo as any, undefined, coupons);
  const app = express(); app.use(express.json());
  app.use('/coupons', createCouponRoutes({ authService: {} as any, couponService: coupons }));
  app.use('/checkout', createCheckoutRoutes({ authService: {} as any, personRepo: {} as any, checkoutService: checkout }));
  return { products, categories, coupons, checkout, app, financial, cart, productRepo, setItems: (next: typeof items) => { items = next; } };
}

describe('coupon ownership, validity and exact quote contract', () => {
  it('derives ownership, isolates listings and rejects a duplicate without overwriting', async () => {
    const s = setup();
    for (const person of [undefined, 'admin', 'buyer']) {
      let req = request(s.app).post('/coupons').send(input); if (person) req = req.set('x-person', person);
      expect((await req).status).toBe(person ? 403 : 401);
    }
    expect((await request(s.app).post('/coupons').set('x-person', 'seller-b').send({ ...input, vendorId: 'a' })).status).toBe(400);
    const one = await s.coupons.create('seller-a', input);
    await s.coupons.create('seller-a', { ...input, code: 'SECOND', value: 2000 });
    expect(await s.coupons.list('seller-b')).toEqual([]);
    await expect(s.coupons.create('seller-a', { ...input, code: ' save ', value: 9999 })).rejects.toMatchObject({ code: 'COUPON_CONFLICT' });
    expect((await s.coupons.list('seller-a')).find(c => c.code === 'SAVE')).toEqual(one);
    await expect(s.coupons.create('seller-a', { ...input, includeProducts: ['b1'] })).rejects.toMatchObject({ code: 'INVALID_COUPON_TARGET' });
    await expect(s.coupons.create('seller-a', { ...input, includeCategories: ['missing'] })).rejects.toMatchObject({ code: 'INVALID_COUPON_TARGET' });
  });
  it.each([
    { value: 0 }, { value: 10001 }, { value: 0.5 }, { discountType: 'freeShipping' }, { value: Number.MAX_SAFE_INTEGER + 1 },
    { startsAt: 'bad' }, { endsAt: '2026-01-01T00:00:00Z' }, { minimumEligibleMinor: -1 }, { includeProducts: ['a1', 'a1'] },
  ])('rejects malformed terms %j', async change => {
    const s = setup(); await expect(s.coupons.create('seller-a', { ...input, ...change })).rejects.toThrow(); expect(await s.coupons.list('seller-a')).toEqual([]);
  });
  it.each([
    { endsAt: '2026-11-08T12:00:00Z' }, { startsAt: '2026-11-09T00:00:00Z' }, { minimumEligibleMinor: 2001 },
  ])('rejects inactive or unmet eligible minimum %j', async change => {
    const s = setup(); await s.coupons.create('seller-a', { ...input, ...change });
    await expect(s.checkout.previewCheckout('buyer', ['SAVE'])).rejects.toThrow();
    for (const spy of Object.values(s.financial)) expect(spy).not.toHaveBeenCalled();
  });
  it('requires explicit vendor for shared codes and forbids stacking but permits one per store', async () => {
    const s = setup();
    await s.coupons.create('seller-a', input); await s.coupons.create('seller-b', input);
    await expect(s.checkout.previewCheckout('buyer', ['SAVE'])).rejects.toMatchObject({ code: 'COUPON_VENDOR_REQUIRED' });
    await expect(s.checkout.previewCheckout('buyer', undefined, [{ vendorId: 'a', code: 'SAVE' }, { vendorId: 'a', code: 'SAVE' }])).rejects.toMatchObject({ code: 'INVALID_COUPON_SELECTION' });
    await expect(s.checkout.previewCheckout('buyer', ['UNKNOWN'])).rejects.toMatchObject({ code: 'INVALID_COUPON' });
    const q = await s.checkout.previewCheckout('buyer', undefined, [{ vendorId: 'a', code: 'SAVE' }, { vendorId: 'b', code: 'SAVE' }]);
    expect(q.discountMinor).toBe(210); expect(q.vendorGroups.every(g => g.coupon?.revision === 1)).toBe(true);
    await expect(s.checkout.previewCheckout('seller-a')).rejects.toMatchObject({ code: 'SELF_PURCHASE_FORBIDDEN' });
    await expect(s.checkout.checkout('seller-a', 'address')).rejects.toMatchObject({ code: 'SELF_PURCHASE_FORBIDDEN' });
    expect((await request(s.app).get('/checkout/preview').set('x-person', 'admin')).status).toBe(403);
  });
  it('applies product/category union and exclusion precedence, with eligible-base minimum', async () => {
    const s = setup(); await s.coupons.create('seller-a', { ...input, includeCategories: ['root'], includeProducts: ['a2'], excludeProducts: ['a2'], minimumEligibleMinor: 1001 });
    const q = await s.checkout.previewCheckout('buyer', ['SAVE']);
    expect(q).toMatchObject({ grossMinor: 2100, eligibleMinor: 1001, discountMinor: 100, netMinor: 2000 });
    expect(q.vendorGroups[0].items[1]).toMatchObject({ eligibleMinor: 0, discountMinor: 0 });
    expect(q.vendorGroups[1].discountMinor).toBe(0);
  });
  it('allocates fixed cents stably across quantities, conserves every sum and caps at 100 percent', async () => {
    const s = setup(); s.products[0].price = 1; s.products[1].price = 1;
    await s.coupons.create('seller-a', { ...input, discountType: 'fixedMinorBRL', value: 1 });
    const a = { productId: 'a1', vendorId: 'a', quantity: 3, unitPrice: 9 };
    const b = { productId: 'a2', vendorId: 'a', quantity: 3, unitPrice: 9 };
    s.setItems([b, a]); const first = await s.checkout.previewCheckout('buyer', ['SAVE']);
    s.setItems([a, b]); const second = await s.checkout.previewCheckout('buyer', ['SAVE']);
    const allocation = (q: any) => Object.fromEntries(q.vendorGroups[0].items.map((i: any) => [i.productId, i.discountMinor]));
    expect(allocation(first)).toEqual({ a1: 1, a2: 0 }); expect(allocation(second)).toEqual(allocation(first));
    for (const q of [first, second]) {
      expect(q.grossMinor! - q.discountMinor!).toBe(q.netMinor);
      for (const g of q.vendorGroups) {
        expect(g.items.reduce((n, i) => n + i.discountMinor!, 0)).toBe(g.discountMinor);
        expect(g.items.reduce((n, i) => n + i.netMinor!, 0)).toBe(g.netMinor);
        expect(g.items.every(i => i.netMinor! >= 0 && i.grossMinor! - i.discountMinor! === i.netMinor)).toBe(true);
      }
    }
    await s.coupons.create('seller-a', { ...input, code: 'ALL', value: 10000 });
    expect(await s.checkout.previewCheckout('buyer', ['ALL'])).toMatchObject({ discountMinor: 600, netMinor: 0 });
    await s.coupons.create('seller-a', { ...input, code: 'CAP', discountType: 'fixedMinorBRL', value: 10000 });
    expect((await s.checkout.previewCheckout('buyer', ['CAP'])).netMinor).toBe(0);
  });
  it('rounds percentage half up once on eligible base and rejects zero/overflow/invalid hierarchy', async () => {
    const s = setup(); s.products[0].price = 0.05;
    await s.coupons.create('seller-a', { ...input, includeProducts: ['a1'] });
    expect((await s.checkout.previewCheckout('buyer', ['SAVE'])).discountMinor).toBe(1);
    s.products[0].price = 0;
    await expect(s.checkout.previewCheckout('buyer', ['SAVE'])).rejects.toThrow();
    s.products[0].price = Number.MAX_SAFE_INTEGER;
    await expect(s.checkout.previewCheckout('buyer')).rejects.toThrow();
    s.products[0].price = 10;
    s.categories[0].parentId = 'child';
    await expect(s.checkout.previewCheckout('buyer', ['SAVE'])).rejects.toMatchObject({ code: 'INVALID_CATEGORY_HIERARCHY' });
    s.categories[0].parentId = 'missing';
    await expect(s.checkout.previewCheckout('buyer', ['SAVE'])).rejects.toMatchObject({ code: 'INVALID_CATEGORY_HIERARCHY' });
  });
  it('keeps coupon purchase gated including direct service bypass and emits no writes', async () => {
    const s = setup(); await s.coupons.create('seller-a', input);
    for (const body of [{ couponCodes: ['SAVE'] }, { couponSelections: [{ vendorId: 'a', code: 'SAVE' }] }]) {
      expect((await request(s.app).post('/checkout').set('x-person', 'buyer').send({ shippingAddressId: 'address', ...body })).status).toBe(503);
    }
    await expect(s.checkout.checkout('buyer', 'address', ['SAVE'])).rejects.toMatchObject({ code: 'COUPONS_UNAVAILABLE' });
    for (const spy of [...Object.values(s.financial), s.cart.save, s.cart.update, s.cart.delete, s.productRepo.decrementStock, s.productRepo.incrementStock]) expect(spy).not.toHaveBeenCalled();
  });
});
