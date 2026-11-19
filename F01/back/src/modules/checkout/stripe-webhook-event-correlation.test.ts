import { afterEach, describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';
import type { Request, Response } from 'express';
import { createStripeWebhookHandler } from './stripe-webhook.handler';
import { PaymentService, PaymentError } from '../order/payment.service';

describe('Stripe webhook event correlation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('correlates webhook event to payment and is idempotent on duplicate delivery via event ID', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'checkout.session.completed',
      id: 'evt_123456789_stripe_event_id',
      data: { object: {
        metadata: { paymentId: 'payment-1' },
        payment_status: 'paid',
        payment_intent: 'pi_test_1',
        amount_total: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    // Mock payments: first call to findById returns payment without eventId,
    // subsequent calls return payment with eventId set (simulating prior processing)
    const mockPaymentWithoutEventId = { 
      id: 'payment-1', 
      personId: 'consumer-1', 
      status: 'pending', 
      orderId: 'order-1', 
      amount: 10000, 
      provider: 'stripe',
      eventId: undefined
    };
    const mockPaymentWithEventId = { 
      id: 'payment-1', 
      personId: 'consumer-1', 
      status: 'pending', 
      orderId: 'order-1', 
      amount: 10000, 
      provider: 'stripe',
      eventId: 'evt_123456789_stripe_event_id'
    };
    const findById = vi.fn()
      .mockResolvedValueOnce(mockPaymentWithoutEventId) // First call: no eventId yet
      .mockResolvedValue(mockPaymentWithEventId); // Subsequent calls: eventId already set
    const getPaymentById = vi.fn()
      .mockResolvedValueOnce(mockPaymentWithoutEventId) // First call: no eventId yet
      .mockResolvedValue(mockPaymentWithEventId); // Subsequent calls: eventId already set
    const completeCheckoutPayment = vi.fn().mockResolvedValue(mockPaymentWithEventId as any);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { findById, getPaymentById, isPaymentFinalized: vi.fn().mockResolvedValue(false), completeCheckoutPayment, getPaymentEventId: vi.fn().mockResolvedValue(null), setPaymentEventId: vi.fn().mockResolvedValue(undefined), getOrderByPaymentId: vi.fn().mockResolvedValue({ vendorGroups: [] }), orderRepo: { findById: vi.fn().mockResolvedValue({ vendorGroups: [] }) } } as unknown as PaymentService,
      { clearCart: vi.fn(), removeItem: vi.fn() } as any
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    // First delivery processes the webhook (payment has no eventId yet)
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);

    // Second delivery with same event ID - should be idempotent
    // The payment now has eventId set from findById's second return value,
    // so the handler should detect the duplicate and skip re-processing
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    await handler(req, res2, vi.fn());

    // Should only process once; second call should detect duplicate event ID
    // and return 200 without re-calling completeCheckoutPayment
    expect(res2.status).toHaveBeenCalledWith(200);
    // CRITICAL: completeCheckoutPayment should ONLY be called once total
    expect(completeCheckoutPayment).toHaveBeenCalledTimes(1);
  });

  it('processes a new webhook event when event ID has not been seen before', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = {
      type: 'checkout.session.completed',
      id: 'evt_new_event_id_999',
      data: { object: {
        metadata: { paymentId: 'payment-2' },
        payment_status: 'paid',
        payment_intent: 'pi_test_2',
        amount_total: 20000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const mockPaymentNew = { 
      id: 'payment-2', 
      personId: 'consumer-2', 
      status: 'pending', 
      orderId: 'order-2', 
      amount: 20000, 
      provider: 'stripe',
      eventId: undefined
    };
    const findById = vi.fn().mockResolvedValue(mockPaymentNew);
    const getPaymentById = vi.fn().mockResolvedValue(mockPaymentNew);
    const completeCheckoutPayment = vi.fn().mockResolvedValue(mockPaymentNew as any);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { findById, getPaymentById, isPaymentFinalized: vi.fn().mockResolvedValue(false), completeCheckoutPayment, getPaymentEventId: vi.fn().mockResolvedValue(null), setPaymentEventId: vi.fn().mockResolvedValue(undefined), getOrderByPaymentId: vi.fn().mockResolvedValue({ vendorGroups: [] }), orderRepo: { findById: vi.fn().mockResolvedValue({ vendorGroups: [] }) } } as unknown as PaymentService,
      { clearCart: vi.fn(), removeItem: vi.fn() } as any
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    // completeCheckoutPayment should have been called once for this new event
    expect(completeCheckoutPayment).toHaveBeenCalledTimes(1);
  });
  it('retries the same event after payment processing fails', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const event = { id: 'evt_retry', type: 'checkout.session.completed', data: { object: {
      metadata: { paymentId: 'payment-retry' }, payment_status: 'paid',
      payment_intent: 'pi_test', amount_total: 1000, currency: 'brl',
    } } };
    const completeCheckoutPayment = vi.fn().mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue({ personId: 'person-1' });
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent: vi.fn().mockReturnValue(event) } } as never,
      { getPaymentById: vi.fn().mockResolvedValue({}), isPaymentFinalized: vi.fn().mockResolvedValue(false),
        completeCheckoutPayment, getPaymentEventId: vi.fn().mockResolvedValue(null),
        setPaymentEventId: vi.fn(), getOrderByPaymentId: vi.fn().mockResolvedValue(null) } as never,
      {} as never, {} as never,
    );
    const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig' } } as unknown as Request;
    const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() });
    const first = response(); const second = response();
    await handler(req, first as unknown as Response, vi.fn());
    await handler(req, second as unknown as Response, vi.fn());
    expect(first.status).toHaveBeenCalledWith(500);
    expect(second.status).toHaveBeenCalledWith(200);
    expect(completeCheckoutPayment).toHaveBeenCalledTimes(2);
  });

});