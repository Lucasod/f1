import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { Request, Response } from 'express';
import { PaymentService, PaymentError } from '../order/payment.service';
import {
  Payment,
  Order,
  OrderStatus,
  PaymentStatus,
  InMemoryPaymentRepository,
  InMemoryOrderRepository,
} from '../order/order.domain';
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
      { completeCheckoutPayment, isPaymentFinalized: vi.fn().mockResolvedValue(false), orderRepo: { findById: vi.fn().mockResolvedValue({ vendorGroups: [] }) }, getPaymentEventId: vi.fn().mockResolvedValue(null), setPaymentEventId: vi.fn().mockResolvedValue(undefined), getOrderByPaymentId: vi.fn().mockResolvedValue(null) } as unknown as PaymentService,
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
      id: 'evt_test_duplicate_webhook',
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
    const completeCheckoutPayment = vi.fn().mockResolvedValue(mockPayment as any);
    const handler = createStripeWebhookHandler(
      { webhooks: { constructEvent } } as never,
      { completeCheckoutPayment, getPaymentById: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ ...mockPayment, eventId: 'evt_test_duplicate_webhook' }), orderRepo: { findById: vi.fn().mockResolvedValue({ vendorGroups: [] }) }, getPaymentEventId: vi.fn().mockResolvedValue(null), setPaymentEventId: vi.fn().mockResolvedValue(undefined), getOrderByPaymentId: vi.fn().mockResolvedValue(null) } as unknown as PaymentService,
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

  describe('LC-14 acceptance criteria', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('AC-1: transitions payment to CAPTURED and order to PAID, persists eventId on checkout.session.completed', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');

      const paymentRepo = new InMemoryPaymentRepository();
      const orderRepo = new InMemoryOrderRepository();
      const paymentService = new PaymentService(paymentRepo, orderRepo);

      const order = Order.create({
        personId: 'consumer-1',
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [{ productId: 'product-1', productName: 'Product 1', vendorId: 'vendor-1', quantity: 1, unitPrice: 100 }],
            commissionPct: 10,
          },
        ],
        shippingAddress: {
          id: 'addr-1', street: 'Street', number: '1', neighborhood: 'Neigh', city: 'City', state: 'State', isPrimary: true,
        },
      });
      await orderRepo.save(order);

      const payment = Payment.create({ orderId: order.id, personId: 'consumer-1', amount: 100, provider: 'stripe' });
      await paymentRepo.save(payment);

      const event = {
        type: 'checkout.session.completed',
        id: 'evt_test_ac1',
        data: { object: {
          metadata: { paymentId: payment.id },
          payment_status: 'paid',
          payment_intent: 'pi_test_ac1',
          amount_total: 10000,
          currency: 'brl',
        } },
      } as unknown as Stripe.Event;
      const constructEvent = vi.fn().mockReturnValue(event);
      const handler = createStripeWebhookHandler(
        { webhooks: { constructEvent } } as never,
        paymentService,
        { removeItem: vi.fn().mockResolvedValue({} as any), removeItemQuantity: vi.fn().mockResolvedValue({} as any) } as any,
        { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
      );
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      const updatedPayment = await paymentService.getPaymentById(payment.id);
      expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);
      expect(updatedPayment?.eventId).toBe('evt_test_ac1');

      const updatedOrder = await orderRepo.findById(order.id);
      expect(updatedOrder?.status).toBe(OrderStatus.PAID);

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('AC-4: removes purchased quantities from cart, preserves non-purchased items', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');

      const paymentRepo = new InMemoryPaymentRepository();
      const orderRepo = new InMemoryOrderRepository();
      const paymentService = new PaymentService(paymentRepo, orderRepo);

      const order = Order.create({
        personId: 'consumer-1',
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [
              { productId: 'product-purchased', productName: 'Purchased', vendorId: 'vendor-1', quantity: 1, unitPrice: 50 },
              { productId: 'product-kept', productName: 'Kept', vendorId: 'vendor-1', quantity: 2, unitPrice: 25 },
            ],
            commissionPct: 10,
          },
        ],
        shippingAddress: {
          id: 'addr-1', street: 'Street', number: '1', neighborhood: 'Neigh', city: 'City', state: 'State', isPrimary: true,
        },
      });
      await orderRepo.save(order);

      const payment = Payment.create({ orderId: order.id, personId: 'consumer-1', amount: 100, provider: 'stripe' });
      await paymentRepo.save(payment);

      const removed: { productId: string; quantity: number }[] = [];
      const removeItemQuantity = vi.fn().mockImplementation(async (personId: string, productId: string, quantity: number) => {
        removed.push({ productId, quantity });
        return {} as any;
      });

      const event = {
        type: 'checkout.session.completed',
        id: 'evt_test_ac4',
        data: { object: {
          metadata: { paymentId: payment.id },
          payment_status: 'paid',
          payment_intent: 'pi_test_ac4',
          amount_total: 10000,
          currency: 'brl',
        } },
      } as unknown as Stripe.Event;
      const constructEvent = vi.fn().mockReturnValue(event);
      const handler = createStripeWebhookHandler(
        { webhooks: { constructEvent } } as never,
        paymentService,
        { removeItemQuantity } as any,
        { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
      );
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      // Only the purchased quantities are removed; the entire item is NOT removed,
      // so non-purchased items (and any post-checkout additions) are preserved.
      expect(removeItemQuantity).toHaveBeenCalledWith('consumer-1', 'product-purchased', 1);
      expect(removeItemQuantity).toHaveBeenCalledWith('consumer-1', 'product-kept', 2);
      expect(
        removed.sort((a, b) => a.productId.localeCompare(b.productId))
      ).toEqual([
        { productId: 'product-kept', quantity: 2 },
        { productId: 'product-purchased', quantity: 1 },
      ]);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('LC-15 cart reconciliation', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('removes only the purchased quantity, preserving post-checkout additions of the same SKU', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');

      const paymentRepo = new InMemoryPaymentRepository();
      const orderRepo = new InMemoryOrderRepository();
      const paymentService = new PaymentService(paymentRepo, orderRepo);

      const order = Order.create({
        personId: 'consumer-1',
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [{ productId: 'product-a', productName: 'Product A', vendorId: 'vendor-1', quantity: 2, unitPrice: 50 }],
            commissionPct: 10,
          },
        ],
        shippingAddress: {
          id: 'addr-1', street: 'Street', number: '1', neighborhood: 'Neigh', city: 'City', state: 'State', isPrimary: true,
        },
      });
      await orderRepo.save(order);

      const payment = Payment.create({ orderId: order.id, personId: 'consumer-1', amount: 100, provider: 'stripe' });
      await paymentRepo.save(payment);

      const removed: { productId: string; quantity: number }[] = [];
      const removeItemQuantity = vi.fn().mockImplementation(async (personId: string, productId: string, quantity: number) => {
        removed.push({ productId, quantity });
        return {} as any;
      });
      const removeItem = vi.fn();

      const event = {
        type: 'checkout.session.completed',
        id: 'evt_test_lc15',
        data: { object: {
          metadata: { paymentId: payment.id },
          payment_status: 'paid',
          payment_intent: 'pi_test_lc15',
          amount_total: 10000,
          currency: 'brl',
        } },
      } as unknown as Stripe.Event;
      const constructEvent = vi.fn().mockReturnValue(event);
      const handler = createStripeWebhookHandler(
        { webhooks: { constructEvent } } as never,
        paymentService,
        { removeItemQuantity, removeItem } as any,
        { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
      );
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      // Only the purchased quantity is removed; the entire item is NOT removed,
      // so any post-checkout additions of the same SKU are preserved.
      expect(removeItemQuantity).toHaveBeenCalledWith('consumer-1', 'product-a', 2);
      expect(removeItem).not.toHaveBeenCalled();
      expect(removed).toEqual([{ productId: 'product-a', quantity: 2 }]);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('does not perform a second removal on duplicate webhook delivery (idempotency)', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');

      const event = {
        type: 'checkout.session.completed',
        id: 'evt_test_lc15_dup',
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
      const removeItemQuantity = vi.fn().mockResolvedValue({} as any);

      const handler = createStripeWebhookHandler(
        { webhooks: { constructEvent } } as never,
        {
          completeCheckoutPayment,
          isPaymentFinalized,
          getPaymentById: vi.fn().mockResolvedValue(null),
          orderRepo: { findById: vi.fn().mockResolvedValue({ vendorGroups: [{ items: [{ productId: 'product-a', quantity: 2 }] }] }) },
          getPaymentEventId: vi.fn().mockResolvedValue(null),
          setPaymentEventId: vi.fn().mockResolvedValue(undefined),
          getOrderByPaymentId: vi.fn().mockResolvedValue({ vendorGroups: [{ items: [{ productId: 'product-a', quantity: 2 }] }] }),
        } as unknown as PaymentService,
        { removeItemQuantity } as any,
        { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
      );
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
      const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res1, vi.fn());
      await handler(req, res2, vi.fn());

      expect(completeCheckoutPayment).toHaveBeenCalledTimes(1);
      expect(removeItemQuantity).toHaveBeenCalledTimes(1);
      expect(removeItemQuantity).toHaveBeenCalledWith('consumer-1', 'product-a', 2);
      expect(res1.status).toHaveBeenCalledWith(200);
      expect(res2.status).toHaveBeenCalledWith(200);
    });
  });

  describe('LC-16 gap tests', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('checkout.session.expired transitions payment to FAILED and order to FAILED_PAYMENT, preserving cart', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');

      const paymentRepo = new InMemoryPaymentRepository();
      const orderRepo = new InMemoryOrderRepository();
      const paymentService = new PaymentService(paymentRepo, orderRepo);

      const order = Order.create({
        personId: 'consumer-1',
        vendorGroups: [{
          vendorId: 'vendor-1',
          items: [{ productId: 'product-1', productName: 'Product 1', vendorId: 'vendor-1', quantity: 1, unitPrice: 100 }],
          commissionPct: 10,
        }],
        shippingAddress: { id: 'addr-1', street: 'Street', number: '1', neighborhood: 'Neigh', city: 'City', state: 'State', isPrimary: true },
      });
      await orderRepo.save(order);

      const payment = await paymentService.createPayment(order.id, 'consumer-1', order.totalAmount);
      expect(payment.status).toBe(PaymentStatus.PENDING);

      const removeItemQuantity = vi.fn().mockResolvedValue({} as any);

      const event = {
        type: 'checkout.session.expired',
        id: 'evt_test_lc16_expired',
        data: { object: {
          metadata: { paymentId: payment.id },
          currency: 'brl',
        } },
      } as unknown as Stripe.Event;
      const constructEvent = vi.fn().mockReturnValue(event);
      const handler = createStripeWebhookHandler(
        { webhooks: { constructEvent } } as never,
        paymentService,
        { removeItemQuantity } as any,
        { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
      );
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      const updatedPayment = await paymentService.getPaymentById(payment.id);
      expect(updatedPayment?.status).toBe(PaymentStatus.FAILED);

      const updatedOrder = await orderRepo.findById(order.id);
      expect(updatedOrder?.status).toBe(OrderStatus.FAILED_PAYMENT);

      expect(removeItemQuantity).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ received: true });
    });

    it('checkout.session.async_payment_failed does not call removeItemQuantity (cart preserved)', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');

      const paymentRepo = new InMemoryPaymentRepository();
      const orderRepo = new InMemoryOrderRepository();
      const paymentService = new PaymentService(paymentRepo, orderRepo);

      const order = Order.create({
        personId: 'consumer-1',
        vendorGroups: [{
          vendorId: 'vendor-1',
          items: [{ productId: 'product-1', productName: 'Product 1', vendorId: 'vendor-1', quantity: 1, unitPrice: 100 }],
          commissionPct: 10,
        }],
        shippingAddress: { id: 'addr-1', street: 'Street', number: '1', neighborhood: 'Neigh', city: 'City', state: 'State', isPrimary: true },
      });
      await orderRepo.save(order);

      const payment = await paymentService.createPayment(order.id, 'consumer-1', order.totalAmount);

      const removeItemQuantity = vi.fn().mockResolvedValue({} as any);

      const event = {
        type: 'checkout.session.async_payment_failed',
        id: 'evt_test_lc16_async_failed',
        data: { object: {
          metadata: { paymentId: payment.id },
          currency: 'brl',
        } },
      } as unknown as Stripe.Event;
      const constructEvent = vi.fn().mockReturnValue(event);
      const handler = createStripeWebhookHandler(
        { webhooks: { constructEvent } } as never,
        paymentService,
        { removeItemQuantity } as any,
        { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
      );
      const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

      await handler(req, res, vi.fn());

      expect(removeItemQuantity).not.toHaveBeenCalled();
      const updatedPayment = await paymentService.getPaymentById(payment.id);
      expect(updatedPayment?.status).toBe(PaymentStatus.FAILED);
      const updatedOrder = await orderRepo.findById(order.id);
      expect(updatedOrder?.status).toBe(OrderStatus.FAILED_PAYMENT);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
