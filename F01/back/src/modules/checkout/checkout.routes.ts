import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { CheckoutService, CheckoutPreviewResponse, PENDING_ORDER_ADDRESS_CONFLICT } from './checkout.service';
import { PersonRepository } from '../person/person.domain';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { OrderError, Order } from '../order/order.domain';

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

export function createCheckoutRoutes({ authService, checkoutService, personRepo }: CheckoutRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const requireConsumer = requireRole(PersonRole.CONSUMER);

  // GET /checkout/preview - Preview checkout totals (auth required, CONSUMER role)
  router.get('/preview', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const consumerId = req.user.sub;
      const queryKeys = new URLSearchParams(req.originalUrl.split('?')[1] || '').keys();
      if (Array.from(queryKeys).some(key => key.startsWith('couponCodes['))) throw new Error('INVALID_COUPON_CODES');
      const couponCodes = parseCouponCodes(req.query.couponCodes);
      const bodyCodes = parseCouponCodes(req.body?.couponCodes);
      if ((couponCodes?.length ?? 0) > 0 || (bodyCodes?.length ?? 0) > 0) {
        return res.status(503).json({ error: 'COUPONS_UNAVAILABLE', message: 'Coupon validation and application are temporarily unavailable' });
      }

      const preview: CheckoutPreviewResponse = await checkoutService.previewCheckout(consumerId, couponCodes);

      return res.json({ preview });
    } catch (error) {
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
      const { shippingAddressId, couponCodes } = req.body;

      if (!shippingAddressId || typeof shippingAddressId !== 'string' || shippingAddressId.trim().length === 0) {
        return res.status(400).json({ error: 'SHIPPING_ADDRESS_ID_REQUIRED', message: 'Shipping address ID is required' });
      }

      if (couponCodes !== undefined && !Array.isArray(couponCodes)) throw new Error('INVALID_COUPON_CODES');
      const parsedCoupons = parseCouponCodes(couponCodes);
      if ((parsedCoupons?.length ?? 0) > 0) {
        return res.status(503).json({ error: 'COUPONS_UNAVAILABLE', message: 'Coupon validation and application are temporarily unavailable' });
      }

      const consumerId = req.user.sub;

      const { order, checkoutUrl } = await checkoutService.checkout(consumerId, shippingAddressId, couponCodes);

      return res.status(201).json({ order: orderToResponse(order), checkoutUrl });
    } catch (error) {
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
