import { expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createProductRoutes } from './product.routes';

vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, _res: any, next: any) => { req.user = { sub: 'person', roles: ['VENDOR'] }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

it('reports a product creation collision as an explicit conflict', async () => {
  const app = express();
  app.use(express.json());
  app.use(createProductRoutes({
    authService: {} as any,
    personRepo: { findById: vi.fn().mockResolvedValue({ id: 'person' }) } as any,
    vendorRepo: { findByPersonId: vi.fn().mockResolvedValue({ id: 'vendor', status: 'active' }) } as any,
    productService: { createProduct: vi.fn().mockRejectedValue(new Error('PRODUCT_CONFLICT')) } as any,
    storageAdapter: {} as any,
  }));
  const response = await request(app).post('/').send({ categoryId: 'category', name: 'name', description: 'description', price: 1, quantity: 1 });
  expect(response.status).toBe(409);
  expect(response.body.error).toBe('PRODUCT_CONFLICT');
});
