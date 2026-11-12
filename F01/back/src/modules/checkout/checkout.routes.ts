import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { CheckoutService, CheckoutPreviewResponse, PENDING_ORDER_ADDRESS_CONFLICT } from './checkout.service';
import { PersonRepository } from '../person/person.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { OrderError, Order } from '../order/order.domain';
import { CouponError, CouponSelection, canonicalCode } from '../coupon/coupon.domain';
import { AttemptError } from './checkout-attempt';

export interface CheckoutRoutesConfig {
  authService: AuthService;
  checkoutService: CheckoutService;
  personRepo: PersonRepository;
}

function parseCouponCodes(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const codes = Array.isArray(value) ? value : [value];
  if (codes.length > 20 || codes.some(code => typeof code !== 'string' || code.trim().length === 0 || code.length > 64)) {
    throw new Error('INVALID_COUPON_CODES');
  }
  return codes;
}

function parseSelections(value: unknown, query = false): CouponSelection[] {
  if (value === undefined) return [];
  if (query) {
    if (typeof value !== 'string' || value.length > 6000) throw new CouponError('INVALID_COUPON_SELECTION');
    try { value = JSON.parse(value); } catch { throw new CouponError('INVALID_COUPON_SELECTION'); }
  }
  if (!Array.isArray(value) || value.length > 20) throw new CouponError('INVALID_COUPON_SELECTION');
  return value.map(s => {
    if (!s || typeof s !== 'object' || Object.keys(s).some(k => !['vendorId', 'code'].includes(k)) || typeof s.vendorId !== 'string' || !s.vendorId.trim() || s.vendorId.length > 200) throw new CouponError('INVALID_COUPON_SELECTION');
    return { vendorId: s.vendorId, code: canonicalCode(s.code) };
  });
}

export function createCheckoutRoutes({ authService, checkoutService, personRepo }: CheckoutRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const requireConsumer = requireRole(PersonRole.CONSUMER);

  router.use('/attempts', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const attemptHandler = (operation: 'prepare' | 'accept' | 'read'): RequestHandler => async (request, res) => {
    const req = request as AuthenticatedRequest;
    try {
      if (req.user.roles.includes(PersonRole.ADMIN)) throw new AttemptError('FORBIDDEN', 403);
      const body = req.body ?? {};
      if (operation === 'prepare') {
        if (Object.keys(body).some(k => !['requestId', 'shippingAddressId', 'couponSelections'].includes(k)) || typeof body.shippingAddressId !== 'string' || !body.shippingAddressId.trim() || body.shippingAddressId.length > 200) throw new AttemptError('INVALID_ATTEMPT_INPUT', 400);
        const attempt = await checkoutService.prepareAttempt(req.user.sub, body.requestId, body.shippingAddressId, parseSelections(body.couponSelections));
        return res.status(201).json({ attempt });
      }
      const id = String(req.params.attemptId);
      if (operation === 'read') return res.json({ attempt: await checkoutService.getAttempt(req.user.sub, id) });
      if (Object.keys(body).some(k => !['expectedVersion', 'expectedHash'].includes(k)) || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 || typeof body.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedHash)) throw new AttemptError('INVALID_ATTEMPT_INPUT', 400);
      return res.json({ attempt: await checkoutService.acceptAttempt(req.user.sub, id, body.expectedVersion, body.expectedHash) });
    } catch (error) {
      if (error instanceof AttemptError) return res.status(error.status).json({ error: error.code, ...(error.attempt ? { attempt: error.attempt } : {}) });
      if (error instanceof CouponError) return res.status(error.status).json({ error: error.code });
      return res.status(503).json({ error: 'ATTEMPT_UNAVAILABLE' });
    }
  };
  router.post('/attempts', authMw as RequestHandler, requireConsumer as RequestHandler, attemptHandler('prepare'));
  router.get('/attempts/:attemptId', authMw as RequestHandler, requireConsumer as RequestHandler, attemptHandler('read'));
  router.post('/attempts/:attemptId/accept', authMw as RequestHandler, requireConsumer as RequestHandler, attemptHandler('accept'));

  // POST /checkout/attempts/:attemptId/checkout - Create order/payment from accepted attempt (TEST gate)
  router.post('/attempts/:attemptId/checkout', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user.roles.includes(PersonRole.ADMIN)) return res.status(403).json({ error: 'FORBIDDEN' });
      const { order, payment, checkoutUrl } = await checkoutService.checkoutFromAcceptedAttempt(req.user.sub, String(req.params.attemptId));
      return res.status(201).json({ order: orderToResponse(order), payment: { id: payment.id, status: payment.status, providerTransactionId: payment.providerTransactionId }, checkoutUrl });
    } catch (error) {
      if (error instanceof AttemptError) return res.status(error.status).json({ error: error.code, ...(error.attempt ? { attempt: error.attempt } : {}) });
      if (error instanceof CouponError) return res.status(error.status).json({ error: error.code });
      if (error instanceof Error) {
        switch (error.message) {
          case OrderError.CART_EMPTY: return res.status(400).json({ error: OrderError.CART_EMPTY });
          case 'CHECKOUT_URL_UNAVAILABLE': return res.status(503).json({ error: 'CHECKOUT_URL_UNAVAILABLE' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // GET /checkout/preview - Preview checkout totals (auth required, CONSUMER role)
  router.get('/preview', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      res.set('Cache-Control', 'no-store');
      if (req.user.roles.includes(PersonRole.ADMIN)) return res.status(403).json({ error: 'FORBIDDEN' });
      const consumerId = req.user.sub;
      const queryKeys = new URLSearchParams(req.originalUrl.split('?')[1] || '').keys();
      if (Array.from(queryKeys).some(key => key.startsWith('couponCodes[') || key.startsWith('couponSelections['))) throw new Error('INVALID_COUPON_CODES');
      const couponCodes = parseCouponCodes(req.query.couponCodes);
      const bodyCodes = parseCouponCodes(req.body?.couponCodes);
      if (bodyCodes?.length || req.body?.couponSelections !== undefined) throw new CouponError('INVALID_COUPON_SELECTION');
      const selections = parseSelections(req.query.couponSelections, true);

      const preview: CheckoutPreviewResponse = await checkoutService.previewCheckout(consumerId, couponCodes, selections);
      if ((couponCodes?.length || selections.length) && (preview.purchasable !== false || preview.calculationVersion !== 'coupon-quote-v1' || !preview.vendorGroups.some(g => g.coupon))) throw new CouponError('COUPONS_UNAVAILABLE', 503);

      return res.json({ preview });
    } catch (error) {
      if (error instanceof CouponError) return res.status(error.status).json({ error: error.code, message: 'Coupon quote unavailable' });
      if (error instanceof Error) {
        switch (error.message) {
          case 'INVALID_COUPON_CODES':
            return res.status(400).json({ error: 'INVALID_COUPON_CODES', message: 'Invalid coupon codes' });
          case OrderError.CART_EMPTY:
            return res.status(400).json({ error: OrderError.CART_EMPTY, message: 'Cart is empty' });
          case OrderError.PERSON_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.PERSON_ID_REQUIRED, message: 'Person ID is required' });
          case OrderError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: OrderError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case OrderError.INSUFFICIENT_STOCK:
            return res.status(409).json({ error: OrderError.INSUFFICIENT_STOCK, message: 'Insufficient stock' });
          case OrderError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /checkout - Create order from cart (auth required, CONSUMER role)
  router.post('/', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user.roles.includes(PersonRole.ADMIN)) return res.status(403).json({ error: 'FORBIDDEN' });
      const { shippingAddressId, couponCodes } = req.body;

      if (!shippingAddressId || typeof shippingAddressId !== 'string' || shippingAddressId.trim().length === 0) {
        return res.status(400).json({ error: 'SHIPPING_ADDRESS_ID_REQUIRED', message: 'Shipping address ID is required' });
      }

      if (couponCodes !== undefined && !Array.isArray(couponCodes)) throw new Error('INVALID_COUPON_CODES');
      const parsedCoupons = parseCouponCodes(couponCodes);
      const selections = parseSelections(req.body.couponSelections);
      // Per CD-050: only block coupons when the coupon service isn't wired up.
      // When the service is available, the flow proceeds to quoteCart which handles
      // per-vendor resolution, eligibility validation, and allocateMinorDiscount.
      if ((parsedCoupons?.length ?? 0) > 0 || selections.length > 0) {
        if (!checkoutService['coupons']) {
          return res.status(503).json({ error: 'COUPONS_UNAVAILABLE', message: 'Coupon validation and application are temporarily unavailable' });
        }
      }

      const consumerId = req.user.sub;

      const { order, checkoutUrl } = await checkoutService.checkout(consumerId, shippingAddressId, couponCodes);

      return res.status(201).json({ order: orderToResponse(order), checkoutUrl });
    } catch (error) {
      if (error instanceof CouponError) return res.status(error.status).json({ error: error.code, message: 'Coupon checkout unavailable' });
      if (error instanceof Error) {
        switch (error.message) {
          case 'INVALID_COUPON_CODES':
            return res.status(400).json({ error: 'INVALID_COUPON_CODES', message: 'Invalid coupon codes' });
          case OrderError.CART_EMPTY:
            return res.status(400).json({ error: OrderError.CART_EMPTY, message: 'Cart is empty' });
          case OrderError.INVALID_SHIPPING_ADDRESS:
            return res.status(404).json({ error: OrderError.INVALID_SHIPPING_ADDRESS, message: 'Invalid shipping address' });
          case PENDING_ORDER_ADDRESS_CONFLICT:
            return res.status(409).json({ error: PENDING_ORDER_ADDRESS_CONFLICT, message: 'A pending order for this cart has a different or unverifiable delivery address' });
          case OrderError.PRODUCT_NOT_FOUND:
            return res.status(404).json({ error: OrderError.PRODUCT_NOT_FOUND, message: 'Product not found' });
          case OrderError.INSUFFICIENT_STOCK:
            return res.status(409).json({ error: OrderError.INSUFFICIENT_STOCK, message: 'Insufficient stock' });
          case OrderError.VENDOR_NOT_FOUND:
            return res.status(404).json({ error: OrderError.VENDOR_NOT_FOUND, message: 'Vendor not found' });
          case OrderError.INVALID_COUPON:
            return res.status(400).json({ error: OrderError.INVALID_COUPON, message: 'Invalid coupon' });
          case OrderError.PERSON_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.PERSON_ID_REQUIRED, message: 'Person ID is required' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  return router;
}

function orderToResponse(order: Order) {
  return {
    id: order.id,
    personId: order.personId,
    status: order.status,
    vendorGroups: order.vendorGroups.map(vg => ({
      id: vg.id,
      orderId: vg.orderId,
      vendorId: vg.vendorId,
      status: vg.status,
      items: vg.items.map(item => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        vendorId: item.vendorId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice
      })),
      subtotal: vg.subtotal,
      commissionPct: vg.commissionPct,
      commissionAmount: vg.commissionAmount,
      vendorNet: vg.vendorNet,
      transferId: vg.transferId,
      createdAt: vg.createdAt,
      updatedAt: vg.updatedAt
    })),
    shippingAddress: order.shippingAddress,
    totalAmount: order.totalAmount,
    financialStatus: order.financialStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}
