import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthService } from '../auth/auth.service';
import { PaymentService } from './payment.service';
import { Payment, OrderError, PaymentStatus, Order, OrderRepository } from './order.domain';
import { PaymentError } from './payment.service';
import { authMiddleware, AuthenticatedRequest, requireRole } from '../auth/auth.middleware';
import { PersonRole } from '../person/person.domain';
import { VendorRepository } from '../vendor/vendor.domain';

export interface PaymentRoutesConfig {
  authService: AuthService;
  paymentService: PaymentService;
  vendorRepo: VendorRepository;
  orderRepo: OrderRepository;
}

export function createPaymentRoutes({ authService, paymentService, vendorRepo, orderRepo }: PaymentRoutesConfig): Router {
  const router = Router();

  const authMw = authMiddleware(authService);
  const requireConsumer = requireRole(PersonRole.CONSUMER);
  const requireConsumerVendorAdmin = requireRole(PersonRole.CONSUMER, PersonRole.VENDOR, PersonRole.ADMIN);

  // CR-006/CR-007: Ownership isolation is enforced per handler by inspecting the
  // payment's order and the caller's role. Mismatches return 404 to avoid
  // leaking existence.
  // Limitations: vendor ownership requires a vendor profile (findByPersonId);
  // if missing, access is denied (404).

  function paymentToResponse(payment: Payment) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      personId: payment.personId,
      amount: payment.amount,
      status: payment.status,
      provider: payment.provider,
      providerTransactionId: payment.providerTransactionId,
      authorizedAt: payment.authorizedAt,
      capturedAt: payment.capturedAt,
      failedAt: payment.failedAt,
      refundedAt: payment.refundedAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt
    };
  }

  async function isOwner(req: AuthenticatedRequest, payment: Payment): Promise<boolean> {
    const personId = req.user.sub;
    if (req.user.roles.includes(PersonRole.ADMIN)) return true;
    if (req.user.roles.includes(PersonRole.CONSUMER) && payment.personId === personId) return true;
    if (req.user.roles.includes(PersonRole.VENDOR)) {
      const vendor = await vendorRepo.findByPersonId(personId);
      if (vendor) {
        const order = await orderRepo.findById(payment.orderId);
        if (order && order.vendorGroups.some(vg => vg.vendorId === vendor.id)) return true;
      }
    }
    return false;
  }

  async function isOrderOwner(req: AuthenticatedRequest, order: Order): Promise<boolean> {
    const personId = req.user.sub;
    if (req.user.roles.includes(PersonRole.ADMIN)) return true;
    if (req.user.roles.includes(PersonRole.CONSUMER) && order.personId === personId) return true;
    if (req.user.roles.includes(PersonRole.VENDOR)) {
      const vendor = await vendorRepo.findByPersonId(personId);
      if (vendor && order.vendorGroups.some(vg => vg.vendorId === vendor.id)) return true;
    }
    return false;
  }

  // POST /payments - Create payment for an order (auth required, CONSUMER role)
  router.post('/', authMw as RequestHandler, requireConsumer as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { orderId, amount, provider } = req.body || {};
      const personId = req.user.sub;

      // CR-004: ownership mismatch returns 403 (deliberate, documented choice) rather than 404.
      const payment = await paymentService.createPayment(orderId, personId, amount, provider);

      return res.status(201).json({ payment: paymentToResponse(payment) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PaymentError.ORDER_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.ORDER_NOT_FOUND, message: 'Order not found' });
          case OrderError.PERSON_ID_REQUIRED:
            return res.status(400).json({ error: OrderError.PERSON_ID_REQUIRED, message: 'Person ID is required' });
          case PaymentError.INVALID_PAYMENT_AMOUNT:
            return res.status(400).json({ error: PaymentError.INVALID_PAYMENT_AMOUNT, message: 'Invalid payment amount' });
          case PaymentError.INVALID_PROVIDER:
            return res.status(400).json({ error: PaymentError.INVALID_PROVIDER, message: 'Invalid provider' });
          case PaymentError.PAYMENT_AMOUNT_MISMATCH:
            return res.status(409).json({ error: PaymentError.PAYMENT_AMOUNT_MISMATCH, message: 'Payment amount does not match order total' });
          case OrderError.FORBIDDEN:
            return res.status(403).json({ error: OrderError.FORBIDDEN, message: 'Access denied' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /payments/:id/authorize - Authorize a payment (auth required)
  router.post('/:id/authorize', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const paymentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { providerTransactionId } = req.body || {};

      if (!providerTransactionId || typeof providerTransactionId !== 'string' || providerTransactionId.trim().length === 0) {
        return res.status(400).json({ error: 'PROVIDER_TRANSACTION_ID_REQUIRED', message: 'Provider transaction ID is required' });
      }

      const existingPayment = await paymentService.getPaymentById(paymentId);
      if (!existingPayment) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }
      const allowed = await isOwner(req, existingPayment);
      if (!allowed) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }

      const payment = await paymentService.authorizePayment(paymentId, providerTransactionId);

      return res.json({ payment: paymentToResponse(payment) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PaymentError.PAYMENT_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
          case PaymentError.PAYMENT_NOT_AUTHORIZABLE:
            return res.status(409).json({ error: PaymentError.PAYMENT_NOT_AUTHORIZABLE, message: 'Payment is not authorizable' });
          case PaymentError.ORDER_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.ORDER_NOT_FOUND, message: 'Order not found' });
          case PaymentError.PAYMENT_AMOUNT_MISMATCH:
            return res.status(409).json({ error: PaymentError.PAYMENT_AMOUNT_MISMATCH, message: 'Payment amount does not match order total' });
          case PaymentError.ORDER_NOT_PAYABLE:
            return res.status(409).json({ error: PaymentError.ORDER_NOT_PAYABLE, message: 'Order is not payable' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /payments/:id/capture - Capture an authorized payment (auth required)
  router.post('/:id/capture', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const paymentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const existingPayment = await paymentService.getPaymentById(paymentId);
      if (!existingPayment) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }
      const allowed = await isOwner(req, existingPayment);
      if (!allowed) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }

      const payment = await paymentService.capturePayment(paymentId);

      return res.json({ payment: paymentToResponse(payment) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PaymentError.PAYMENT_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
          case PaymentError.PAYMENT_NOT_CAPTURABLE:
            return res.status(409).json({ error: PaymentError.PAYMENT_NOT_CAPTURABLE, message: 'Payment is not capturable' });
          case PaymentError.ORDER_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.ORDER_NOT_FOUND, message: 'Order not found' });
          case PaymentError.ORDER_NOT_PAYABLE:
            return res.status(409).json({ error: PaymentError.ORDER_NOT_PAYABLE, message: 'Order is not payable' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /payments/:id/refund - Refund a captured payment (T-1004) (auth required)
  router.post('/:id/refund', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const paymentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      // Reject duplicate refund requests at the API boundary
      const existingPayment = await paymentService.getPaymentById(paymentId);
      if (!existingPayment) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }
      const allowed = await isOwner(req, existingPayment);
      if (!allowed) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }
      if (existingPayment.status === PaymentStatus.REFUNDED) {
        return res.status(409).json({ error: PaymentError.PAYMENT_NOT_REFUNDABLE, message: 'Payment is not refundable' });
      }

      const payment = await paymentService.refundPayment(paymentId);

      return res.json({ payment: paymentToResponse(payment) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PaymentError.PAYMENT_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
          case PaymentError.PAYMENT_NOT_REFUNDABLE:
            return res.status(409).json({ error: PaymentError.PAYMENT_NOT_REFUNDABLE, message: 'Payment is not refundable' });
          case PaymentError.ORDER_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.ORDER_NOT_FOUND, message: 'Order not found' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // POST /payments/:id/fail - Fail a payment (auth required)
  router.post('/:id/fail', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const paymentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const existingPayment = await paymentService.getPaymentById(paymentId);
      if (!existingPayment) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }
      const allowed = await isOwner(req, existingPayment);
      if (!allowed) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }

      const payment = await paymentService.failPayment(paymentId);

      return res.json({ payment: paymentToResponse(payment) });
    } catch (error) {
      if (error instanceof Error) {
        switch (error.message) {
          case PaymentError.PAYMENT_NOT_FOUND:
            return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
          case PaymentError.PAYMENT_NOT_AUTHORIZABLE:
            return res.status(409).json({ error: PaymentError.PAYMENT_NOT_AUTHORIZABLE, message: 'Payment is not failurable' });
        }
      }
      next(error);
    }
  }) as RequestHandler);

  // GET /payments/:id - Get payment by ID (auth required)
  router.get('/:id', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const payment = await paymentService.getPaymentById(id);
      if (!payment) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }
      const allowed = await isOwner(req, payment);
      if (!allowed) {
        return res.status(404).json({ error: PaymentError.PAYMENT_NOT_FOUND, message: 'Payment not found' });
      }

      return res.json({ payment: paymentToResponse(payment) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  // GET /payments/order/:orderId - Get payments for an order (auth required)
  router.get('/order/:orderId', authMw as RequestHandler, requireConsumerVendorAdmin as RequestHandler, (async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;

      const order = await orderRepo.findById(orderId);
      if (!order) {
        return res.status(404).json({ error: OrderError.ORDER_NOT_FOUND, message: 'Order not found' });
      }
      const allowed = await isOrderOwner(req, order);
      if (!allowed) {
        return res.status(404).json({ error: OrderError.ORDER_NOT_FOUND, message: 'Order not found' });
      }

      const payments = await paymentService.getPaymentsByOrderId(orderId);

      return res.json({ payments: payments.map(paymentToResponse) });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  return router;
}