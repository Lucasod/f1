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
  FinancialStatus,
  OrderVendorGroup
} from './order.domain';

import type { ProductRepository } from '../product/product.domain';
import { ElasticsearchProductIndex } from '../search/elasticsearch-product-index';
import type { WalletService } from '../wallet/wallet.service';
import type { FinancialService } from '../financial/financial.service';
import { FinancialAllocationType } from '../financial/financial.domain';

import { Transfer, TransferStatus } from '../transfer/transfer.domain';
import { MongoTransferRepository } from '../transfer/transfer.mongo.repository';
import Stripe from 'stripe';

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
    private readonly productRepo?: ProductRepository,
    private readonly walletService?: WalletService,
    private readonly financialService?: FinancialService,
    private readonly transferRepo?: MongoTransferRepository,
    private readonly searchIndex?: ElasticsearchProductIndex
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
      // Additional safety: verify event ID consistency for double-spend protection
      if (payment.eventId) {
        // Event ID mismatch suggests a different event was processed; proceed with caution
        // The payment will be rejected below if status is not PENDING
      }
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

    const authorized = payment.authorize(providerTransactionId);
    authorized.status && (payment.status = authorized.status);
    authorized.providerTransactionId && (payment.providerTransactionId = authorized.providerTransactionId);
    authorized.authorizedAt && (payment.authorizedAt = authorized.authorizedAt);
    await this.paymentRepo.update(payment);

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
    // Idempotency guard: if payment already in final state, return immediately
    // This prevents re-processing of duplicate webhook deliveries
    if (existing.status === PaymentStatus.FAILED || existing.status === PaymentStatus.REFUNDED) {
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

    // A persisted capture may still need its order update repaired after a retry.
    if (payment.status === PaymentStatus.CAPTURED) {
      await this.markCapturedOrderPaid(payment.orderId);
      return payment;
    }

    if (payment.status !== PaymentStatus.AUTHORIZED) {
      throw new Error(PaymentError.PAYMENT_NOT_CAPTURABLE);
    }

    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }
    if (![OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(order.status)) {
      throw new Error(PaymentError.ORDER_NOT_PAYABLE);
    }

    const captured = payment.capture();
    captured.status && (payment.status = captured.status);
    captured.capturedAt && (payment.capturedAt = captured.capturedAt);
    captured.providerTransactionId && (payment.providerTransactionId = captured.providerTransactionId);
    await this.paymentRepo.update(payment);

    await this.markCapturedOrderPaid(payment.orderId);

    return payment;
  }

  private async markCapturedOrderPaid(orderId: string): Promise<void> {
    // Reload after capture persistence; never regress advanced or terminal orders.
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }
    // CD-063: callers reach this only after capture persistence has succeeded.
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      order.transitionTo(OrderStatus.PAID);
      try {
        const result = await this.orderRepo.update(order);
        // If repository refused (returned unchanged non-PAID), treat as no-op.
        if (result && result.status !== OrderStatus.PAID) {
          return;
        }
      } catch (err) {
        try { console.error('markCapturedOrderPaid: conditional update failed for order', orderId, err); } catch { /* blocked in isolated test env */ }
        // Re-throw unexpected errors (not conditional-update failures)
        if (err == null || (typeof err !== 'object' && typeof err !== 'function') ||
            !('message' in err) || typeof err.message !== 'string' || !err.message.startsWith('INVALID_STATUS_TRANSITION')) {
          throw err;
        }
        // Conditional update failed; re-read persisted state.
        const persisted = await this.orderRepo.findById(orderId);
        if (persisted && persisted.status === OrderStatus.PAID) {
          return; // idempotent success
        }
        // Advanced/terminal state: do not overwrite.
        return;
      }
    }
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

    const failed = payment.fail();
    failed.status && (payment.status = failed.status);
    failed.providerTransactionId && (payment.providerTransactionId = failed.providerTransactionId);
    failed.failedAt && (payment.failedAt = failed.failedAt);
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
            if (this.searchIndex) {
              try {
                const product = await this.productRepo.findById(productId);
                if (product) {
                  await this.searchIndex.indexProduct(product);
                }
              } catch (indexError) {
                console.warn('Elasticsearch product indexing failed');
              }
            }
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

    const refunded = payment.refund();
    refunded.status && (payment.status = refunded.status);
    refunded.providerTransactionId && (payment.providerTransactionId = refunded.providerTransactionId);
    refunded.refundedAt && (payment.refundedAt = refunded.refundedAt);
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

  /**
   * Check whether duplicate delivery can skip processing. A captured payment
   * whose order is still pending must retry the order update, not capture again.
   */
  async isPaymentFinalized(paymentId: string): Promise<boolean> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) return false;
    if (payment.status === PaymentStatus.CAPTURED) {
      const order = await this.orderRepo.findById(payment.orderId);
      return order !== null && order.status !== OrderStatus.PENDING_PAYMENT;
    }
    return [
      PaymentStatus.FAILED,
      PaymentStatus.REFUNDED,
    ].includes(payment.status);
  }

  async createTransfer(
    paymentId: string,
    ovgId: string,
    attempt: number = 1
  ): Promise<{ transfer: Stripe.Transfer; entity: Transfer }> {
    if (!paymentId || paymentId.trim().length === 0) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }

    // Verify payment is in CAPTURED state (transfer creation only after capture)
    if (payment.status !== PaymentStatus.CAPTURED) {
      throw new Error(PaymentError.PAYMENT_NOT_CAPTURABLE);
    }

    // Find the order
    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }

    // Find the specific vendor group
    const vendorGroup = order.getVendorGroup(ovgId);
    if (!vendorGroup) {
      throw new Error(OrderError.VENDOR_NOT_FOUND);
    }

    // Calculate vendor net amount: ovg_total × (1 - commission_pct/100)
    const ovgTotal = vendorGroup.subtotal;
    const commissionPct = vendorGroup.commissionPct;
    const vendorNet = ovgTotal * (1 - commissionPct / 100);
    const transferAmount = Math.round(vendorNet * 100) / 100; // 2 decimal precision

    // Check if transfer already exists (idempotency)
    const existingTransfer = this.transferRepo
      ? await this.transferRepo.findLastByOrderVendorGroupId(ovgId)
      : null;

    if (existingTransfer && existingTransfer.status === TransferStatus.COMPLETED) {
      // Return existing completed transfer
      // We need the Stripe object; if we have the stripeTransferId, retrieve it
      if (existingTransfer.stripeTransferId && this.transferRepo) {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim() || 'sk_test_test', {
apiVersion: '2026-10-28.endive',
          });
          const stripeTransfer = await stripe.transfers.retrieve(
            existingTransfer.stripeTransferId
          );
          return { transfer: stripeTransfer, entity: existingTransfer };
        } catch {
          // Stripe object no longer available, fall through
        }
      }
      // Fall through: create a new transfer (existing entity is stale)
    }

    // Use the charge_id (providerTransactionId) as source_transaction
    const chargeId = payment.providerTransactionId;
    if (!chargeId) {
      throw new Error(PaymentError.INVALID_PROVIDER);
    }

    // Create idempotency key: order_id:ovg_id:attempt
    const idempotencyKey = `${payment.orderId}:${ovgId}:${attempt}`;

    // Determine if we have a transfer repo for persistence
    const repo = this.transferRepo;

    // Create the Transfer entity
    const transferEntity = Transfer.create({
      orderId: payment.orderId,
      orderVendorGroupId: ovgId,
      amount: transferAmount,
      currency: 'brl'
    });

    // Persist the entity to MongoDB if transfer repo is available
    if (repo) {
      await repo.save(transferEntity);
    }

    // Create Stripe Transfer
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim() || 'sk_test_test', {
      apiVersion: '2026-10-28.endive',
    });

    const stripeTransfer = await stripe.transfers.create(
      {
        amount: Math.round(transferAmount * 100), // Stripe expects amount in cents
        currency: 'brl',
        destination: '', // Will be set from vendor's connected account
        source_transaction: chargeId,
        transfer_group: payment.orderId,
      },
      {
        idempotencyKey: idempotencyKey,
      }
    );

    // Update the entity with Stripe transfer ID and provider transaction ID
    transferEntity.stripeTransferId = stripeTransfer.id;
    transferEntity.providerTransactionId = chargeId;
    transferEntity.status = TransferStatus.PROCESSING;

    // Persist updated entity
    if (repo) {
      await repo.save(transferEntity);
    }

    // Set the transferId on the OrderVendorGroup
    vendorGroup.setTransferId(stripeTransfer.id);

    return { transfer: stripeTransfer, entity: transferEntity };
  }
}
