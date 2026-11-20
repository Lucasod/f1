import { RequestHandler } from 'express';
import Stripe from 'stripe';
import { PaymentService, PaymentError } from '../order/payment.service';
import { CartService } from '../cart/cart.service';
import { CartError } from '../cart/cart.domain';
import { TransferService } from '../transfer/transfer.service';
import { Transfer } from '../transfer/transfer.domain';
import { MongoTransferRepository } from '../transfer/transfer.mongo.repository';
import { PaymentStatus } from '../order/order.domain';
import { PayoutService } from '../payout/payout.service';
import { PayoutStatus } from '../payout/payout.domain';

export function createStripeWebhookHandler(
  stripe: Pick<Stripe, 'webhooks'>,
  paymentService: PaymentService,
  cartService: CartService,
  transferService: TransferService,
  payoutService: PayoutService
): RequestHandler {
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

    const stripeEventId = event.id;

    // Handle Stripe Connect transfer webhook events
    if (event.type.startsWith('transfer.')) {
      // At this point, event.type is narrowed to transfer.* types
      const transferType = event.type as
        | 'transfer.paid'
        | 'transfer.failed'
        | 'transfer.reversed';
      const stripeTransferId = (event.data as { object: any }).object.id;
      if (!stripeTransferId) {
        return res.status(200).json({ received: true });
      }
      // Look up the transfer entity for traceability and idempotent handling.
      const entity = await transferService.findByStripeTransferId(stripeTransferId);
      if (!entity) {
        return res.status(200).json({ received: true });
      }

      if (transferType === 'transfer.paid') {
        // completeTransfer internally handles idempotency (no-op if already COMPLETED)
        await transferService.completeTransfer(stripeTransferId);
        // Create Payout linked to the transfer, populating payout.reference with the transfer id.
        // createPayoutFromTransfer is idempotent: returns existing payout if reference already present.
        try {
          await payoutService.createPayoutFromTransfer(
            entity.id,
            entity.amount,
            entity.orderId,
            entity.orderVendorGroupId,
          );
        } catch {
          // Payout creation failure is not fatal: Stripe will redeliver the webhook.
          // createPayoutFromTransfer is idempotent via payout.reference, so redelivery is safe.
          return res.status(500).json({ error: 'PAYOUT_CREATION_FAILED' });
        }
      } else if (transferType === 'transfer.failed') {
        await transferService.failTransfer(stripeTransferId);
      } else if (transferType === 'transfer.reversed') {
        await transferService.reverseTransfer(stripeTransferId);
        // Cancel any payout linked to this transfer that is still cancellable
        const linkedPayouts = await payoutService.findPayoutsByReference(entity.id);
        for (const payout of linkedPayouts) {
          if (payout.status === PayoutStatus.PENDING || payout.status === PayoutStatus.APPROVED) {
            try {
              await payoutService.cancelPayout(payout.id, 'system', true);
            } catch {
              // Best-effort: payout may have already been processed or cancelled
            }
          }
        }
      }
      return res.status(200).json({ received: true });
    }

    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const succeeded = event.type === 'payment_intent.succeeded';
      if (!intent.id) {
        return res.status(200).json({ received: true });
      }

      try {
        let payment = await paymentService.getPaymentByProviderTransactionId(intent.id);
        // Checkout can deliver the successful intent before its session event.
        // A failed, unbound intent may still be retried within the Checkout session.
        if (!payment && succeeded && intent.metadata?.paymentId && intent.metadata.orderId) {
          const candidate = await paymentService.getPaymentById(intent.metadata.paymentId);
          if (candidate?.provider === 'stripe' && candidate.orderId === intent.metadata.orderId &&
              (!candidate.providerTransactionId || candidate.providerTransactionId.startsWith('cs_'))) {
            payment = candidate;
          }
        }
        if (!payment || payment.status === PaymentStatus.FAILED || payment.status === PaymentStatus.REFUNDED ||
            (payment.status === PaymentStatus.CAPTURED &&
              (!succeeded || await paymentService.isPaymentFullyFinalized(payment.id)))) {
          return res.status(200).json({ received: true });
        }

        if (succeeded) {
          if (intent.currency?.toLowerCase() !== 'brl') {
            return res.status(400).json({ error: 'STRIPE_CURRENCY_MISMATCH' });
          }
          if (!Number.isInteger(intent.amount)) {
            return res.status(400).json({ error: 'STRIPE_PAYMENT_INTENT_AMOUNT_INVALID' });
          }
          await paymentService.completeCheckoutPayment(payment.id, intent.id, intent.amount);
        } else {
          await paymentService.failPayment(payment.id);
        }
        if (stripeEventId) {
          await paymentService.setPaymentEventId(payment.id, stripeEventId);
        }
        return res.status(200).json({ received: true });
      } catch (err) {
        if (err instanceof Error && err.message === PaymentError.PAYMENT_NOT_AUTHORIZABLE) {
          return res.status(200).json({ received: true });
        }
        return res.status(500).json({ error: 'STRIPE_WEBHOOK_PROCESSING_FAILED' });
      }
    }

    if (!event.type.startsWith('checkout.session.')) {
      return res.status(200).json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    if (session.currency?.toLowerCase() !== 'brl') {
      return res.status(400).json({ error: 'STRIPE_CURRENCY_MISMATCH' });
    }

    const paymentId = session.metadata?.paymentId;
    if (!paymentId) {
      return res.status(200).json({ received: true });
    }

    // Webhook event correlation / idempotency check:
    try {
      if (stripeEventId) {
        const existing = await paymentService.getPaymentById(paymentId);
        if (existing?.eventId === stripeEventId) {
          return res.status(200).json({ received: true });
        }
      }

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
        // Remove only the items effectively purchased from the cart,
        // preserving non-purchased items.
        const order = await paymentService.getOrderByPaymentId(paymentId);
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
            } catch {
              // Cart reconciliation is best-effort idempotency:
              // item may already be removed or not in cart; ignore all errors.
              // The order is already paid (line 103 succeeded); a cart error
              // must not cause a webhook 500.
            }
          }
        }
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

      if (stripeEventId) {
        await paymentService.setPaymentEventId(paymentId, stripeEventId);
      }
      return res.status(200).json({ received: true });
    } catch {
      return res.status(500).json({ error: 'STRIPE_WEBHOOK_PROCESSING_FAILED' });
    }
  };
}