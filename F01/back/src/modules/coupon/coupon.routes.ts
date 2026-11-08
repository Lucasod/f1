import { Router, RequestHandler } from 'express';
import type { AuthService } from '../auth/auth.service';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { CouponService } from './coupon.service';
import { CouponError } from './coupon.domain';

export function createCouponRoutes({ authService, couponService }: { authService: AuthService; couponService: CouponService }): Router {
  const router = Router();
  router.use(authMiddleware(authService));
  router.use(requireRole(PersonRole.VENDOR) as RequestHandler);
  router.use(((req: AuthenticatedRequest, res, next) => req.user.roles.includes(PersonRole.ADMIN) ? res.status(403).json({ error: 'FORBIDDEN' }) : next()) as RequestHandler);
  router.post('/', (async (req: AuthenticatedRequest, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { res.status(201).json({ coupon: await couponService.create(req.user.sub, req.body) }); }
    catch (error) { if (error instanceof CouponError) res.status(error.status).json({ error: error.code, message: 'Coupon could not be created' }); else next(error); }
  }) as RequestHandler);
  router.get('/', (async (req: AuthenticatedRequest, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ coupons: await couponService.list(req.user.sub) }); }
    catch (error) { if (error instanceof CouponError) res.status(error.status).json({ error: error.code, message: 'Coupons unavailable' }); else next(error); }
  }) as RequestHandler);
  return router;
}
