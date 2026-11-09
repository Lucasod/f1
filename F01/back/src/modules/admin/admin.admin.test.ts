import { describe, it, expect, vi } from 'vitest';
import { MongoAdminMetricsRepository } from './admin.metrics';

describe('Admin Domain', () => {
  describe('MongoAdminMetricsRepository', () => {
    it('getTotals returns orders, vendors, products counts', async () => {
      // Use a mock Db object
      const collections: Record<string, any> = {};
      const mockDb = {
        collection: (name: string) => {
          if (!collections[name]) {
            collections[name] = { countDocuments: vi.fn().mockResolvedValue(0) };
          }
          return collections[name];
        },
      } as any;

      const repo = new MongoAdminMetricsRepository(mockDb);
      const totals = await repo.getTotals();

      expect(totals).toHaveProperty('orders');
      expect(totals).toHaveProperty('vendors');
      expect(totals).toHaveProperty('products');
    });

    it('getTotals calls countDocuments on each collection', async () => {
      const orderCount = vi.fn().mockResolvedValue(42);
      const vendorCount = vi.fn().mockResolvedValue(3);
      const productCount = vi.fn().mockResolvedValue(10);

      const mockDb = {
        collection: (name: string) => {
          if (name === 'orders') return { countDocuments: orderCount };
          if (name === 'vendors') return { countDocuments: vendorCount };
          if (name === 'products') return { countDocuments: productCount };
          return { countDocuments: vi.fn().mockResolvedValue(0) };
        },
      } as any;

      const repo = new MongoAdminMetricsRepository(mockDb);
      const totals = await repo.getTotals();

      expect(orderCount).toHaveBeenCalledWith({});
      expect(vendorCount).toHaveBeenCalledWith({});
      expect(productCount).toHaveBeenCalledWith({});
      expect(totals.orders).toBe(42);
      expect(totals.vendors).toBe(3);
      expect(totals.products).toBe(10);
    });
  });
});
