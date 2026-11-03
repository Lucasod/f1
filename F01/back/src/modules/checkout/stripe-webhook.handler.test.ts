import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { Request, Response } from 'express';
import { PaymentService } from '../order/payment.service';
import { createStripeWebhookHandler } from './stripe-webhook.handler';

describe('Stripe webhook handler', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('verifies the signature and confirms paid Checkout sessions', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'checkout.session.completed',
      data: { object: {
        metadata: { paymentId: 'payment-1' },
        payment_status: 'paid',
        payment_intent: 'pi_test_1',
        amount_total: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const completeCheckoutPayment = vi.fn().mockResolvedValue(undefined);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { completeCheckoutPayment } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(constructEvent).toHaveBeenCalledWith(req.body, 'sig_test', 'whsec_test');
    expect(completeCheckoutPayment).toHaveBeenCalledWith('payment-1', 'pi_test_1', 10000);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects an invalid webhook signature', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const constructEvent = vi.fn(() => { throw new Error('invalid signature'); });
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      {} as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'bad' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 on currency mismatch', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'checkout.session.expired',
      data: { object: {
        metadata: { paymentId: 'payment-1' },
        currency: 'usd',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const failPayment = vi.fn().mockResolvedValue(undefined);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { failPayment } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'STRIPE_CURRENCY_MISMATCH' });
    expect(failPayment).not.toHaveBeenCalled();
  });

  it('returns 200 when failPayment throws PAYMENT_NOT_AUTHORIZABLE', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'checkout.session.expired',
      data: { object: {
        metadata: { paymentId: 'payment-1' },
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const failPayment = vi.fn().mockRejectedValue(new Error('PAYMENT_NOT_AUTHORIZABLE'));
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { failPayment } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
