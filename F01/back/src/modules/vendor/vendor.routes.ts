import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { VendorService, VendorError } from './vendor.service';
import { PersonRepository } from '../person/person.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';

export interface VendorRoutesConfig {
  authService: AuthService;
  vendorService: VendorService;
  personRepo: PersonRepository;
}

export function createVendorRoutes({ authService, vendorService, personRepo }: VendorRoutesConfig): Router {
  const router = Router();

  // Middleware to check if user can onboard (VENDOR or CONSUMER role, not ADMIN)
  const canOnboardVendor = requireRole(PersonRole.VENDOR, PersonRole.CONSUMER);
  const authMw = authMiddleware(authService);

  // POST /api/v1/vendor/onboard
  router.post('/onboard', authMw as RequestHandler, canOnboardVendor as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { storeName, slug } = req.body;

      if (!storeName || storeName.trim().length === 0) {
        return res.status(400).json({ error: 'STORE_NAME_REQUIRED', message: 'Store name is required' });
      }

      if (!slug || slug.trim().length === 0) {
        return res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Slug is required' });
      }

      const personId = req.user.sub;
      const vendor = await vendorService.onboardVendor(personId, { storeName, slug });

      return res.status(201).json({ vendor: vendorToResponse(vendor) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case VendorError.INVALID_SLUG_FORMAT:
            return res.status(400).json({ error: VendorError.INVALID_SLUG_FORMAT, message: 'Slug must contain only lowercase letters, numbers, and hyphens' });
          case VendorError.SLUG_ALREADY_EXISTS:
            return res.status(409).json({ error: VendorError.SLUG_ALREADY_EXISTS, message: 'Slug already exists' });
          case VendorError.PERSON_ALREADY_HAS_VENDOR:
            return res.status(409).json({ error: VendorError.PERSON_ALREADY_HAS_VENDOR, message: 'Person already has a vendor profile' });
          case VendorError.PERSON_NOT_FOUND:
            return res.status(404).json({ error: VendorError.PERSON_NOT_FOUND, message: 'Person not found' });
          case VendorError.ADMIN_CANNOT_BE_VENDOR:
            return res.status(403).json({ error: VendorError.ADMIN_CANNOT_BE_VENDOR, message: 'Admin users cannot be vendors' });
          case VendorError.INVALID_COMMISSION_PCT:
            return res.status(400).json({ error: VendorError.INVALID_COMMISSION_PCT, message: 'Invalid commission percentage' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // GET /api/v1/vendor/me
  router.get('/me', authMw as RequestHandler, requireRole(PersonRole.VENDOR, PersonRole.ADMIN) as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const personId = req.user.sub;
      const vendor = await vendorService.getVendorByPersonId(personId);

      if (!vendor) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found' });
      }

      return res.json({ vendor: vendorToResponse(vendor) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // PATCH /api/v1/vendor/me
  router.patch('/me', authMw as RequestHandler, requireRole(PersonRole.VENDOR, PersonRole.ADMIN) as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { storeName } = req.body;

      if (storeName !== undefined && (!storeName || storeName.trim().length === 0)) {
        return res.status(400).json({ error: 'STORE_NAME_REQUIRED', message: 'Store name cannot be empty' });
      }

      const personId = req.user.sub;
      const vendor = await vendorService.getVendorByPersonId(personId);

      if (!vendor) {
        return res.status(404).json({ error: 'VENDOR_NOT_FOUND', message: 'Vendor profile not found' });
      }

      // Ownership check - user can only update their own vendor (CD-059)
      // Allow ADMIN to manage any vendor (CD-059: Admin manages the platform)
      const isAdmin = req.user.roles.includes(PersonRole.ADMIN);
      if (!isAdmin && vendor.personId !== personId) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
      }

      const updated = await vendorService.updateVendor(vendor.id, { storeName: storeName?.trim() });

      return res.json({ vendor: vendorToResponse(updated) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case VendorError.STORE_NAME_REQUIRED:
            return res.status(400).json({ error: VendorError.STORE_NAME_REQUIRED, message: 'Store name is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}

function vendorToResponse(vendor: any) {
  return {
    id: vendor.id,
    personId: vendor.personId,
    storeName: vendor.storeName,
    slug: vendor.slug,
    status: vendor.status,
    commissionPct: vendor.commissionPct,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt
  };
}