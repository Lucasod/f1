import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { WalletService } from './wallet.service';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { VendorRepository } from '../vendor/vendor.domain';

export interface WalletRoutesConfig {
  authService: AuthService;
  walletService: WalletService;
  vendorRepo: VendorRepository;
}

export function createWalletRoutes({ authService, walletService, vendorRepo }: WalletRoutesConfig): Router {
  const router = Router();
  const authMw = authMiddleware(authService);
  const requireVendorAdmin = requireRole(PersonRole.VENDOR, PersonRole.ADMIN);

  router.get('/wallet/balance', authMw as RequestHandler, requireVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      let ownerId = personId;
      if (req.user.roles.includes(PersonRole.VENDOR)) {
        const vendor = await vendorRepo.findByPersonId(personId);
        if (!vendor) return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found' });
        ownerId = vendor.id;
      }
      const balance = await walletService.getBalance(ownerId);
      return res.json({ ownerId, balance });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.get('/wallet/transactions', authMw as RequestHandler, requireVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      let ownerId = personId;
      if (req.user.roles.includes(PersonRole.VENDOR)) {
        const vendor = await vendorRepo.findByPersonId(personId);
        if (!vendor) return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found' });
        ownerId = vendor.id;
      }
      const txs = await walletService.listTransactions(ownerId);
      return res.json({ transactions: txs });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.get('/wallet/reconcile', authMw as RequestHandler, requireVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      let ownerId = personId;
      if (req.user.roles.includes(PersonRole.VENDOR)) {
        const vendor = await vendorRepo.findByPersonId(personId);
        if (!vendor) return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found' });
        ownerId = vendor.id;
      }
      const result = await walletService.reconcile(ownerId);
      return res.json(result);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  return router;
}
