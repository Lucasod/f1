import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { authMiddleware, requireAdmin } from '../auth/auth.middleware';
import { AuthService } from '../auth/auth.service';

export interface AdminDashboardData {
  orders: number;
  vendors: number;
  products: number;
}

export function createAdminDashboardRoutes({ authService }: { authService: AuthService }): Router {
  const router = Router();
  router.get('/dashboard', authMiddleware(authService), requireAdmin() as RequestHandler,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        res.json({
          status: 'ok',
          dashboard: {
            orders: 0,
            vendors: 0,
            products: 0,
          },
        });
      } catch (error) {
        next(error);
      }
    });
  return router;
}
