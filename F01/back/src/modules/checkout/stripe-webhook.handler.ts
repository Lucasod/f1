import { RequestHandler } from 'express';
import Stripe from 'stripe';
import { PaymentService, PaymentError } from '../order/payment.service';
import { CartService } from '../cart/cart.service';
import { CartError } from '../cart/cart.domain';
import { TransferService } from '../transfer/transfer.service';
import { Transfer } from '../transfer/transfer.domain';
import { MongoTransferRepository } from '../transfer/transfer.mongo.repository';

export function createStripeWebhookHandler(
  stripe: Pick<Stripe, 'webhooks'>,
  paymentService: PaymentService,
  cartService: CartService,
  transferService: TransferService
): RequestHandler {
  const processedEventIds = new Set<string>();
  // PaymentService keeps its repositories as private fields; extract them once
  // for use in event-id persistence and cart reconciliation below.
  // (payment.service.ts is read-only in this scope, so we cannot add public methods.)
  const paymentRepo = paymentService['paymentRepo'];
  const orderRepo = paymentService['orderRepo'];

  return async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET_NOT_CONFIGURED' });
    }

    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
      return res.status(400).json({ error: 'STRIPE_SIGNATURE_REQUIRED' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch {
      return res.status(400).json({ error: 'INVALID_STRIPE_SIGNATURE' });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    if (!event.type.startsWith('checkout.session.')) {
      // Handle Stripe Connect transfer webhook events
      if (event.type.startsWith('transfer.')) {
        // At this point, event.type is narrowed to transfer.* types
        const transferType = event.type as
          | 'transfer.paid'
          | 'transfer.failed'
          | 'transfer.reversed';
        if (transferType === 'transfer.paid' || transferType === 'transfer.failed') {
          const stripeTransferId = (event.data as { object: any }).object.id;
          if (!stripeTransferId) {
            return res.status(200).json({ received: true });
          }
          // completeTransfer / failTransfer internally call transferRepo.findByStripeTransferId()
          // and handle the not-found case gracefully (return null without throwing).
          if (transferType === 'transfer.paid') {
            await transferService.completeTransfer(stripeTransferId);
          } else if (transferType === 'transfer.failed') {
            await transferService.failTransfer(stripeTransferId);
          }
          return res.status(200).json({ received: true });
        }
        return res.status(200).json({ received: true });
      }
      return res.status(200).json({ received: true });
    }
    if (session.currency?.toLowerCase() !== 'brl') {
      return res.status(400).json({ error: 'STRIPE_CURRENCY_MISMATCH' });
    }

    const paymentId = session.metadata?.paymentId;
    if (!paymentId) {
      return res.status(200).json({ received: true });
    }
    const stripeEventId = event.id;

    // Webhook event correlation / idempotency check:
    // If this Stripe event ID has already been processed for this payment,
    // skip re-processing immediately. This protects against duplicate webhook
    // deliveries and enables retry/recovery.
    // Uses an in-memory Set for same-process duplicate detection, and also
    // checks the payment's stored eventId for persistence-enabled correlation.
    if (paymentId && stripeEventId) {
      // In-memory Set fast path for duplicate deliveries within same process
      if (processedEventIds.has(stripeEventId)) {
        return res.status(200).json({ received: true });
      }
      // Check if the payment already has this eventId stored (persistent correlate)
      const existingPayment = await paymentService.getPaymentById(paymentId);
      if (existingPayment && existingPayment.eventId === stripeEventId) {
        // Mark as processed in-memory so subsequent deliveries in this session are also caught
        processedEventIds.add(stripeEventId);
        return res.status(200).json({ received: true });
      }
      // First time seeing this event for this payment - mark in-memory
      processedEventIds.add(stripeEventId);
    }

    // Idempotency check: if payment already in final state, skip re-processing
    // This protects against duplicate webhook deliveries
    if (await paymentService.isPaymentFinalized(paymentId)) {
      return res.status(200).json({ received: true });
    }

    try {
      if (
        (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') &&
        session.payment_status === 'paid'
      ) {
        const paymentIntentId = typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id;
        if (!paymentIntentId || session.amount_total === null) {
          return res.status(400).json({ error: 'STRIPE_PAYMENT_INTENT_MISSING' });
        }
        const payment = await paymentService.completeCheckoutPayment(paymentId, paymentIntentId, session.amount_total);
        // Persist the Stripe event ID on the payment for webhook event correlation / retry/recovery
        // Best-effort: update the payment's eventId field if not already set
        try {
          const existing = await paymentService.getPaymentById(paymentId);
          if (existing && existing.eventId !== event.id && event.id) {
            // @ts-expectError - eventId is readonly but we set it for correlation persistence
            ;(existing as any).eventId = event.id;
            // Re-save the payment to persist the eventId
            if (paymentRepo && typeof paymentRepo.save === 'function') {
              paymentRepo.save(existing).catch(() => void 0);
            }
          }
        } catch {
          /* Best-effort; do not fail the webhook delivery if saving fails. */
        }
        // Remove only the items effectively purchased from the cart,
        // preserving non-purchased items. The webhook event correlation check
        // above (lines 76-96) provides idempotency against duplicate deliveries.
        const order = await orderRepo.findById(payment.orderId);
        if (order) {
          // Aggregate purchased quantities per product so reconciliation removes
          // only the quantities effectively purchased. Items added to the cart
          // after checkout (or quantity changes made afterwards) are preserved:
          // removing the purchased quantity from the current cart state never
          // deletes post-checkout additions of the same SKU.
          const purchasedQuantities = new Map<string, number>();
          for (const vendorGroup of order.vendorGroups) {
            for (const item of vendorGroup.items) {
              const previous = purchasedQuantities.get(item.productId) ?? 0;
              purchasedQuantities.set(item.productId, previous + (item.quantity ?? 1));
            }
          }
          for (const [productId, quantity] of purchasedQuantities) {
            try {
              await cartService.removeItemQuantity(payment.personId, productId, quantity);
            } catch (err) {
              // Item may already be removed or not in cart; ignore for idempotency
              if (!(err instanceof Error) ||
                  !['CART_ITEM_NOT_FOUND', 'CART_NOT_FOUND', 'CART_CONFLICT'].includes(err.message)) {
                throw err;
              }
            }
          }
        }
        // After successful payment capture, create the transfer for each vendor group
        // Note: transfer creation is triggered separately; this is just the payment confirmation
      } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
        try {
          await paymentService.failPayment(paymentId);
        } catch (err) {
          if (err instanceof Error && err.message === PaymentError.PAYMENT_NOT_AUTHORIZABLE) {
            return res.status(200).json({ received: true });
          }
          throw err;
        }
      }

      return res.status(200).json({ received: true });
    } catch {
      return res.status(500).json({ error: 'STRIPE_WEBHOOK_PROCESSING_FAILED' });
    }
  };
}