import { expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createOrderRoutes } from './order.routes';

vi.mock('../auth/auth.middleware', () => ({
  authMiddleware: () => (req: any, _res: any, next: any) => { req.user = { sub: 'person', roles: [req.header('x-test-role') || 'VENDOR'] }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

it('does not expose other vendors or global aggregates in list and vendor status patch', async () => {
  const order = { id: 'o', personId: 'buyer', status: 'paid', financialStatus: 'paid', totalAmount: 900, vendorGroups: [
    { id: 'a', vendorId: 'a', subtotal: 100, items: [], status: 'pending' },
    { id: 'b', vendorId: 'b', subtotal: 800, items: [], status: 'pending' },
  ] };
  const service = { listOrders: vi.fn().mockResolvedValue({ orders: [order], total: 1, page: 1, limit: 20 }), updateVendorGroupStatus: vi.fn().mockResolvedValue(order), getOrderById: vi.fn().mockResolvedValue(order) };
  const app = express(); app.use(express.json());
  app.use(createOrderRoutes({ authService: {} as any, personRepo: { findById: vi.fn().mockResolvedValue({ name: 'Demo Buyer', email: 'private@example.com' }) } as any, vendorRepo: { findByPersonId: vi.fn().mockResolvedValue({ id: 'a', storeName: 'Test Store' }) } as any, orderService: service as any }));
  const list = await request(app).get('/orders');
  const patch = await request(app).patch('/orders/o/vendor-groups/a/status').send({ status: 'confirmed' });
  const detail = await request(app).get('/orders/o');
  expect(detail.body.order.paymentStatus).toBe('paid');
  expect(detail.body.order.saleParties).toEqual({ seller: 'Test Store', buyer: 'Demo Buyer' });
  expect(JSON.stringify(detail.body.order)).not.toContain('private@example.com');
  expect(detail.body.order.vendorGroups.map((group: any) => group.vendorId)).toEqual(['a']);
  expect(detail.body.order).not.toHaveProperty('financialStatus');
  for (const result of [list.body.orders[0], patch.body.order]) {
    expect(result.vendorGroups.map((group: any) => group.vendorId)).toEqual(['a']);
    expect(result.totalAmount).toBe(100);
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('financialStatus');
  }
  const filter = await request(app).get('/orders?status=paid');
  expect(filter.status).toBe(400);
  expect(service.listOrders).toHaveBeenCalledTimes(1);
});
