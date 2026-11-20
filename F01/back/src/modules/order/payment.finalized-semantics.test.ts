import { afterEach, describe, expect, it, vi } from 'vitest';
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
  return { paymentService, paymentRepo, orderRepo };
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

describe('isPaymentFullyFinalized — explicit/documented behavior (R-08 Frente H)', () => {
  it('returns false for a missing payment', async () => {
    const { paymentService } = buildPaymentService();
    expect(await paymentService.isPaymentFullyFinalized('does-not-exist')).toBe(false);
  });

  it('returns false for a PENDING payment', async () => {
    const { paymentService, paymentRepo, orderRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    expect(await paymentService.isPaymentFullyFinalized(payment.id)).toBe(false);
  });

  it('returns false for an AUTHORIZED payment', async () => {
    const { paymentService, paymentRepo, orderRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.authorizePayment(payment.id, 'pi_auth_1');
    expect(await paymentService.isPaymentFullyFinalized(payment.id)).toBe(false);
  });

  it('returns false for CAPTURED payment whose order is still PENDING_PAYMENT (capture durable, order repair pending)', async () => {
    const { paymentService, paymentRepo, orderRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    // Put the payment into CAPTURED without calling capturePayment (which would
    // also update the order to PAID). This simulates a durable capture whose
    // order-update repair has not yet run.
    await paymentService.authorizePayment(payment.id, 'pi_cap_1');
    // Directly transition the persisted payment entity to CAPTURED and persist,
    // leaving the order as PENDING_PAYMENT (simulating durable capture whose
    // order-update repair has not yet run).
    payment.status = PaymentStatus.CAPTURED;
    payment.capturedAt = new Date();
    await paymentRepo.save(payment);
    const updatedPayment = await paymentService.getPaymentById(payment.id);
    expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);
    const updatedOrder = await orderRepo.findById(order.id);
    expect(updatedOrder?.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(await paymentService.isPaymentFullyFinalized(payment.id)).toBe(false,
      'CAPTURED payment with PENDING_PAYMENT order is not fully finalized');
  });

  it('returns true for CAPTURED payment whose order is PAID', async () => {
    const { paymentService, paymentRepo, orderRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.authorizePayment(payment.id, 'pi_cap_2');
    await paymentService.capturePayment(payment.id);
    const updatedOrder = await orderRepo.findById(order.id);
    expect(updatedOrder?.status).toBe(OrderStatus.PAID);
    expect(await paymentService.isPaymentFullyFinalized(payment.id)).toBe(true);
  });

  it('returns true for a FAILED payment', async () => {
    const { paymentService, paymentRepo, orderRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.failPayment(payment.id);
    expect(await paymentService.isPaymentFullyFinalized(payment.id)).toBe(true);
  });

  it('returns true for a REFUNDED payment', async () => {
    const { paymentService, paymentRepo, orderRepo } = buildPaymentService();
    const { order, payment } = buildOrderAndPayment();
    await orderRepo.save(order);
    await paymentRepo.save(payment);
    await paymentService.authorizePayment(payment.id, 'pi_ref_1');
    await paymentService.capturePayment(payment.id);
    await paymentService.refundPayment(payment.id);
    expect(await paymentService.isPaymentFullyFinalized(payment.id)).toBe(true);
  });
});
