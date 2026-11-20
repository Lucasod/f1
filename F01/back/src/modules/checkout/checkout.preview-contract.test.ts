import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCheckoutRoutes } from './checkout.routes';
import { checkoutApi } from '../../../../front/src/shared/api/checkout';
import { apiClient } from '../../../../front/src/shared/api/client';

vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, res: any, next: any) => {
    if (!req.header('x-test-consumer')) return res.sendStatus(401);
    req.user = { sub: 'consumer', roles: ['CONSUMER'] }; next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

describe('checkout preview contract', () => {
  it('connects the actual frontend client to the HTTP handler without real payments', async () => {
    const preview = { vendorGroups: [], totalAmount: 12, discountAmount: 0 };
    const previewCheckout = vi.fn().mockResolvedValue(preview);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/checkout', createCheckoutRoutes({ authService: {} as any, personRepo: {} as any, checkoutService: { previewCheckout } as any }));
    const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      const response = await request(app).get(url).set('x-test-consumer', 'yes');
      return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'content-type': 'application/json' } });
    });
    try {
      await expect(checkoutApi.preview()).resolves.toEqual(preview);
      await expect(checkoutApi.preview(['ONE', 'TWO'])).rejects.toMatchObject({ status: 503, code: 'COUPONS_UNAVAILABLE' });
      expect(previewCheckout).toHaveBeenCalledTimes(2);
    } finally {
      get.mockRestore();
    }
  });
  it('preserves the preview envelope and fails closed for coupon requests', async () => {
    const previewCheckout = vi.fn().mockResolvedValue({ vendorGroups: [], totalAmount: 1, discountAmount: 0 });
    const checkout = vi.fn().mockResolvedValue({ order: { vendorGroups: [], totalAmount: 1 }, checkoutUrl: '/test-session' });
    const app = express();
    app.use(express.json());
    app.use(createCheckoutRoutes({ authService: {} as any, personRepo: {} as any, checkoutService: { previewCheckout, checkout } as any }));
    expect((await request(app).get('/preview')).status).toBe(401);
    const plain = await request(app).get('/preview').set('x-test-consumer', 'yes');
    expect(plain.status).toBe(200);
    expect(plain.body.preview.totalAmount).toBe(1);
    for (const query of ['couponCodes=ONE', 'couponCodes=ONE&couponCodes=TWO']) {
      const response = await request(app).get(`/preview?${query}`).set('x-test-consumer', 'yes');
      expect(response.status).toBe(503);
      expect(response.body.error).toBe('COUPONS_UNAVAILABLE');
    }
    expect((await request(app).get(`/preview?couponCodes=${'a'.repeat(65)}`).set('x-test-consumer', 'yes')).status).toBe(400);
    expect((await request(app).get(`/preview?${Array(21).fill('couponCodes=A').join('&')}`).set('x-test-consumer', 'yes')).status).toBe(400);
    expect((await request(app).get('/preview?couponCodes%5B0%5D=ONE').set('x-test-consumer', 'yes')).status).toBe(400);
    const purchase = await request(app).post('/').set('x-test-consumer', 'yes').send({ shippingAddressId: 'address', couponCodes: ['ONE'] });
    expect(purchase.status).toBe(503);
    expect(checkout).not.toHaveBeenCalled();
    const plainPurchase = await request(app).post('/').set('x-test-consumer', 'yes').send({ shippingAddressId: 'address' });
    expect(plainPurchase.status).toBe(201);
    expect(checkout).toHaveBeenCalledTimes(1);
    expect(previewCheckout).toHaveBeenCalledTimes(3);
  });
});
