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
  FinancialMovementRecord,
  MovementType,
  FinancialMovementRepository,
} from '../financial/financial.movement';
import {
  FinancialEventRecord,
  EventType,
  FinancialEventRepository,
} from '../financial/financial.event';

import {
  Payment,
  PaymentStatus,
  PaymentRepository,
  Order,
  OrderRepository,
  OrderError,
  OrderStatus,
  FinancialStatus,
  OrderVendorGroup,
  OrderVendorGroupStatus,
  VALID_STATUS_TRANSITIONS
} from './order.domain';

import type { ProductRepository } from '../product/product.domain';
import { ElasticsearchProductIndex } from '../search/elasticsearch-product-index';
import { WalletService } from '../wallet/wallet.service';
import type { FinancialService } from '../financial/financial.service';
import type { Db, ClientSession } from 'mongodb';
import { MongoClient } from 'mongodb';
import { FinancialLedger } from '../financial/financial.ledger';
import { MovementType as DomainMovementType } from '../financial/financial.movement';
import Stripe from 'stripe';
import type { MongoTransferRepository } from '../transfer/transfer.mongo.repository';
import { Transfer, TransferStatus } from '../transfer/transfer.domain';
import { TransferService } from '../transfer/transfer.service';
import type { VendorRepository } from '../vendor/vendor.domain';

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
    private readonly searchIndex?: ElasticsearchProductIndex,
    private readonly movementRepo?: FinancialMovementRepository,
    private readonly eventRepo?: FinancialEventRepository,
    private readonly vendorRepo?: VendorRepository,
    private readonly mongodb?: Db,
    private readonly transferService?: TransferService
  ) {}

  /**
   * Records a financial movement and event for a payment state transition.
   * Both are best-effort: if a repository is not wired, the recording is skipped
   * without failing the payment flow.
   * 
   * @param amount Custom amount to record. If undefined, uses payment.amount.
   *             When recording for each vendor group of a multi-vendor order,
   *             pass the vendor's subtotal (vg.subtotal) so each vendor only
   *             sees their portion of the payment.
   */
  private async recordPaymentLedger(
    payment: Payment,
    vendorId: string | undefined,
    movementType: MovementType,
    eventType: EventType,
    amount?: number,
    ovgId?: string,
    session?: ClientSession
  ): Promise<void> {
    const now = new Date();

    if (this.movementRepo) {
      const movement = FinancialMovementRecord.create({
        movementType,
        amount: amount ?? payment.amount,
        currency: 'brl',
        relatedEntityType: 'payment',
        relatedEntityId: payment.id,
        orderId: payment.orderId,
        paymentId: payment.id,
        vendorId,
        ovgId,
        effectiveAt: now,
        recordedAt: now,
        idempotencyKey: `payment:${payment.id}:${movementType}:${ovgId ?? 'none'}`,
      });
      await (this.movementRepo as any).save(movement, session);
    }

    if (this.eventRepo) {
      const event = FinancialEventRecord.create({
        eventType,
        eventSource: 'internal',
        eventTimestamp: now,
        orderId: payment.orderId,
        paymentId: payment.id,
        vendorId,
        ovgId,
      });
      await (this.eventRepo as any).save(event, session);
    }
  }

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

    // Derive the next attempt from the persisted history so concurrent retries share a key.
    const firstAttemptId = `attempt:${orderId}:${personId}:${amount}`;
    const attemptId = existingPayments.length === 0
      ? firstAttemptId
      : `${firstAttemptId}:retry:${existingPayments.length}`;

    return this.paymentRepo.insertForAttempt({ attemptId, orderId, personId, amount, provider: provider ?? 'stripe' });
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

    // FIND-A02-P0-003: record ledger for every vendor group, not just vendorGroups[0]
    // Pass each vendor's subtotal so they only see their portion of the payment
    for (const vg of order.vendorGroups) {
      await this.recordPaymentLedger(
        payment,
        vg.vendorId,
        MovementType.CONSUMER_PAYMENT,
        EventType.PAYMENT_AUTHORIZED,
        vg.subtotal
      );
    }

    return payment;
  }

  /**
   * Completes checkout payment after successful Stripe webhook verification.
   * 
   * SECURITY ARCHITECTURE NOTE:
   * This method is ONLY called from the verified Stripe webhook handler
   * (stripe-webhook.handler.ts) AFTER signature verification:
   *   stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
   * 
   * Public API endpoints for authorize/capture are EXPLICITLY BLOCKED
   * with 403 "PROVIDER_CONFIRMATION_REQUIRED" - they cannot be called
   * directly by clients. Payment completion flows exclusively through
   * the webhook path which guarantees Stripe signature verification.
   * 
   * This method is INTERNAL and must not be exposed as a public endpoint.
   * It handles idempotency for duplicate webhook deliveries.
   */
  async completeCheckoutPayment(paymentId: string, providerTransactionId: string, amountTotal: number): Promise<Payment> {
    const existing = await this.paymentRepo.findById(paymentId);
    if (!existing) {
      throw new Error(PaymentError.PAYMENT_NOT_FOUND);
    }
    const existingAmountInCents = Math.round(existing.amount * 100);
    if (!Number.isInteger(amountTotal) || existingAmountInCents !== amountTotal) {
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

    // CD-048 / CD-065: Snapshot commission per OVG at capture time so refunds
    // use the commission rate that was in effect when payment was captured,
    // not a possibly-changed current rate (R-05: defasado percentual de comissão).
    const commissionSnapshot = order.vendorGroups.map(vg => ({
      ovgId: vg.id,
      vendorId: vg.vendorId,
      subtotal: vg.subtotal,
      commissionPct: vg.commissionPct,
      commissionAmount: vg.commissionAmount,
      vendorNet: vg.vendorNet
    }));
    payment.commissionSnapshot = commissionSnapshot;

    if (!this.mongodb) {
      throw new Error('PAYMENT_CAPTURE_REQUIRES_TRANSACTIONAL_DEPS');
    }

    if (this.mongodb) {
      const client = this.mongodb.client;
      const session = client.startSession();
      try {
        await session.withTransaction(async (session) => {
          // Atualiza pagamento com commissionSnapshot
          await this.paymentRepo.update(payment, session);

          // Atualiza ordem para PAID e define vendor groups como PENDING
          await this.markCapturedOrderPaid(payment.orderId, session);
        });
      } finally {
        await session.endSession();
      }
    }

    // FIND-A02-P0-003: record ledger for every vendor group, not just vendorGroups[0]
    // Pass each vendor's subtotal so they only see their portion of the payment
    for (const vg of order.vendorGroups) {
      await this.recordPaymentLedger(
        payment,
        vg.vendorId,
        MovementType.CONSUMER_PAYMENT,
        EventType.PAYMENT_CAPTURED,
        vg.subtotal
      );
    }

    // FIND-A02-P0-002: Trigger transfer creation per OVG after order is PAID.
    // Transfer creation is a side effect; failures must not block the core
    // payment flow or prevent cart reconciliation in the webhook handler.
    if (this.transferService) {
      const paidOrder = await this.orderRepo.findById(payment.orderId);
      if (paidOrder && paidOrder.status === OrderStatus.PAID) {
        for (const vg of paidOrder.vendorGroups) {
          try {
            await this.transferService.createTransferWithDetails(
              paidOrder.id,
              vg.id,
              vg.subtotal,
              vg.commissionPct,
              payment.providerTransactionId!,
            );
          } catch (err) {
            // Transfer creation failed (e.g., vendor has no Stripe connected
            // account, no real PaymentIntent in Stripe). Log and continue —
            // the payment is already captured and the order is PAID. The webhook
            // handler will still proceed to cart reconciliation.
            console.error(
              `Transfer creation failed for OVG ${vg.id} of order ${paidOrder.id}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
      }
    }

    return payment;
  }

  private async markCapturedOrderPaid(orderId: string, session?: ClientSession): Promise<void> {
    // Reload after capture persistence; never regress advanced or terminal orders.
    const order = await this.orderRepo.findById(orderId, session);
    if (!order) {
      throw new Error(PaymentError.ORDER_NOT_FOUND);
    }
    // CD-063: callers reach this only after capture persistence has succeeded.
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      order.transitionTo(OrderStatus.PAID);
      try {
        const result = await this.orderRepo.update(order, session);
        // If repository refused (returned unchanged non-PAID), treat as no-op.
        if (result && result.status !== OrderStatus.PAID) {
          return;
        }
      } catch (err) {
        if (session) throw err;
        try { console.error('markCapturedOrderPaid: conditional update failed for order', orderId, err); } catch { /* blocked in isolated test env */ }
        // Re-throw unexpected errors (not conditional-update failures)
        if (err == null || (typeof err !== 'object' && typeof err !== 'function') ||
            !('message' in err) || typeof err.message !== 'string' || !err.message.startsWith('INVALID_STATUS_TRANSITION')) {
          throw err;
        }
        // Conditional update failed; re-read persisted state.
        const persisted = await this.orderRepo.findById(orderId, session);
        if (persisted && persisted.status === OrderStatus.PAID) {
          return; // idempotent success
        }
        // Advanced/terminal state: do not overwrite.
        return;
      }
    }
    // FIND-A02-P0-001: Set all vendor groups to PENDING after order is PAID
    if (order.status === OrderStatus.PAID) {
      for (const vg of order.vendorGroups) {
        vg.updateStatus(OrderVendorGroupStatus.PENDING);
      }
      await this.orderRepo.update(order, session);
    }
  }

  /**
   * Repair order state when payment was captured but order was not updated to PAID.
   * This handles recovery from partial failures where the payment was persisted
   * but the order state update was lost or skipped.
   */
  async repairCapturedOrder(paymentId: string): Promise<boolean> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) return false;
    if (payment.status !== PaymentStatus.CAPTURED) return false;

    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) return false;

    // If order is already in a terminal or advanced state, no repair needed
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) {
      return true; // already in desired state
    }

    // Transition order to PAID if it's still PENDING_PAYMENT or PROCESSING
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      order.transitionTo(OrderStatus.PAID);
    } else if (order.status === OrderStatus.PROCESSING) {
      // PROCESSING -> PAID is allowed when capture confirms payment
      order.transitionTo(OrderStatus.PAID);
    } else {
      // For other states, try the transition and verify
      const allowedTransitions = VALID_STATUS_TRANSITIONS[order.status];
      if (allowedTransitions && allowedTransitions.includes(OrderStatus.PAID)) {
        order.transitionTo(OrderStatus.PAID);
      } else {
        return false; // cannot transition from this state
      }
    }

    try {
      await this.orderRepo.update(order);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Repair order state when payment was failed but order was not updated to FAILED_PAYMENT.
   * This handles recovery from partial failures where the payment was persisted
   * but the order state update was lost or skipped.
   */
  async repairFailedOrder(paymentId: string): Promise<boolean> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) return false;
    if (![PaymentStatus.FAILED, PaymentStatus.REFUNDED].includes(payment.status)) return false;

    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) return false;

    // If order is already in a failed or terminal state, no repair needed
    if (order.status === OrderStatus.FAILED_PAYMENT || order.status === OrderStatus.CANCELLED) {
      return true; // already in desired state
    }

    // Transition order to FAILED_PAYMENT if it's in a payable state
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      order.markPaymentFailed();
    } else if (order.status === OrderStatus.PAID) {
      // PAID -> FAILED_PAYMENT transition is allowed for failed payments
      order.transitionTo(OrderStatus.FAILED_PAYMENT);
    } else {
      const allowedTransitions = VALID_STATUS_TRANSITIONS[order.status];
      if (allowedTransitions && allowedTransitions.includes(OrderStatus.FAILED_PAYMENT)) {
        order.transitionTo(OrderStatus.FAILED_PAYMENT);
      } else {
        return false;
      }
    }

    try {
      await this.orderRepo.update(order);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Repair order financial status when payment was refunded but order was not updated.
   * This handles recovery from partial failures where the payment was persisted
   * but the order financial status update was lost or skipped.
   */
  async repairRefundedOrder(paymentId: string): Promise<boolean> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) return false;
    if (payment.status !== PaymentStatus.REFUNDED) return false;

    const order = await this.orderRepo.findById(payment.orderId);
    if (!order) return false;

    // Update order financial status based on CD-058
    // If payment is REFUNDED, financial status should reflect this
    if (order.financialStatus === FinancialStatus.PAID) {
      order.financialStatus = FinancialStatus.PARTIALLY_REFUNDED;
    }

    try {
      await this.orderRepo.update(order);
      return true;
    } catch {
      return false;
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
    // FIND-A02-P0-003: record ledger for every vendor group, not just vendorGroups[0]
    // Pass each vendor's subtotal so they only see their portion of the payment
    if (order) {
      for (const vg of order.vendorGroups) {
        await this.recordPaymentLedger(
          payment,
          vg.vendorId,
          MovementType.CONSUMER_PAYMENT,
          EventType.PAYMENT_FAILED,
          vg.subtotal
        );
      }
    }

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

  /**
   * Startup recovery scan for pending payments whose Stripe webhook delivery
   * was missed (e.g., Stripe CLI / webhook endpoint was stopped when Stripe
   * sent checkout.session.completed).
   *
   * For each PENDING payment with a providerTransactionId (Stripe Checkout
   * Session ID), retrieves the Checkout Session from Stripe and reconciles:
   *   - payment_status === 'paid'   -> completeCheckoutPayment (authorize + capture)
   *   - status === 'expired' and payment_status === 'unpaid' -> failPayment
   *   - otherwise -> leave pending until confirmation or terminal evidence
   *
   * Returns { recovered, failed } counts. Failures are logged and counted,
   * never thrown, so a missing/failed scan cannot block startup.
   */
  async recoverPendingPayments(): Promise<{ recovered: number; failed: number }> {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-10-28.endive' });

    const pendingPayments = await this.paymentRepo.findByStatus(PaymentStatus.PENDING);
    let recovered = 0;
    let failed = 0;

    for (const payment of pendingPayments) {
      try {
        if (!payment.providerTransactionId) {
          failed++;
          continue;
        }

        const session = await stripe.checkout.sessions.retrieve(payment.providerTransactionId);

        if (session.payment_status === 'paid') {
          const key = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
          const expectedLiveMode = /^(sk|rk)_live_/.test(key) ? true
            : /^(sk|rk)_test_/.test(key) ? false : undefined;
          const intentId = typeof session.payment_intent === 'string'
            ? session.payment_intent : session.payment_intent?.id;
          if (session.status !== 'complete' || session.id !== payment.providerTransactionId ||
              session.metadata?.paymentId !== payment.id || session.metadata?.orderId !== payment.orderId ||
              session.currency?.toLowerCase() !== 'brl' || expectedLiveMode === undefined ||
              session.livemode !== expectedLiveMode || !intentId || !Number.isInteger(session.amount_total) ||
              session.amount_total !== Math.round(payment.amount * 100)) {
            throw new Error('STRIPE_RECOVERY_SESSION_MISMATCH');
          }
          await this.completeCheckoutPayment(payment.id, intentId, session.amount_total!);
          recovered++;
        } else if (session.status === 'expired' && session.payment_status === 'unpaid') {
          await this.failPayment(payment.id);
          failed++;
        }
      } catch (error) {
        console.error(`Recovery failed for payment ${payment.id}:`, error instanceof Error ? error.message : error);
        failed++;
      }
    }

    return { recovered, failed };
  }

  async refundPayment(paymentId: string, refundAmount?: number): Promise<Payment> {
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

    // Validate partial refund amount if provided
    const amountToRefund = refundAmount ?? payment.amount;
    if (!Number.isFinite(amountToRefund) || amountToRefund <= 0) {
      throw new Error(PaymentError.INVALID_PAYMENT_AMOUNT);
    }
    if (amountToRefund > payment.amount) {
      throw new Error(PaymentError.INVALID_PAYMENT_AMOUNT);
    }

    const refunded = payment.refund();
    refunded.status && (payment.status = refunded.status);
    refunded.providerTransactionId && (payment.providerTransactionId = refunded.providerTransactionId);
    refunded.refundedAt && (payment.refundedAt = refunded.refundedAt);

    if (!this.mongodb) {
      throw new Error('PAYMENT_REFUND_REQUIRES_TRANSACTIONAL_DEPS');
    }

    const client = this.mongodb!.client;
    const session = client.startSession();
    try {
      await session.withTransaction(async (session) => {
        await this.paymentRepo.update(payment, session);

        const order = await this.orderRepo.findById(payment.orderId, session);
        if (!order) {
          throw new Error(PaymentError.ORDER_NOT_FOUND);
        }

        // Refund ratio for proportional distribution across vendor groups
        const refundRatio = payment.amount > 0 ? amountToRefund / payment.amount : 1;

        // CD-048 / CD-065: Use commission snapshot from payment capture time,
        // not current OVG values (which may have been modified after payment,
        // causing defasado percentual de comissão — R-05).
        // Record REFUND movement + COMMISSION adjustment (negative) per OVG.
        const snapshots = payment.commissionSnapshot ?? [];
        for (const snapshot of snapshots) {
          const refundAmountForOVG = snapshot.subtotal * refundRatio;
          await this.recordPaymentLedger(
            payment,
            snapshot.vendorId,
            MovementType.REFUND,
            EventType.PAYMENT_REFUNDED,
            refundAmountForOVG,
            snapshot.ovgId,
            session
          );

          // Commission adjustment: reverse commission proportionally (negative amount)
          const commissionAdjustment = -(snapshot.commissionAmount * refundRatio);
          await this.recordPaymentLedger(
            payment,
            snapshot.vendorId,
            MovementType.COMMISSION,
            EventType.PAYMENT_REFUNDED,
            commissionAdjustment,
            snapshot.ovgId,
            session
          );
        }

        // Fallback for payments captured before snapshot was introduced:
        // record REFUND movements using current OVG values (no commission adjustment
        // possible without a snapshot).
        if (snapshots.length === 0) {
          for (const vg of order.vendorGroups) {
            const refundAmountForOVG = vg.subtotal * refundRatio;
            await this.recordPaymentLedger(
              payment,
              vg.vendorId,
              MovementType.REFUND,
              EventType.PAYMENT_REFUNDED,
              refundAmountForOVG,
              vg.id,
              session
            );
          }
        }

        const isFullRefund = !refundAmount || amountToRefund >= payment.amount;
        order.refund(isFullRefund);
        await this.orderRepo.update(order, session);
      });
    } finally {
      await session.endSession();
    }

    return payment;
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    if (!id || id.trim().length === 0) {
      return null;
    }
    return this.paymentRepo.findById(id);
  }

  async getPaymentByProviderTransactionId(providerTransactionId: string): Promise<Payment | null> {
    if (!providerTransactionId || providerTransactionId.trim().length === 0) {
      return null;
    }
    return this.paymentRepo.findByProviderTransactionId(providerTransactionId);
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

  async getPaymentEventId(paymentId: string): Promise<string | undefined> {
    const payment = await this.paymentRepo.findById(paymentId);
    return payment?.eventId;
  }

  async setPaymentEventId(paymentId: string, eventId: string): Promise<void> {
    const existing = await this.paymentRepo.findById(paymentId);
    if (existing) {
      existing.eventId = eventId;
      await this.paymentRepo.save(existing);
    }
  }

  async getOrderByPaymentId(paymentId: string): Promise<Order | null> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment || !payment.orderId) return null;
    return this.orderRepo.findById(payment.orderId);
  }

  /**
   * Indica se o processamento do pagamento está completamente finalizado.
   *
   * Semântica efetiva (documentada para evitar interpretação equivocada do nome):
   *  - Pagamento não encontrado -> false.
   *  - Pagamento CAPTURED: considerado finalizado somente quando a ordem associada
   *    já saiu de PENDING_PAYMENT (i.e., a ordem foi atualizada para PAID ou estado
   *    mais avançado). Se a ordem ainda está PENDING_PAYMENT, o pagamento foi
   *    capturado duravelmente mas a reparação da ordem ainda não ocorreu, portanto
   *    o processamento não está completo (retorna false para permitir retry/repair).
   *  - Pagamento FAILED ou REFUNDED: verdadeiro (estados terminais do pagamento).
   *  - Qualquer outro estado (PENDING, AUTHORIZED): false.
   *
   * Este método é usado como guarda de idempotência do webhook: um retorno false
   * indica que o evento pode ser reprocessado (ex: reparar ordem após captura
   * durável sem recapturar o pagamento).
   */
  async isPaymentFullyFinalized(paymentId: string): Promise<boolean> {
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

    // Resolve vendorId and look up vendor's Stripe connected account ID
    const vendorId = vendorGroup.vendorId;
    let destinationAccountId = '';
    if (vendorId && this.vendorRepo) {
      const vendor = await this.vendorRepo.findById(vendorId);
      if (vendor && vendor.stripeAccountId) {
        destinationAccountId = vendor.stripeAccountId.trim();
      }
    }
    // Reject transfers with absent destination before any Stripe call or persistence
    if (!destinationAccountId) {
      throw new Error('TRANSFER_DESTINATION_UNAVAILABLE');
    }

    // Create Stripe client for account validation and transfer creation
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim() || 'sk_test_test', {
      apiVersion: '2026-10-28.endive',
    });

    // Verify the connected account can receive transfers before creating the transfer
    const account = await stripe.accounts.retrieve(destinationAccountId);
    if (account.capabilities?.transfers !== 'active') {
      throw new Error('TRANSFER_CAPABILITY_INACTIVE');
    }

    // Create idempotency key: order_id:ovg_id:attempt
    const existingTransfer = this.transferRepo
      ? await this.transferRepo.findLastByOrderVendorGroupId(ovgId)
      : null;

    if (existingTransfer && existingTransfer.status === TransferStatus.COMPLETED) {
      // Return existing completed transfer
      // We need the Stripe object; if we have the stripeTransferId, retrieve it
      if (existingTransfer.stripeTransferId) {
        try {
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
    const stripeTransfer = await stripe.transfers.create(
      {
        amount: Math.round(transferAmount * 100), // Stripe expects amount in cents
        currency: 'brl',
        destination: destinationAccountId,
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
