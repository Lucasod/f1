import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createFinancialDashboardRoutes } from './financial.dashboard.routes';

describe('vendor financial dashboard route', () => {
  it('serves the authenticated vendor dashboard at the public API path', async () => {
    const getVendorDashboard = vi.fn().mockResolvedValue({ grossSales: 120, history: [], receivedInStripe: 4500, pendingDistribution: 1200 });
    const app = express();
    app.use('/api/v1/financial', createFinancialDashboardRoutes({
      authService: { verifyToken: () => ({ sub: 'person-1', roles: ['VENDOR'], type: 'access' }) } as any,
      vendorRepo: { findByPersonId: vi.fn().mockResolvedValue({ id: 'vendor-1' }) } as any,
      vendorFinancialDashboardService: { getVendorDashboard } as any,
    }));

    const response = await request(app).get('/api/v1/financial/vendor-dashboard')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.grossSales).toBe(120);
    expect(response.body.receivedInStripe).toBe(4500);
    expect(response.body.pendingDistribution).toBe(1200);
    expect(getVendorDashboard).toHaveBeenCalledWith('vendor-1', undefined, undefined);
    expect((await request(app).get('/api/v1/financial/vendor-dashboard')).status).toBe(401);
    const invalidPeriod = await request(app).get('/api/v1/financial/vendor-dashboard?periodStart=invalid')
      .set('Authorization', 'Bearer test-token');
    expect(invalidPeriod.status).toBe(400);
  });
});
