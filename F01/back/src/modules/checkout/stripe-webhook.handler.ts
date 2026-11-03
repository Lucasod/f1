import { RequestHandler } from 'express';
import Stripe from 'stripe';
import { PaymentService, PaymentError } from '../order/payment.service';

export function createStripeWebhookHandler(
  stripe: Pick<Stripe, 'webhooks'>,
  paymentService: PaymentService
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
    if (session.currency?.toLowerCase() !== 'brl') {
      return res.status(400).json({ error: 'STRIPE_CURRENCY_MISMATCH' });
    }

    const paymentId = session.metadata?.paymentId;
    if (!paymentId) {
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
        await paymentService.completeCheckoutPayment(paymentId, paymentIntentId, session.amount_total);
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
