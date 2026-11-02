import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { PayoutService } from './payout.service';
import { Payout, PayoutError, PayoutStatus } from './payout.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';

export interface PayoutRoutesConfig {
  authService: AuthService;
  payoutService: PayoutService;
  vendorRepo: VendorRepository;
}

export function createPayoutRoutes({ authService, payoutService, vendorRepo }: PayoutRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);
  const requireVendor = requireRole(PersonRole.VENDOR);
  const requireAdmin = requireRole(PersonRole.ADMIN);
  const requireConsumerVendorAdmin = requireRole(PersonRole.CONSUMER, PersonRole.VENDOR, PersonRole.ADMIN);

  function payoutToResponse(payout: Payout) {
    return {
      id: payout.id,
      vendorId: payout.vendorId,
      personId: payout.personId,
      amount: payout.amount,
      status: payout.status,
      requestedAt: payout.requestedAt,
      processedAt: payout.processedAt,
      failureReason: payout.failureReason,
      reference: payout.reference,
      bankAccount: payout.bankAccount,
      createdAt: payout.createdAt,
      updatedAt: payout.updatedAt,
    };
  }

  // POST /payouts - Create payout (vendor role)
  router.post('/', authMw as RequestHandler, requireVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: PayoutError.INVALID_AMOUNT, message: 'Invalid request body' });
      }
      const amount = req.body.amount;
      const bankAccount = req.body.bankAccount;

      const personId = req.user.sub;
      const vendor = await vendorRepo.findByPersonId(personId);
      if (!vendor) {
        return res.status(404).json({ error: PayoutError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
      }

      const payout = await payoutService.createPayout(vendor.id, personId, amount, bankAccount);
      return res.status(201).json({ payout: payoutToResponse(payout) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PayoutError.INVALID_AMOUNT:
            return res.status(400).json({ error: PayoutError.INVALID_AMOUNT, message: 'Invalid amount' });
          case PayoutError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: PayoutError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // GET /payouts - List payouts
  router.get('/', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);
      const vendorIdFilter = isAdmin && typeof req.query.vendorId === 'string' ? req.query.vendorId : undefined;
      const payouts = await payoutService.listPayouts(personId, isAdmin, vendorIdFilter);
      return res.json({ payouts: payouts.map(payoutToResponse) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /payouts/:id - Get payout by ID
  router.get('/:id', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);
      const payout = await payoutService.getPayoutById(id, personId, isAdmin);
      if (!payout) {
        return res.status(404).json({ error: PayoutError.PAYOUT_NOT_FOUND, message: 'Payout not found' });
      }
      return res.json({ payout: payoutToResponse(payout) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // PATCH /payouts/:id/approve - Approve payout (admin)
  router.patch('/:id/approve', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const payout = await payoutService.approvePayout(id, req.user.sub);
      return res.json({ payout: payoutToResponse(payout) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PayoutError.PAYOUT_NOT_FOUND:
            return res.status(404).json({ error: PayoutError.PAYOUT_NOT_FOUND, message: 'Payout not found' });
          case PayoutError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: PayoutError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
          case PayoutError.PAYOUT_NOT_APPROVABLE:
            return res.status(409).json({ error: PayoutError.PAYOUT_NOT_APPROVABLE, message: 'Payout is not approvable' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // PATCH /payouts/:id/cancel - Cancel payout (vendor/admin)
  router.patch('/:id/cancel', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const personId = req.user.sub;
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);
      const payout = await payoutService.cancelPayout(id, personId, isAdmin);
      return res.json({ payout: payoutToResponse(payout) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PayoutError.PAYOUT_NOT_FOUND:
            return res.status(404).json({ error: PayoutError.PAYOUT_NOT_FOUND, message: 'Payout not found' });
          case PayoutError.FORBIDDEN:
            return res.status(403).json({ error: PayoutError.FORBIDDEN, message: 'Access denied' });
          case PayoutError.PAYOUT_NOT_CANCELLABLE:
            return res.status(409).json({ error: PayoutError.PAYOUT_NOT_CANCELLABLE, message: 'Payout is not cancellable' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /payouts/:id/process - Process payout (admin, internal)
  router.post('/:id/process', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const payout = await payoutService.processPayout(id);
      return res.json({ payout: payoutToResponse(payout) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PayoutError.PAYOUT_NOT_FOUND:
            return res.status(404).json({ error: PayoutError.PAYOUT_NOT_FOUND, message: 'Payout not found' });
          case PayoutError.PAYOUT_NOT_PROCESSABLE:
            return res.status(409).json({ error: PayoutError.PAYOUT_NOT_PROCESSABLE, message: 'Payout is not processable' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /payouts/:id/fail - Fail payout (admin)
  router.post('/:id/fail', authMw as RequestHandler, requireAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const reason = req.body?.reason;
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return res.status(400).json({ error: PayoutError.INVALID_AMOUNT, message: 'Reason is required' });
      }
      const payout = await payoutService.failPayout(id, reason);
      return res.json({ payout: payoutToResponse(payout) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PayoutError.PAYOUT_NOT_FOUND:
            return res.status(404).json({ error: PayoutError.PAYOUT_NOT_FOUND, message: 'Payout not found' });
          case PayoutError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: PayoutError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
          case PayoutError.PAYOUT_NOT_PROCESSABLE:
            return res.status(409).json({ error: PayoutError.PAYOUT_NOT_PROCESSABLE, message: 'Payout is not processable' });
          case PayoutError.INVALID_AMOUNT:
            return res.status(400).json({ error: PayoutError.INVALID_AMOUNT, message: 'Invalid amount' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}
