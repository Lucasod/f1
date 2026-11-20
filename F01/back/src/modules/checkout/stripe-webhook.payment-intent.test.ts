import { afterEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { Request, Response } from 'express';
import {
  Payment,
  Order,
  OrderStatus,
  PaymentStatus,
  InMemoryPaymentRepository,
  InMemoryOrderRepository,
} from '../order/order.domain';
import { WalletService } from '../wallet/wallet.service';
import {
  InMemoryWalletRepository,
  InMemoryWalletTransactionRepository,
} from '../wallet/wallet.domain';
import { InMemoryFinancialMovementRepository } from '../financial/financial.movement';
import { ClientSession, Db } from 'mongodb';
import { PaymentService } from '../order/payment.service';
import { createStripeWebhookHandler } from './stripe-webhook.handler';

function buildPaymentService() {
  const paymentRepo = new InMemoryPaymentRepository();
  const orderRepo = new InMemoryOrderRepository();
  const walletRepo = new InMemoryWalletRepository();
  const txRepo = new InMemoryWalletTransactionRepository();
  const walletService = new WalletService(walletRepo, txRepo);
  const movementRepo = new InMemoryFinancialMovementRepository();
  const mockSession = {
    withTransaction: vi.fn(async (fn: (s: ClientSession) => Promise<void>) =>
      await fn(mockSession as unknown as ClientSession)
    ),
    endSession: vi.fn(async () => {}),
  };
  const mockMongoDb = {
    client: {
      startSession: () => mockSession,
    },
  };
  const paymentService = new PaymentService(
    paymentRepo, orderRepo,
    undefined, walletService, undefined, undefined, undefined,
    movementRepo, undefined, undefined,
    mockMongoDb as unknown as Db
  );
  return { paymentService, paymentRepo, orderRepo, walletService, movementRepo };
}

function buildOrderAndPayment(personId = 'consumer-1', amount = 100) {
  const order = Order.create({
    personId,
    vendorGroups: [
      {
        vendorId: 'vendor-1',
        items: [{ productId: 'product-1', productName: 'Product 1', vendorId: 'vendor-1', quantity: 1, unitPrice: amount }],
        commissionPct: 10,
      },
    ],
    shippingAddress: {
      id: 'addr-1', street: 'Street', number: '1', neighborhood: 'Neigh', city: 'City', state: 'State', isPrimary: true,
    },
  });
  const payment = Payment.create({ orderId: order.id, personId, amount, provider: 'stripe' });
  return { order, payment };
}

function handlerFor(paymentService: PaymentService, constructEvent: ReturnType<typeof vi.fn>) {
  return createStripeWebhookHandler(
    { webhooks: { constructEvent } } as never,
    paymentService,
    { removeItem: vi.fn(), removeItemQuantity: vi.fn().mockResolvedValue({} as any) } as any,
    { findByStripeTransferId: vi.fn().mockResolvedValue(null), completeTransfer: vi.fn(), failTransfer: vi.fn() } as any
  );
}

function reqRes() {
  const req = { body: Buffer.from('{}'), headers: { 'stripe-signature': 'sig_test' } } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  return { req, res };
}

function countMovements(movementRepo: InMemoryFinancialMovementRepository): number {
  // @ts-ignore - accessing internal map for test assertion only
  return movementRepo['movements']?.size ?? 0;
}

describe('Stripe webhook — payment_intent branches (R-08 Frente H)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('payment_intent.succeeded transitions payment to CAPTURED and order to PAID, persists eventId', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService, orderRepo, paymentRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    payment.providerTransactionId = 'cs_test_pending_intent';
    await paymentRepo.save(payment);

    const event = {
      type: 'payment_intent.succeeded',
      id: 'evt_pi_succeeded_1',
      data: { object: {
        id: 'pi_succeeded_1',
        amount: 10000,
        currency: 'brl',
        metadata: { paymentId: payment.id, orderId: order.id },
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = handlerFor(paymentService, constructEvent);
    const { req, res } = reqRes();

    await handler(req, res, vi.fn());

    const updatedPayment = await paymentService.getPaymentById(payment.id);
    expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);
    expect(updatedPayment?.eventId).toBe('evt_pi_succeeded_1');

    const updatedOrder = await orderRepo.findById(order.id);
    expect(updatedOrder?.status).toBe(OrderStatus.PAID);

    expect(constructEvent).toHaveBeenCalledWith(req.body, 'sig_test', 'whsec_test');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('payment_intent.payment_failed transitions payment to FAILED and order to FAILED_PAYMENT', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService, orderRepo, paymentRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.authorizePayment(payment.id, 'pi_failed_1');

    const event = {
      type: 'payment_intent.payment_failed',
      id: 'evt_pi_failed_1',
      data: { object: {
        id: 'pi_failed_1',
        currency: 'brl',
        metadata: { paymentId: payment.id },
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = handlerFor(paymentService, constructEvent);
    const { req, res } = reqRes();

    await handler(req, res, vi.fn());

    const updatedPayment = await paymentService.getPaymentById(payment.id);
    expect(updatedPayment?.status).toBe(PaymentStatus.FAILED);

    const updatedOrder = await orderRepo.findById(order.id);
    expect(updatedOrder?.status).toBe(OrderStatus.FAILED_PAYMENT);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('correlated events (checkout.session.completed then payment_intent.succeeded) do not duplicate financial effects', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService, orderRepo, paymentRepo, movementRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);

    const completedEvent = {
      type: 'checkout.session.completed',
      id: 'evt_corr_completed',
      data: { object: {
        metadata: { paymentId: payment.id },
        payment_status: 'paid',
        payment_intent: 'pi_corr_1',
        amount_total: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const succeededEvent = {
      type: 'payment_intent.succeeded',
      id: 'evt_corr_succeeded',
      data: { object: {
        id: 'pi_corr_1',
        amount: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;

    const constructEvent = vi.fn();
    constructEvent.mockReturnValueOnce(completedEvent).mockReturnValueOnce(succeededEvent);
    const handler = handlerFor(paymentService, constructEvent);

    // First delivery: checkout.session.completed captures the payment
    const { req, res } = reqRes();
    await handler(req, res, vi.fn());
    let updated = await paymentService.getPaymentById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.CAPTURED);
    expect(updated?.eventId).toBe('evt_corr_completed');
    expect(res.status).toHaveBeenCalledWith(200);
    const movementsAfterFirst = countMovements(movementRepo);

    // Second delivery: payment_intent.succeeded for the same payment (already CAPTURED)
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    await handler(req, res2, vi.fn());
    updated = await paymentService.getPaymentById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.CAPTURED); // not re-captured
    expect(updated?.eventId).toBe('evt_corr_completed'); // eventId not overwritten by correlated event
    const movementsAfterSecond = countMovements(movementRepo);
    expect(movementsAfterSecond).toBe(movementsAfterFirst); // no duplicate financial ledger entries
    expect(res2.status).toHaveBeenCalledWith(200);
    expect(res2.json).toHaveBeenCalledWith({ received: true });
  });

  it('out-of-order payment_intent.succeeded before checkout.session.completed is idempotent', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService, orderRepo, paymentRepo, movementRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.authorizePayment(payment.id, 'pi_ooo_1');

    const succeededEvent = {
      type: 'payment_intent.succeeded',
      id: 'evt_ooo_succeeded',
      data: { object: {
        id: 'pi_ooo_1',
        amount: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const completedEvent = {
      type: 'checkout.session.completed',
      id: 'evt_ooo_completed',
      data: { object: {
        metadata: { paymentId: payment.id },
        payment_status: 'paid',
        payment_intent: 'pi_ooo_1',
        amount_total: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;

    const constructEvent = vi.fn();
    constructEvent.mockReturnValueOnce(succeededEvent).mockReturnValueOnce(completedEvent);
    const handler = handlerFor(paymentService, constructEvent);

    // First: payment_intent.succeeded (out of order) captures the payment
    const { req, res } = reqRes();
    await handler(req, res, vi.fn());
    let updated = await paymentService.getPaymentById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.CAPTURED);
    expect(updated?.eventId).toBe('evt_ooo_succeeded');
    expect(res.status).toHaveBeenCalledWith(200);
    const movementsAfterFirst = countMovements(movementRepo);

    // Second: checkout.session.completed for the same payment (already CAPTURED)
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    await handler(req, res2, vi.fn());
    updated = await paymentService.getPaymentById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.CAPTURED); // not re-captured
    const movementsAfterSecond = countMovements(movementRepo);
    expect(movementsAfterSecond).toBe(movementsAfterFirst); // no duplicate financial ledger entries
    const updatedOrder = await orderRepo.findById(order.id);
    expect(updatedOrder?.status).toBe(OrderStatus.PAID); // order repaired by correlated event
    expect(res2.status).toHaveBeenCalledWith(200);
    expect(res2.json).toHaveBeenCalledWith({ received: true });
  });

  it('duplicate payment_intent.succeeded delivery is processed only once', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService, orderRepo, paymentRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.authorizePayment(payment.id, 'pi_dup_1');

    const event = {
      type: 'payment_intent.succeeded',
      id: 'evt_pi_dup_1',
      data: { object: {
        id: 'pi_dup_1',
        amount: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = handlerFor(paymentService, constructEvent);
    const { req } = reqRes();
    const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;

    await handler(req, res1, vi.fn());
    await handler(req, res2, vi.fn());

    const updated = await paymentService.getPaymentById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.CAPTURED);
    expect(updated?.eventId).toBe('evt_pi_dup_1');
    expect(res1.status).toHaveBeenCalledWith(200);
    expect(res2.status).toHaveBeenCalledWith(200);
  });

  it('payment_intent.succeeded on an already-terminal FAILED payment is ignored', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService, paymentRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await paymentRepo.save(payment);
    await paymentService.failPayment(payment.id);

    const event = {
      type: 'payment_intent.succeeded',
      id: 'evt_pi_terminal',
      data: { object: {
        id: 'pi_terminal_1',
        amount: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = handlerFor(paymentService, constructEvent);
    const { req, res } = reqRes();

    await handler(req, res, vi.fn());

    const updated = await paymentService.getPaymentById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.FAILED); // unchanged
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('payment_intent.succeeded with no matching payment is ignored (200)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService } = buildPaymentService();

    const event = {
      type: 'payment_intent.succeeded',
      id: 'evt_pi_no_match',
      data: { object: {
        id: 'pi_no_match_1',
        amount: 10000,
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = handlerFor(paymentService, constructEvent);
    const { req, res } = reqRes();

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('payment_intent.payment_failed on an already-terminal CAPTURED payment is ignored', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const { paymentService, orderRepo, paymentRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.authorizePayment(payment.id, 'pi_terminal_2');
    await paymentService.capturePayment(payment.id);

    const event = {
      type: 'payment_intent.payment_failed',
      id: 'evt_pi_failed_terminal',
      data: { object: {
        id: 'pi_terminal_2',
        currency: 'brl',
      } },
    } as unknown as Stripe.Event;
    const constructEvent = vi.fn().mockReturnValue(event);
    const handler = handlerFor(paymentService, constructEvent);
    const { req, res } = reqRes();

    await handler(req, res, vi.fn());

    const updated = await paymentService.getPaymentById(payment.id);
    expect(updated?.status).toBe(PaymentStatus.CAPTURED); // unchanged
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});
