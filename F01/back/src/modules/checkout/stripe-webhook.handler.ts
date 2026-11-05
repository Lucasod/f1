import { RequestHandler } from 'express';
import Stripe from 'stripe';
import { PaymentService, PaymentError } from '../order/payment.service';
import { CartService } from '../cart/cart.service';
import { TransferService } from '../transfer/transfer.service';
import { MongoTransferRepository } from '../transfer/transfer.mongo.repository';

export function createStripeWebhookHandler(
  stripe: Pick<Stripe, 'webhooks'>,
  paymentService: PaymentService,
  cartService: CartService,
  transferService: TransferService
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

    const session = event.data.object as Stripe.Checkout.Session;
    if (!event.type.startsWith('checkout.session.')) {
      // Handle Stripe Connect transfer webhook events
      if (event.type === 'transfer.paid' || event.type === 'transfer.failed') {
        const stripeTransferId = event.data.object.id;
        if (!stripeTransferId) {
          return res.status(200).json({ received: true });
        }
        // Look up the corresponding Transfer by stripeTransferId
        const transfer = await transferService.findByStripeTransferId(stripeTransferId);
        // Update transfer status if found; if not found, log and continue
        // (webhook may arrive before DB entry is created or in edge cases)
        if (transfer) {
          if (event.type === 'transfer.paid') {
            await transferService.completeTransfer(stripeTransferId);
          } else if (event.type === 'transfer.failed') {
            await transferService.failTransfer(stripeTransferId);
          }
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
        // Clear cart only after effective payment confirmation (CAPTURED)
        cartService.clearCart(payment.personId);
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
