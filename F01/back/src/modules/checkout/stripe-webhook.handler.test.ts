import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { Request, Response } from 'express';
import { PaymentService, PaymentError } from '../order/payment.service';
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
    // Mock completeCheckoutPayment to return a Payment object with personId
    const mockPayment = { id: 'payment-1', personId: 'consumer-1', status: 'pending', orderId: 'order-1', amount: 10000, provider: 'stripe' };
    const completeCheckoutPayment = vi.fn().mockResolvedValue(mockPayment as any);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { completeCheckoutPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false), orderRepo: { findById: vi.fn().mockResolvedValue({ vendorGroups: [] }) } } as unknown as PaymentService,
      { clearCart: vi.fn(), removeItem: vi.fn() } as any,
      { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(constructEvent).toHaveBeenCalledWith(req.body, 'sig_test', 'whsec_test');
    expect(completeCheckoutPayment).toHaveBeenCalledWith('payment-1', 'pi_test_1', 10000);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('handles transfer.paid webhook event', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'transfer.paid',
      data: { object: {
        id: 'trs_test_transfer_id',
        amount: 5000,
        currency: 'brl',
        status: 'paid',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      {} as PaymentService,
      {} as any,
      { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(constructEvent).toHaveBeenCalledWith(req.body, 'sig_test', 'whsec_test');
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
      { failPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false) } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 200 on duplicate webhook delivery without re-processing', async () => {
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
    const mockPayment = { id: 'payment-1', personId: 'consumer-1', status: 'pending', orderId: 'order-1', amount: 10000, provider: 'stripe' };
    const isPaymentFinalized = vi.fn();
    isPaymentFinalized.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const completeCheckoutPayment = vi.fn().mockResolvedValue(mockPayment as any);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { completeCheckoutPayment, isPaymentFinalized, orderRepo: { findById: vi.fn().mockResolvedValue({ vendorGroups: [] }) } } as unknown as PaymentService,
      { clearCart: vi.fn(), removeItem: vi.fn() } as any,
      { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res1, vi.fn());
    await handler(req, res2, vi.fn());

    // First call processes the payment; second call is a duplicate delivery
    // and returns 200 OK immediately without re-processing since payment is now in final state
    expect(completeCheckoutPayment).toHaveBeenCalledTimes(1);
    expect(res1.status).toHaveBeenCalledWith(200);
    expect(res2.status).toHaveBeenCalledWith(200);
  });

  it('returns 200 { received: true } on out-of-order expired event when failPayment throws PAYMENT_NOT_AUTHORIZABLE', async () => {
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
      { failPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false) } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('calls failPayment and returns 200 for async_payment_failed event', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'checkout.session.async_payment_failed',
      data: { object: {
        metadata: { paymentId: 'payment-1' },
        payment_status: 'unpaid',
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const failPayment = vi.fn().mockResolvedValue(undefined);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { failPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false) } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(failPayment).toHaveBeenCalledWith('payment-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('returns 500 STRIPE_WEBHOOK_PROCESSING_FAILED when completeCheckoutPayment throws PAYMENT_AMOUNT_MISMATCH', async () => {
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
    const completeCheckoutPayment = vi.fn().mockRejectedValue(new Error('PAYMENT_AMOUNT_MISMATCH'));
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { completeCheckoutPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false) } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'STRIPE_WEBHOOK_PROCESSING_FAILED' });
  });

  it('returns 200 { received: true } without processing when metadata.paymentId is missing', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'checkout.session.completed',
      data: { object: {
        payment_status: 'paid',
        payment_intent: 'pi_test_1',
        amount_total: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const completeCheckoutPayment = vi.fn().mockResolvedValue(undefined);
    const failPayment = vi.fn().mockResolvedValue(undefined);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { completeCheckoutPayment, failPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false) } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(completeCheckoutPayment).not.toHaveBeenCalled();
    expect(failPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('returns 200 { received: true } and ignores non-checkout events', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: {
        metadata: { paymentId: 'payment-1' },
        currency: undefined,
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const completeCheckoutPayment = vi.fn().mockResolvedValue(undefined);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { completeCheckoutPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false) } as unknown as PaymentService
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());

    expect(constructEvent).toHaveBeenCalledWith(req.body, 'sig_test', 'whsec_test');
    expect(completeCheckoutPayment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});
