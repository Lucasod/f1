import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { Db } from 'mongodb';
import { authMiddleware, requireAdmin } from '../auth/auth.middleware';
import { AuthService } from '../auth/auth.service';

export interface AdminMetricsRepository {
  getTotals(): Promise<{ orders: number; vendors: number; products: number }>;
}

export class MongoAdminMetricsRepository implements AdminMetricsRepository {
  constructor(private readonly db: Db) {}

  async getTotals() {
    const [orders, vendors, products] = await Promise.all([
      this.db.collection('orders').countDocuments({}),
      this.db.collection('vendors').countDocuments({}),
      this.db.collection('products').countDocuments({}),
    ]);
    return { orders, vendors, products };
  }
}

export function createAdminMetricsRoutes({ authService, metrics }: { authService: AuthService; metrics: AdminMetricsRepository }): Router {
  const router = Router();
  router.get('/metrics', authMiddleware(authService), requireAdmin() as RequestHandler,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await metrics.getTotals());
      } catch (error) {
        next(error);
      }
    });
  return router;
}
