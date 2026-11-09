import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, requireVendor } from '../auth/auth.middleware';
import { VendorFinancialDashboardService } from './financial.dashboard.service';
import { FinancialDashboard } from './financial.dashboard.service';

export interface FinancialDashboardRoutesConfig {
  vendorFinancialDashboardService: VendorFinancialDashboardService;
}

export function createFinancialDashboardRoutes({
  vendorFinancialDashboardService,
}: FinancialDashboardRoutesConfig): Router {
  const router = Router();

  // GET /api/v1/financial/vendor-dashboard?periodStart?periodEnd
  router.get(
    '/',
    authMiddleware,
    requireVendor,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const vendorId = (req as any).user.personId;
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