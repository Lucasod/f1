/**
 * Payment Service - FS-01 Marketplace
 * 
 * Stripe Integration Boundary:
 * This service handles payment orchestration, validation, idempotency, and state transitions.
 * It does NOT integrate with the Stripe SDK directly.
 * 
 * Stripe integration is delegated to a separate PaymentProvider adapter (to be implemented in P4).
 * This service accepts a providerTransactionId from the provider adapter after external authorization/capture.
 * The provider adapter is responsible for:
 *   - Creating PaymentIntents / SetupIntents with Stripe
 *   - Handling webhooks (payment_intent.succeeded, payment_intent.payment_failed, etc.)
 *   - Managing Stripe customer and payment method tokens
 *   - Idempotency keys for Stripe API calls
 * 
 * This service only manages the internal Payment entity lifecycle and coordinates with Order.
 */

import {
  Payment,
  PaymentStatus,
  PaymentRepository,
  Order,
  OrderRepository,
  OrderError,
  OrderStatus,
  FinancialStatus
} from './order.domain';

import type { ProductRepository } from '../product/product.domain';

export enum PaymentError {
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  PAYMENT_ALREADY_EXISTS = 'PAYMENT_ALREADY_EXISTS',
  INVALID_PAYMENT_AMOUNT = 'INVALID_PAYMENT_AMOUNT',
  INVALID_PROVIDER = 'INVALID_PROVIDER',
  PAYMENT_NOT_AUTHORIZABLE = 'PAYMENT_NOT_AUTHORIZABLE',
  PAYMENT_NOT_CAPTURABLE = 'PAYMENT_NOT_CAPTURABLE',
  PAYMENT_NOT_REFUNDABLE = 'PAYMENT_NOT_REFUNDABLE',
  PAYMENT_ALREADY_PROCESSED = 'PAYMENT_ALREADY_PROCESSED',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_NOT_PAYABLE = 'ORDER_NOT_PAYABLE',
  PAYMENT_AMOUNT_MISMATCH = 'PAYMENT_AMOUNT_MISMATCH'
}

const VALID_PROVIDERS = ['stripe', 'mock'] as const;
type ValidProvider = typeof VALID_PROVIDERS[number];

function isValidProvider(provider: string): provider is ValidProvider {
  return VALID_PROVIDERS.includes(provider as ValidProvider);
}

export class PaymentService {
  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly orderRepo: OrderRepository,
    private readonly productRepo?: ProductRepository
  ) {}

  async createPayment(
    orderId: unknown,
    personId: string,
    amount: number,
    provider?: string
  ): Promise<Payment> {
    // CR-005: validate orderId is a string
    if (typeof orderId !== 'string') {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }
    if (!orderId || orderId.trim().length === 0) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }
    if (!personId || personId.trim().length === 0) {
      throw new Error(OrderError.PERSON_ID_REQUIRED);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(PaymentError.INVALID_PAYMENT_AMOUNT);
    }
    if (provider && !isValidProvider(provider)) {
      throw new Error(PaymentError.INVALID_PROVIDER);
    }

    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }

    // Ownership enforced unconditionally: only the order owner may create a payment.
    // CR-004: mismatch returns 403 (deliberate, documented choice) rather than 404.
    if (order.personId !== personId) {
      throw new Error(OrderError.FORBIDDEN);
    }

    if (order.totalAmount !== amount) {
      throw new Error(PaymentError.PAYMENT_AMOUNT_MISMATCH);
    }

    const existingPayments = await this.paymentRepo.findByOrderId(orderId);
    const pendingOrAuthorizedPayment = existingPayments.find(
      p => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.AUTHORIZED
    );
    if (pendingOrAuthorizedPayment) {
      return pendingOrAuthorizedPayment;
    }

    const payment = Payment.create({
      orderId,
      personId,
      amount,
      provider: provider ?? 'stripe'
    });

    return this.paymentRepo.save(payment);
  }

  async authorizePayment(
    paymentId: string,
    providerTransactionId: string
  ): Promise<Payment> {
    if (!paymentId || paymentId.trim().length === 0) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }
    if (!providerTransactionId || providerTransactionId.trim().length === 0) {
      throw new Error(PaymentError.INVALID_PROVIDER);
    }

    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    // Idempotency: if already authorized with same transaction ID, return as-is
    if (payment.status === PaymentStatus.AUTHORIZED && payment.providerTransactionId === providerTransactionId) {
      return payment;
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new Error(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    }

    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }

    if (payment.amount !== order.totalAmount) {
      throw new Error(PaymentError.PAYMENT_AMOUNT_MISMATCH);
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new Error(PaymentError.ORDER_NOT_PAYABLE);
    }

    payment.authorize(providerTransactionId);
    await this.paymentRepo.update(payment);

    order.markPaymentAuthorized();
    await this.orderRepo.update(order);

    return payment;
  }

  async completeCheckoutPayment(paymentId: string, providerTransactionId: string, amountTotal: number): Promise<Payment> {
    const existing = await this.paymentRepo.findById(paymentId);
    if (!existing) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }
    if (!Number.isInteger(amountTotal) || Math.round(existing.amount * 100) !== amountTotal) {
      throw new Error(PaymentError.PAYMENT_AMOUNT_MISMATCH);
    }
    if (existing.status === PaymentStatus.CAPTURED) {
      return existing;
    }
    if (existing.status === PaymentStatus.PENDING) {
      await this.authorizePayment(paymentId, providerTransactionId);
    }
    return this.capturePayment(paymentId);
  }

  async capturePayment(paymentId: string): Promise<Payment> {
    if (!paymentId || paymentId.trim().length === 0) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    // Idempotency: if already captured, return as-is
    if (payment.status === PaymentStatus.CAPTURED) {
      return payment;
    }

    if (payment.status !== PaymentStatus.AUTHORIZED) {
      throw new Error(PaymentError.PAYMENT_NOT_CAPTURABLE);
    }

    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }
    if (![OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(order.status)) {
      throw new Error(PaymentError.ORDER_NOT_PAYABLE);
    }

    payment.capture();
    await this.paymentRepo.update(payment);

    return payment;
  }

  async failPayment(paymentId: string): Promise<Payment> {
    if (!paymentId || paymentId.trim().length === 0) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    // Idempotency: if already failed, return as-is
    if (payment.status === PaymentStatus.FAILED) {
      return payment;
    }

    if (payment.status !== PaymentStatus.PENDING && payment.status !== PaymentStatus.AUTHORIZED) {
      throw new Error(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    }

    payment.fail();
    await this.paymentRepo.update(payment);

    const order = await this.orderRepo.findById(payment.orderId);
    if (order) {
      // If order is PAID (after authorization), transition to FAILED_PAYMENT
      // This requires the Order domain to allow PAID -> FAILED_PAYMENT transition
      if (order.status === OrderStatus.PAID) {
        order.transitionTo(OrderStatus.FAILED_PAYMENT);
      } else {
        order.markPaymentFailed();
      }
      await this.orderRepo.update(order);

      if (this.productRepo) {
        const quantities = new Map<string, number>();
        for (const vg of order.vendorGroups) {
          for (const item of vg.items) {
            quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
          }
        }

        const failures: unknown[] = [];
        for (const [productId, amount] of quantities) {
          try {
            await this.productRepo.incrementStock(productId, amount);
          } catch (err) {
            failures.push(err);
            console.error('Failed to restore stock for product', productId, err);
          }
        }

        if (failures.length > 0) {
          throw new Error(OrderError.STOCK_ROLLBACK_FAILED);
        }
      }
    }

    return payment;
  }

  async refundPayment(paymentId: string): Promise<Payment> {
    if (!paymentId || paymentId.trim().length === 0) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    // Idempotency: if already refunded, return as-is
    if (payment.status === PaymentStatus.REFUNDED) {
      return payment;
    }

    if (payment.status !== PaymentStatus.CAPTURED) {
      throw new Error(PaymentError.PAYMENT_NOT_REFUNDABLE);
    }

    payment.refund();
    await this.paymentRepo.update(payment);

    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }
    order.refund(true);
    await this.orderRepo.update(order);

    return payment;
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    if (!id || id.trim().length === 0) {
      return null;
    }
    return this.paymentRepo.findById(id);
  }

  async getPaymentsByOrderId(orderId: string): Promise<Payment[]> {
    if (!orderId || orderId.trim().length === 0) {
      return [];
    }
    return this.paymentRepo.findByOrderId(orderId);
  }

  async getPaymentsByPersonId(personId: string): Promise<Payment[]> {
    if (!personId || personId.trim().length === 0) {
      return [];
    }
    return this.paymentRepo.findByPersonId(personId);
  }
}
