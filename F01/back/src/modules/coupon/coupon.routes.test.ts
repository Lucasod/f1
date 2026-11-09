import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CouponService } from './coupon.service';
import { InMemoryCouponRepository } from './coupon.domain';
import { createCouponRoutes } from './coupon.routes';

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
  const products = [{ id: 'a1', vendorId: 'a', categoryId: 'child', price: 10, quantity: 100 }, { id: 'b1', vendorId: 'b', categoryId: 'child', price: 10, quantity: 100 }];
  const vendors = [{ id: 'a', personId: 'seller-a', storeName: 'A', commissionPct: 10 }, { id: 'b', personId: 'seller-b', storeName: 'B', commissionPct: 10 }];
  const categories = [{ id: 'root', parentId: null }, { id: 'child', parentId: 'root' }];
  const productRepo = { findById: async (id: string) => products.find(p => p.id === id) };
  const vendorRepo = { findById: async (id: string) => vendors.find(v => v.id === id), findByPersonId: async (id: string) => vendors.find(v => v.personId === id) };
  const categoryRepo = { findAll: async () => categories };
  const coupons = new CouponService(new InMemoryCouponRepository(), vendorRepo as any, productRepo as any, categoryRepo as any, () => new Date('2026-11-08T12:00:00Z'));
  const app = express(); app.use(express.json());
  app.use('/coupons', createCouponRoutes({ authService: {} as any, couponService: coupons }));
  return { coupons, app };
}

describe('Coupon routes', () => {
  it('should reject unauthenticated, consumer and admin callers', async () => {
    const { app } = setup();
    expect((await request(app).post('/coupons').send(input)).status).toBe(401);
    expect((await request(app).post('/coupons').set('x-person', 'buyer').send(input)).status).toBe(403);
    expect((await request(app).post('/coupons').set('x-person', 'admin').send(input)).status).toBe(403);
    expect((await request(app).get('/coupons').set('x-person', 'buyer')).status).toBe(403);
    expect((await request(app).get('/coupons').set('x-person', 'admin')).status).toBe(403);
  });

  it('should create and list coupons with vendor isolation', async () => {
    const { app } = setup();
    const created = await request(app).post('/coupons').set('x-person', 'seller-a').send(input);
    expect(created.status).toBe(201);
    expect(created.body.coupon).toMatchObject({ vendorId: 'a', code: 'SAVE', revision: 1, value: 1000 });

    // Same vendor sees its coupon
    const listedA = await request(app).get('/coupons').set('x-person', 'seller-a');
    expect(listedA.status).toBe(200);
    expect(listedA.body.coupons).toHaveLength(1);
    expect(listedA.body.coupons[0].code).toBe('SAVE');

    // Other vendor sees nothing (different code for b)
    await request(app).post('/coupons').set('x-person', 'seller-b').send({ ...input, code: 'B-SAVE' });
    const listedB = await request(app).get('/coupons').set('x-person', 'seller-b');
    expect(listedB.body.coupons).toHaveLength(1);
    expect(listedB.body.coupons[0].code).toBe('B-SAVE');

    const listedAagain = await request(app).get('/coupons').set('x-person', 'seller-a');
    expect(listedAagain.body.coupons).toHaveLength(1);
    expect(listedAagain.body.coupons[0].code).toBe('SAVE');
  });

  it('should reject invalid terms and duplicate codes via HTTP', async () => {
    const { app } = setup();
    await request(app).post('/coupons').set('x-person', 'seller-a').send(input);

    const bad = await request(app).post('/coupons').set('x-person', 'seller-a').send({ ...input, value: 0 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_COUPON');

    const dupe = await request(app).post('/coupons').set('x-person', 'seller-a').send({ ...input, code: ' save ', value: 999 });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe('COUPON_CONFLICT');

    // List unchanged
    const listed = await request(app).get('/coupons').set('x-person', 'seller-a');
    expect(listed.body.coupons).toHaveLength(1);
  });
});
