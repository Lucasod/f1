import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProductRoutes } from './product.routes';

vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, _res: any, next: any) => {
    req.user = { sub: 'person', roles: ['VENDOR'] };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

describe('product image upload compensation', () => {
  it('uses a unique key and compensates completed uploads when a later save fails', async () => {
    const save = vi.fn().mockImplementationOnce(async (_buffer, key) => ({ key, url: `/uploads/${key}` }))
      .mockRejectedValueOnce(new Error('storage failure'));
    const remove = vi.fn().mockResolvedValue(undefined);
    const updateProduct = vi.fn();
    const app = express();
    app.use(createProductRoutes({
      authService: {} as any,
      personRepo: {} as any,
      vendorRepo: { findByPersonId: vi.fn().mockResolvedValue({ id: 'vendor', status: 'active' }) } as any,
      productService: { getProductById: vi.fn().mockResolvedValue({ vendorId: 'vendor', images: [] }), updateProduct } as any,
      storageAdapter: { save, delete: remove } as any,
    }));
    const response = await request(app).post('/product/images')
      .attach('images', Buffer.from('first'), { filename: 'first.jpg', contentType: 'image/jpeg' })
      .attach('images', Buffer.from('second'), { filename: 'second.jpg', contentType: 'image/jpeg' });
    expect(response.status).toBe(500);
    const firstKey = save.mock.calls[0][1];
    expect(firstKey).toMatch(/^products\/vendor\/product\/.+\.jpg$/);
    expect(firstKey).not.toBe('products/vendor/product/main.jpg');
    expect(remove).toHaveBeenCalledWith(firstKey);
    expect(updateProduct).not.toHaveBeenCalled();
  });
});
