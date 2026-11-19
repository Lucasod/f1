import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { authMiddleware, requireVendor, AuthenticatedRequest } from '../auth/auth.middleware';
import { VendorRepository } from '../vendor/vendor.domain';
import { VendorFinancialDashboardService } from './financial.dashboard.service';
import { FinancialDashboard } from './financial.dashboard.service';

export interface FinancialDashboardRoutesConfig {
  authService: AuthService;
  vendorFinancialDashboardService: VendorFinancialDashboardService;
  vendorRepo: VendorRepository;
}

export function createFinancialDashboardRoutes({
  authService,
  vendorFinancialDashboardService,
  vendorRepo,
}: FinancialDashboardRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);

  // GET /api/v1/financial/vendor-dashboard?periodStart?periodEnd
  router.get(
    '/',
    authMw as RequestHandler,
    requireVendor() as RequestHandler,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        // Resolve vendorId from the authenticated person via the vendor repository,
        // instead of trusting personId as vendorId (which is wrong for non-vendor persons).
        const user = (req as AuthenticatedRequest).user;
        const vendor = await vendorRepo.findByPersonId(user.sub);
        if (!vendor) {
          res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found for this person' });
          return;
        }
        const vendorId = vendor.id;
        const periodStart = req.query.periodStart
          ? new Date(String(req.query.periodStart))
          : undefined;
        const periodEnd = req.query.periodEnd
          ? new Date(String(req.query.periodEnd))
          : undefined;

        const dashboard: FinancialDashboard =
          await vendorFinancialDashboardService.getVendorDashboard(
            vendorId,
            periodStart,
            periodEnd
          );

        res.json({
          grossSales: dashboard.grossSales,
          grossSalesLabel: dashboard.grossSalesLabel,
          netExpectedAmount: dashboard.netExpectedAmount,
          receivedInStripe: dashboard.receivedInStripe,
          pendingDistribution: dashboard.pendingDistribution,
          bankPayout: dashboard.bankPayout,
          history: dashboard.history,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}