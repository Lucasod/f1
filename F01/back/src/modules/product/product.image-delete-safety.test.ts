import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProductRoutes } from './product.routes';

vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, res: any, next: any) => {
    const role = req.header('x-test-role');
    if (!role) return res.sendStatus(401);
    req.user = { sub: req.header('x-test-person'), roles: [role] };
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user.roles.some((role: string) => roles.includes(role))) return res.sendStatus(403);
    next();
  },
}));

describe('product image deletion safety', () => {
  it('denies deletion without changing storage or the reference while preserving authorization and not-found checks', async () => {
    const key = 'products/vendor/product/image.jpg';
    const url = `/uploads/${key}`;
    const removeImage = vi.fn();
    const product = { vendorId: 'vendor', images: [url], removeImage };
    const remove = vi.fn();
    const updateProduct = vi.fn();
    const app = express();
    app.use(createProductRoutes({
      authService: {} as any,
      personRepo: {} as any,
      vendorRepo: { findByPersonId: vi.fn(async (id: string) => id === 'owner' ? { id: 'vendor', status: 'active' } : { id: 'other', status: 'active' }) } as any,
      productService: { getProductById: vi.fn().mockResolvedValue(product), updateProduct } as any,
      storageAdapter: { getUrl: (imageKey: string) => `/uploads/${imageKey}`, delete: remove } as any,
    }));
    const route = `/product/images/${key}`;
    expect((await request(app).delete(route)).status).toBe(401);
    expect((await request(app).delete(route).set('x-test-role', 'CONSUMER').set('x-test-person', 'owner')).status).toBe(403);
    expect((await request(app).delete(route).set('x-test-role', 'VENDOR').set('x-test-person', 'other')).status).toBe(403);
    expect((await request(app).delete('/product/images/products/vendor/product/missing.jpg').set('x-test-role', 'VENDOR').set('x-test-person', 'owner')).status).toBe(404);
    for (const role of ['VENDOR', 'ADMIN']) {
      const response = await request(app).delete(route).set('x-test-role', role).set('x-test-person', 'owner');
      expect(response.status).toBe(503);
      expect(response.body.error).toBe('IMAGE_DELETE_UNAVAILABLE');
    }
    expect(remove).not.toHaveBeenCalled();
    expect(removeImage).not.toHaveBeenCalled();
    expect(updateProduct).not.toHaveBeenCalled();
    expect(product.images).toEqual([url]);
  });
});
