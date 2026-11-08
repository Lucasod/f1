import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PersonRole } from '../person/person.domain';
import { InMemoryVendorRepository, Vendor } from '../vendor/vendor.domain';
import { createAdminMetricsRoutes, MongoAdminMetricsRepository } from './admin.metrics';

describe('admin registered record metrics', () => {
  it('counts all registered in-memory vendors, including suspended vendors', async () => {
    const repo = new InMemoryVendorRepository();
    const vendor = Vendor.create({ personId: 'person-1', storeName: 'Store', slug: 'store' });
    await repo.save(vendor);
    vendor.suspend();
    await repo.update(vendor);
    expect(await repo.countAll()).toBe(1);
    await repo.delete(vendor.id);
    expect(await repo.countAll()).toBe(0);
  });

  it('counts all documents in the three source collections without pagination or status filters', async () => {
    const counts: Record<string, number> = { orders: 137, vendors: 42, products: 205 };
    const countDocuments = vi.fn(async function (this: { name: string }, filter: unknown) {
      expect(filter).toEqual({});
      return counts[this.name];
    });
    const db = { collection: (name: string) => ({ countDocuments: countDocuments.bind({ name }) }) };
    const repository = new MongoAdminMetricsRepository(db as any);
    expect(await repository.getTotals()).toEqual({ orders: 137, vendors: 42, products: 205 });
    expect(countDocuments).toHaveBeenCalledTimes(3);
  });

  it('requires an authenticated admin and propagates repository failures', async () => {
    const getTotals = vi.fn().mockResolvedValue({ orders: 137, vendors: 42, products: 205 });
    const authService = { verifyToken: (value: string) => ({ type: 'access', roles: value === 'admin' ? [PersonRole.ADMIN] : [PersonRole.CONSUMER] }) };
    const app = express();
    app.use('/api/v1/admin', createAdminMetricsRoutes({ authService: authService as any, metrics: { getTotals } }));
    app.use((_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: 'failed' }));
    await request(app).get('/api/v1/admin/metrics').expect(401);
    await request(app).get('/api/v1/admin/metrics').set('Authorization', 'Bearer consumer').expect(403);
    expect(getTotals).not.toHaveBeenCalled();
    const response = await request(app).get('/api/v1/admin/metrics').set('Authorization', 'Bearer admin').expect(200);
    expect(response.body).toEqual({ orders: 137, vendors: 42, products: 205 });
    getTotals.mockRejectedValueOnce(new Error('database unavailable'));
    await request(app).get('/api/v1/admin/metrics').set('Authorization', 'Bearer admin').expect(500);
  });
});
