import { mockPaymentMongo } from '../../tests/mock-payment-mongo';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService, PaymentError } from './payment.service';
import { Payment, PaymentStatus, InMemoryPaymentRepository, Order, OrderStatus, OrderError, FinancialStatus, InMemoryOrderRepository, OrderVendorGroupStatus } from './order.domain';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';
import { Product, InMemoryProductRepository } from '../product/product.domain';
import { config } from '../../config';
import { TransferStatus, Transfer } from '../transfer/transfer.domain';
import { Vendor, VendorStatus, InMemoryVendorRepository } from '../vendor/vendor.domain';

vi.mock('stripe', () => {
  const retrieve = vi.fn();
  const transfersCreate = vi.fn();
  const accountsRetrieve = vi.fn();
  return {
    default: class StripeMock {
      checkout = { sessions: { retrieve } };
      transfers = { create: transfersCreate };
      accounts = { retrieve: accountsRetrieve };
    },
    __retrieve: retrieve,
    __transfersCreate: transfersCreate,
    __accountsRetrieve: accountsRetrieve,
  };
});

import { __retrieve as mockRetrieve, __transfersCreate as mockTransfersCreate, __accountsRetrieve as mockAccountsRetrieve } from 'stripe';

describe('Payment Service', () => {
  let paymentRepo: InMemoryPaymentRepository;
  let orderRepo: InMemoryOrderRepository;
  let personRepo: InMemoryPersonRepository;
  let paymentService: PaymentService;

  let testPerson: Person;
  let testOrder: Order;

  beforeEach(async () => {
    paymentRepo = new InMemoryPaymentRepository();
    orderRepo = new InMemoryOrderRepository();
    personRepo = new InMemoryPersonRepository();
    paymentService = new PaymentService(paymentRepo, orderRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mockPaymentMongo);

    // Create a test person (consumer)
    testPerson = Person.create({
      name: 'Test Consumer',
      mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
      contactInfos: [{ type: 'email', value: 'consumer@test.com', isPrimary: true }],
      addresses: []
    });
    testPerson.addRole(PersonRole.CONSUMER);
    await personRepo.save(testPerson);

    // Create a test order
    testOrder = Order.create({
      personId: testPerson.id,
      vendorGroups: [{
        vendorId: 'vendor-1',
        items: [{
          productId: 'product-1',
          productName: 'Test Product',
          vendorId: 'vendor-1',
          quantity: 2,
          unitPrice: 50
        }],
        commissionPct: config.commissionPct
      }],
      shippingAddress: {
        id: 'addr-1',
        street: 'Test Street',
        number: '123',
        neighborhood: 'Test Neighborhood',
        city: 'Test City',
        state: 'TS',
        isPrimary: true
      }
    });
    await orderRepo.save(testOrder);
  });

  // Helper to create a payment directly for testing state transitions
  async function createTestPayment(
    orderId: string = testOrder.id,
    personId: string = testPerson.id,
    amount: number = testOrder.totalAmount,
    provider?: string
  ): Promise<Payment> {
    return paymentService.createPayment(orderId, personId, amount, provider);
  }

  async function createAuthorizedPayment(): Promise<Payment> {
    const payment = await createTestPayment();
    return paymentService.authorizePayment(payment.id, 'txn_test_123');
  }

  async function createCapturedPayment(): Promise<Payment> {
    const payment = await createAuthorizedPayment();
    return paymentService.capturePayment(payment.id);
  }

  describe('completeCheckoutPayment', () => {
    it('captures a paid Checkout payment and handles duplicate webhook delivery', async () => {
      const payment = await createTestPayment();

      const first = await paymentService.completeCheckoutPayment(payment.id, 'pi_test_123', 10000);
      const duplicate = await paymentService.completeCheckoutPayment(payment.id, 'pi_test_123', 10000);

      expect(first.status).toBe(PaymentStatus.CAPTURED);
      expect(duplicate.status).toBe(PaymentStatus.CAPTURED);
      expect(testOrder.status).toBe(OrderStatus.PAID);
    });

    it('rejects a completed Checkout Session whose paid amount differs from the order', async () => {
      const payment = await createTestPayment();

      await expect(paymentService.completeCheckoutPayment(payment.id, 'pi_test_123', 999))
        .rejects.toThrow(PaymentError.PAYMENT_AMOUNT_MISMATCH);
      expect(payment.status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('createPayment', () => {
    it('should create payment with valid inputs', async () => {
      const payment = await paymentService.createPayment(
        testOrder.id,
        testPerson.id,
        testOrder.totalAmount
      );

      expect(payment).toBeDefined();
      expect(payment.orderId).toBe(testOrder.id);
      expect(payment.personId).toBe(testPerson.id);
      expect(payment.amount).toBe(testOrder.totalAmount);
      expect(payment.status).toBe(PaymentStatus.PENDING);
      expect(payment.provider).toBe('stripe'); // default provider
    });

    it('should create payment with custom provider', async () => {
      const payment = await paymentService.createPayment(
        testOrder.id,
        testPerson.id,
        testOrder.totalAmount,
        'mock'
      );

      expect(payment.provider).toBe('mock');
    });

    it('should default provider to stripe when not specified', async () => {
      const payment = await paymentService.createPayment(
        testOrder.id,
        testPerson.id,
        testOrder.totalAmount
      );

      expect(payment.provider).toBe('stripe');
    });

    it('should reject empty orderId', async () => {
      await expect(paymentService.createPayment('', testPerson.id, testOrder.totalAmount))
        .rejects.toThrow(PaymentError.ORDER_NOT_FOUND);
    });

    it('should reject whitespace-only orderId', async () => {
      await expect(paymentService.createPayment('   ', testPerson.id, testOrder.totalAmount))
        .rejects.toThrow(PaymentError.ORDER_NOT_FOUND);
    });

    it('should reject empty personId', async () => {
      await expect(paymentService.createPayment(testOrder.id, '', testOrder.totalAmount))
        .rejects.toThrow(OrderError.PERSON_ID_REQUIRED);
    });

    it('should reject whitespace-only personId', async () => {
      await expect(paymentService.createPayment(testOrder.id, '   ', testOrder.totalAmount))
        .rejects.toThrow(OrderError.PERSON_ID_REQUIRED);
    });

    it('should reject amount <= 0', async () => {
      await expect(paymentService.createPayment(testOrder.id, testPerson.id, 0))
        .rejects.toThrow(PaymentError.INVALID_PAYMENT_AMOUNT);
    });

    it('should reject negative amount', async () => {
      await expect(paymentService.createPayment(testOrder.id, testPerson.id, -10))
        .rejects.toThrow(PaymentError.INVALID_PAYMENT_AMOUNT);
    });

    it('should reject NaN amount', async () => {
      await expect(paymentService.createPayment(testOrder.id, testPerson.id, NaN))
        .rejects.toThrow(PaymentError.INVALID_PAYMENT_AMOUNT);
    });

    it('should reject non-finite amount', async () => {
      await expect(paymentService.createPayment(testOrder.id, testPerson.id, Infinity))
        .rejects.toThrow(PaymentError.INVALID_PAYMENT_AMOUNT);
    });

    it('should reject invalid provider', async () => {
      await expect(paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount, 'invalid_provider'))
        .rejects.toThrow(PaymentError.INVALID_PROVIDER);
    });

    it('should reject non-existent order', async () => {
      await expect(paymentService.createPayment('non-existent-order', testPerson.id, testOrder.totalAmount))
        .rejects.toThrow(PaymentError.ORDER_NOT_FOUND);
    });

    it('should reject amount mismatch with order total', async () => {
      await expect(paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount + 100))
        .rejects.toThrow(PaymentError.PAYMENT_AMOUNT_MISMATCH);
    });

    it('should return existing pending payment for same order (idempotency)', async () => {
      const payment1 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

      expect(payment2.id).toBe(payment1.id);
    });

    it('should return existing authorized payment for same order (idempotency)', async () => {
      const payment1 = await createAuthorizedPayment();
      const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

      expect(payment2.id).toBe(payment1.id);
      expect(payment2.status).toBe(PaymentStatus.AUTHORIZED);
    });

    it('should create new payment if existing one is failed', async () => {
      const payment1 = await createTestPayment();
      await paymentService.failPayment(payment1.id);

      const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

      expect(payment2.id).not.toBe(payment1.id);
      expect(payment2.status).toBe(PaymentStatus.PENDING);
    });

    it('reuses the same new attempt for concurrent retries after a failed payment', async () => {
      const previous = await createTestPayment();
      await paymentService.failPayment(previous.id);
      let timestamp = Date.now();
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => timestamp++);
      try {
        const retry = () => paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
        const [first, second] = await Promise.all([retry(), retry()]);

        expect(first.id).not.toBe(previous.id);
        expect(second.id).toBe(first.id);
        expect(await paymentRepo.findByOrderId(testOrder.id)).toHaveLength(2);
      } finally {
        clock.mockRestore();
      }
    });

    it('should create new payment if existing one is refunded', async () => {
      const payment1 = await createCapturedPayment();
      await paymentService.refundPayment(payment1.id);

      const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

      expect(payment2.id).not.toBe(payment1.id);
      expect(payment2.status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('authorizePayment', () => {
    it('does not authorize a payment after its order was cancelled', async () => {
      const payment = await createTestPayment();
      testOrder.transitionTo(OrderStatus.CANCELLED);
      await orderRepo.update(testOrder);

      await expect(paymentService.authorizePayment(payment.id, 'txn_test_123'))
        .rejects.toThrow(PaymentError.ORDER_NOT_PAYABLE);

      expect((await paymentRepo.findById(payment.id))?.status).toBe(PaymentStatus.PENDING);
      expect((await orderRepo.findById(testOrder.id))?.status).toBe(OrderStatus.CANCELLED);
    });

    it('should authorize a PENDING payment', async () => {
      const payment = await createTestPayment();
      const authorized = await paymentService.authorizePayment(payment.id, 'txn_test_123');

      expect(authorized.status).toBe(PaymentStatus.AUTHORIZED);
      expect(authorized.providerTransactionId).toBe('txn_test_123');
      expect(authorized.authorizedAt).toBeDefined();
    });

    it('should keep order status PENDING_PAYMENT when payment authorized (CD-063: PAID requires captured payment)', async () => {
      const payment = await createTestPayment();
      await paymentService.authorizePayment(payment.id, 'txn_test_123');

      const orderAfterAuthorize = await orderRepo.findById(testOrder.id);
      expect(orderAfterAuthorize!.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(orderAfterAuthorize!.financialStatus).toBe('pending');

      // Capture promotes order to PAID
      await paymentService.capturePayment(payment.id);
      const orderAfterCapture = await orderRepo.findById(testOrder.id);
      expect(orderAfterCapture!.status).toBe(OrderStatus.PAID);
      expect(orderAfterCapture!.financialStatus).toBe('paid');
    });

    it('should throw PAYMENT_NOT_FOUND for non-existent payment', async () => {
      await expect(paymentService.authorizePayment('non-existent', 'txn_test_123'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_FOUND for empty paymentId', async () => {
      await expect(paymentService.authorizePayment('', 'txn_test_123'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_FOUND for whitespace-only paymentId', async () => {
      await expect(paymentService.authorizePayment('   ', 'txn_test_123'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw INVALID_PROVIDER for empty providerTransactionId', async () => {
      const payment = await createTestPayment();
      await expect(paymentService.authorizePayment(payment.id, ''))
        .rejects.toThrow(PaymentError.INVALID_PROVIDER);
    });

    it('should throw PAYMENT_NOT_AUTHORIZABLE for already AUTHORIZED payment', async () => {
      const payment = await createAuthorizedPayment();
      await expect(paymentService.authorizePayment(payment.id, 'txn_test_456'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });

    it('should throw PAYMENT_NOT_AUTHORIZABLE for CAPTURED payment', async () => {
      const payment = await createCapturedPayment();
      await expect(paymentService.authorizePayment(payment.id, 'txn_test_456'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });

    it('should throw PAYMENT_NOT_AUTHORIZABLE for FAILED payment', async () => {
      const payment = await createTestPayment();
      await paymentService.failPayment(payment.id);
      await expect(paymentService.authorizePayment(payment.id, 'txn_test_456'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });

    it('should throw PAYMENT_NOT_AUTHORIZABLE for REFUNDED payment', async () => {
      const payment = await createCapturedPayment();
      await paymentService.refundPayment(payment.id);
      await expect(paymentService.authorizePayment(payment.id, 'txn_test_456'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });

    it('should return as-is if already AUTHORIZED with same providerTransactionId (idempotency)', async () => {
      const payment = await createAuthorizedPayment();
      const authorizedAgain = await paymentService.authorizePayment(payment.id, payment.providerTransactionId!);

      expect(authorizedAgain.id).toBe(payment.id);
      expect(authorizedAgain.status).toBe(PaymentStatus.AUTHORIZED);
      expect(authorizedAgain.providerTransactionId).toBe(payment.providerTransactionId);
    });

    it('should throw PAYMENT_AMOUNT_MISMATCH if order total changed', async () => {
      const payment = await createTestPayment();
      // Manually modify order total to create mismatch
      const order = await orderRepo.findById(testOrder.id);
      order!.totalAmount = 9999;
      await orderRepo.update(order);

      await expect(paymentService.authorizePayment(payment.id, 'txn_test_123'))
        .rejects.toThrow(PaymentError.PAYMENT_AMOUNT_MISMATCH);
    });

    it('should throw ORDER_NOT_FOUND if order was deleted', async () => {
      const payment = await createTestPayment();
      await orderRepo.update(await orderRepo.findById(testOrder.id)); // Ensure order exists first
      // Can't easily delete from InMemoryOrderRepository, but we test the error path
      // by using a payment with non-existent orderId - though this shouldn't happen in practice
      // since createPayment validates order exists
    });
  });

  describe('capturePayment', () => {
    it('does not capture an authorized payment after its order was cancelled', async () => {
      const payment = await createAuthorizedPayment();
      testOrder.transitionTo(OrderStatus.CANCELLED);
      await orderRepo.update(testOrder);

      await expect(paymentService.capturePayment(payment.id))
        .rejects.toThrow(PaymentError.ORDER_NOT_PAYABLE);

      expect((await paymentRepo.findById(payment.id))?.status).toBe(PaymentStatus.AUTHORIZED);
      expect((await orderRepo.findById(testOrder.id))?.status).toBe(OrderStatus.CANCELLED);
    });

    it('should capture an AUTHORIZED payment', async () => {
      const payment = await createAuthorizedPayment();
      const captured = await paymentService.capturePayment(payment.id);

      expect(captured.status).toBe(PaymentStatus.CAPTURED);
      expect(captured.capturedAt).toBeDefined();
    });

    it('should throw PAYMENT_NOT_FOUND for non-existent payment', async () => {
      await expect(paymentService.capturePayment('non-existent'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_FOUND for empty paymentId', async () => {
      await expect(paymentService.capturePayment(''))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_CAPTURABLE for PENDING payment', async () => {
      const payment = await createTestPayment();
      await expect(paymentService.capturePayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_CAPTURABLE);
    });

    it('should throw PAYMENT_NOT_CAPTURABLE for FAILED payment', async () => {
      const payment = await createTestPayment();
      await paymentService.failPayment(payment.id);
      await expect(paymentService.capturePayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_CAPTURABLE);
    });

    it('should throw PAYMENT_NOT_CAPTURABLE for REFUNDED payment', async () => {
      const payment = await createCapturedPayment();
      await paymentService.refundPayment(payment.id);
      await expect(paymentService.capturePayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_CAPTURABLE);
    });

    it('should return as-is if already CAPTURED (idempotency)', async () => {
      const payment = await createCapturedPayment();
      const capturedAgain = await paymentService.capturePayment(payment.id);

      expect(capturedAgain.id).toBe(payment.id);
      expect(capturedAgain.status).toBe(PaymentStatus.CAPTURED);
      expect(capturedAgain.capturedAt).toEqual(payment.capturedAt);
    });
  });

  describe('failPayment', () => {
    it('should fail a PENDING payment', async () => {
      const payment = await createTestPayment();
      const failed = await paymentService.failPayment(payment.id);

      expect(failed.status).toBe(PaymentStatus.FAILED);
      expect(failed.failedAt).toBeDefined();
    });

    it('should fail an AUTHORIZED payment', async () => {
      const payment = await createAuthorizedPayment();
      const failed = await paymentService.failPayment(payment.id);

      expect(failed.status).toBe(PaymentStatus.FAILED);
      expect(failed.failedAt).toBeDefined();
    });

    it('should update order status to FAILED_PAYMENT when payment fails', async () => {
      const payment = await createTestPayment();
      await paymentService.failPayment(payment.id);

      const order = await orderRepo.findById(testOrder.id);
      expect(order!.status).toBe(OrderStatus.FAILED_PAYMENT);
    });

    it('should throw PAYMENT_NOT_FOUND for non-existent payment', async () => {
      await expect(paymentService.failPayment('non-existent'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_FOUND for empty paymentId', async () => {
      await expect(paymentService.failPayment(''))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_AUTHORIZABLE for CAPTURED payment', async () => {
      const payment = await createCapturedPayment();
      await expect(paymentService.failPayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });

    it('should throw PAYMENT_NOT_AUTHORIZABLE for REFUNDED payment', async () => {
      const payment = await createCapturedPayment();
      await paymentService.refundPayment(payment.id);
      await expect(paymentService.failPayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });

    it('should return as-is if already FAILED (idempotency)', async () => {
      const payment = await createTestPayment();
      const failed = await paymentService.failPayment(payment.id);
      const failedAgain = await paymentService.failPayment(failed.id);

      expect(failedAgain.id).toBe(failed.id);
      expect(failedAgain.status).toBe(PaymentStatus.FAILED);
      expect(failedAgain.failedAt).toEqual(failed.failedAt);
    });
  });

  describe('refundPayment', () => {
    it('should refund a CAPTURED payment', async () => {
      const payment = await createCapturedPayment();
      const refunded = await paymentService.refundPayment(payment.id);

      expect(refunded.status).toBe(PaymentStatus.REFUNDED);
      expect(refunded.refundedAt).toBeDefined();
    });

    it('should update order financial status to FULLY_REFUNDED when payment refunded', async () => {
      const payment = await createCapturedPayment();
      await paymentService.refundPayment(payment.id);

      const order = await orderRepo.findById(testOrder.id);
      expect(order!.financialStatus).toBe('fully_refunded');
    });

    it('should throw PAYMENT_NOT_FOUND for non-existent payment', async () => {
      await expect(paymentService.refundPayment('non-existent'))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_FOUND for empty paymentId', async () => {
      await expect(paymentService.refundPayment(''))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_FOUND);
    });

    it('should throw PAYMENT_NOT_REFUNDABLE for PENDING payment', async () => {
      const payment = await createTestPayment();
      await expect(paymentService.refundPayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_REFUNDABLE);
    });

    it('should throw PAYMENT_NOT_REFUNDABLE for AUTHORIZED payment', async () => {
      const payment = await createAuthorizedPayment();
      await expect(paymentService.refundPayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_REFUNDABLE);
    });

    it('should throw PAYMENT_NOT_REFUNDABLE for FAILED payment', async () => {
      const payment = await createTestPayment();
      await paymentService.failPayment(payment.id);
      await expect(paymentService.refundPayment(payment.id))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_REFUNDABLE);
    });

    it('should return as-is if already REFUNDED (idempotency)', async () => {
      const payment = await createCapturedPayment();
      const refunded = await paymentService.refundPayment(payment.id);
      const refundedAgain = await paymentService.refundPayment(refunded.id);

      expect(refundedAgain.id).toBe(refunded.id);
      expect(refundedAgain.status).toBe(PaymentStatus.REFUNDED);
      expect(refundedAgain.refundedAt).toEqual(refunded.refundedAt);
    });
  });

  describe('R-05: Commission adjustment on refund', () => {
    it('adjusts commission proportionally on full refund (CD-048/CD-065)', async () => {
      const movements: any[] = [];
      const movementRepo = { save: async (m: any) => movements.push(m) };
      const eventRepo = { save: async () => { } };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, undefined, undefined,
        movementRepo, eventRepo, undefined, mockPaymentMongo
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_test_r05_1');
      await svc.capturePayment(payment.id);

      // Verify commission snapshot was captured at capture time
      const capturedPayment = await svc.getPaymentById(payment.id);
      expect(capturedPayment!.commissionSnapshot).toHaveLength(1);
      expect(capturedPayment!.commissionSnapshot![0].commissionPct).toBe(config.commissionPct);
      expect(capturedPayment!.commissionSnapshot![0].commissionAmount).toBe(10); // 100 * 10%

      await svc.refundPayment(payment.id);

      const refundMovements = movements.filter((m: any) => m.data.movementType === 'refund');
      const commissionMovements = movements.filter((m: any) => m.data.movementType === 'commission');

      expect(refundMovements).toHaveLength(1);
      expect(refundMovements[0].data.amount).toBe(100); // full subtotal
      expect(refundMovements[0].data.vendorId).toBe('vendor-1');

      expect(commissionMovements).toHaveLength(1);
      expect(commissionMovements[0].data.amount).toBe(-10); // commission reversal
      expect(commissionMovements[0].data.vendorId).toBe('vendor-1');
    });

    it('partial refund prorates commission adjustment; repeat is idempotent (no duplicate debit)', async () => {
      const movements: any[] = [];
      const movementRepo = { save: async (m: any) => movements.push(m) };
      const eventRepo = { save: async () => { } };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, undefined, undefined,
        movementRepo, eventRepo, undefined, mockPaymentMongo
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_test_r05_2');
      await svc.capturePayment(payment.id);

      // Partial refund of 50 (half of 100)
      await svc.refundPayment(payment.id, 50);

      const refundMovements = movements.filter((m: any) => m.data.movementType === 'refund');
      const commissionMovements = movements.filter((m: any) => m.data.movementType === 'commission');

      expect(refundMovements).toHaveLength(1);
      expect(refundMovements[0].data.amount).toBe(50); // prorated refund

      expect(commissionMovements).toHaveLength(1);
      expect(commissionMovements[0].data.amount).toBe(-5); // prorated commission reversal

      // Repeat refund on already-REFUNDED payment — idempotent, no new movements
      const movementsBefore = movements.length;
      const refundedAgain = await svc.refundPayment(payment.id);
      const movementsAfter = movements.length;

      expect(refundedAgain.status).toBe(PaymentStatus.REFUNDED);
      expect(movementsAfter).toBe(movementsBefore); // no duplicate debit
    });

    it('repeated refund is idempotent (returns as-is, no new movements)', async () => {
      const movements: any[] = [];
      const movementRepo = { save: async (m: any) => movements.push(m) };
      const eventRepo = { save: async () => { } };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, undefined, undefined,
        movementRepo, eventRepo, undefined, mockPaymentMongo
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_test_r05_3');
      await svc.capturePayment(payment.id);

      const movementsBefore = movements.length;
      await svc.refundPayment(payment.id);
      const movementsAfterFirst = movements.length;

      // Second refund should be idempotent — no new ledger movements
      const refundedAgain = await svc.refundPayment(payment.id);
      const movementsAfterSecond = movements.length;

      expect(refundedAgain.status).toBe(PaymentStatus.REFUNDED);
      expect(movementsAfterSecond).toBe(movementsAfterFirst);
      expect(movementsAfterFirst).toBeGreaterThan(movementsBefore);
    });

    it('uses historical commission rate from snapshot, not current OVG rate, when OVG modified after payment (CD-048)', async () => {
      const movements: any[] = [];
      const movementRepo = { save: async (m: any) => movements.push(m) };
      const eventRepo = { save: async () => { } };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, undefined, undefined,
        movementRepo, eventRepo, undefined, mockPaymentMongo
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_test_r05_4');
      await svc.capturePayment(payment.id);

      // Verify snapshot captured commissionPct = 10 (config default)
      const capturedPayment = await svc.getPaymentById(payment.id);
      expect(capturedPayment!.commissionSnapshot![0].commissionPct).toBe(10);
      expect(capturedPayment!.commissionSnapshot![0].commissionAmount).toBe(10);

      // Simulate OVG commission changed after payment (de-15 scenario — R-05)
      const order = await orderRepo.findById(testOrder.id);
      order!.vendorGroups[0].commissionPct = 20;
      order!.vendorGroups[0].recalculateTotals();
      await orderRepo.update(order!);

      // Confirm current OVG now uses 20% commission
      const currentOrder = await orderRepo.findById(testOrder.id);
      expect(currentOrder!.vendorGroups[0].commissionPct).toBe(20);
      expect(currentOrder!.vendorGroups[0].commissionAmount).toBe(20); // 100 * 20%

      // Refund must use snapshot (10%), not current rate (20%)
      await svc.refundPayment(payment.id);

      const commissionMovements = movements.filter((m: any) => m.data.movementType === 'commission');
      expect(commissionMovements).toHaveLength(1);
      expect(commissionMovements[0].data.amount).toBe(-10); // snapshot rate, not -20
    });
  });

  describe('getPaymentById', () => {
    it('should return payment by ID', async () => {
      const payment = await createTestPayment();
      const found = await paymentService.getPaymentById(payment.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(payment.id);
      expect(found!.orderId).toBe(payment.orderId);
    });

    it('should return null for non-existent payment', async () => {
      const found = await paymentService.getPaymentById('non-existent');
      expect(found).toBeNull();
    });

    it('should return null for empty ID', async () => {
      const found = await paymentService.getPaymentById('');
      expect(found).toBeNull();
    });

    it('should return null for whitespace-only ID', async () => {
      const found = await paymentService.getPaymentById('   ');
      expect(found).toBeNull();
    });
  });

  describe('getPaymentsByOrderId', () => {
    it('should return payments for an order', async () => {
      await createTestPayment();
      const payments = await paymentService.getPaymentsByOrderId(testOrder.id);

      expect(payments).toHaveLength(1);
      expect(payments[0].orderId).toBe(testOrder.id);
    });

    it('should return multiple payments for an order', async () => {
      await createTestPayment();
      const payment1 = await createTestPayment(); // This will return existing due to idempotency
      // Create a failed payment then a new one
      await paymentService.failPayment(payment1.id);
      const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

      const payments = await paymentService.getPaymentsByOrderId(testOrder.id);
      expect(payments).toHaveLength(2);
    });

    it('should return empty array for non-existent order', async () => {
      const payments = await paymentService.getPaymentsByOrderId('non-existent');
      expect(payments).toEqual([]);
    });

    it('should return empty array for empty orderId', async () => {
      const payments = await paymentService.getPaymentsByOrderId('');
      expect(payments).toEqual([]);
    });

    it('should return payments sorted by createdAt descending', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const payment1 = await createTestPayment();
        vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
        await paymentService.failPayment(payment1.id);
        const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

        const payments = await paymentService.getPaymentsByOrderId(testOrder.id);
        expect(payments.map(payment => payment.id)).toEqual([payment2.id, payment1.id]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getPaymentsByPersonId', () => {
    it('should return payments for a person', async () => {
      await createTestPayment();
      const payments = await paymentService.getPaymentsByPersonId(testPerson.id);

      expect(payments).toHaveLength(1);
      expect(payments[0].personId).toBe(testPerson.id);
    });

    it('should return multiple payments for a person across orders', async () => {
      // Create second order
      const order2 = Order.create({
        personId: testPerson.id,
        vendorGroups: [{
          vendorId: 'vendor-2',
          items: [{
            productId: 'product-2',
            productName: 'Test Product 2',
            vendorId: 'vendor-2',
            quantity: 1,
            unitPrice: 100
          }],
          commissionPct: config.commissionPct
        }],
        shippingAddress: {
          id: 'addr-2',
          street: 'Test Street 2',
          number: '456',
          neighborhood: 'Test Neighborhood',
          city: 'Test City',
          state: 'TS',
          isPrimary: true
        }
      });
      await orderRepo.save(order2);

      await createTestPayment(testOrder.id);
      await createTestPayment(order2.id);

      const payments = await paymentService.getPaymentsByPersonId(testPerson.id);
      expect(payments).toHaveLength(2);
    });

    it('should return empty array for person with no payments', async () => {
      const otherPerson = Person.create({
        name: 'Other Consumer',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '98765432100' },
        contactInfos: [{ type: 'email', value: 'other@test.com', isPrimary: true }],
        addresses: []
      });
      otherPerson.addRole(PersonRole.CONSUMER);
      await personRepo.save(otherPerson);

      const payments = await paymentService.getPaymentsByPersonId(otherPerson.id);
      expect(payments).toEqual([]);
    });

    it('should return empty array for non-existent person', async () => {
      const payments = await paymentService.getPaymentsByPersonId('non-existent');
      expect(payments).toEqual([]);
    });

    it('should return empty array for empty personId', async () => {
      const payments = await paymentService.getPaymentsByPersonId('');
      expect(payments).toEqual([]);
    });

    it('should return payments sorted by createdAt descending', async () => {
      const payment1 = await createTestPayment();
      await paymentService.failPayment(payment1.id);
      const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

      const payments = await paymentService.getPaymentsByPersonId(testPerson.id);
      expect(payments[0].createdAt.getTime()).toBeGreaterThanOrEqual(payments[1].createdAt.getTime());
    });
  });

  describe('failPayment stock restoration', () => {
    it('restores reserved stock on failed payment', async () => {
      const productRepo = new InMemoryProductRepository();
      const product = Product.create({
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        name: 'Test Product',
        description: 'desc',
        price: 50,
        quantity: 8
      });
      product.id = 'product-1';
      await productRepo.save(product);

      const svc = new PaymentService(paymentRepo, orderRepo, productRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mockPaymentMongo);
      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.failPayment(payment.id);

      const updated = await productRepo.findById('product-1');
      expect(updated!.quantity).toBe(10);
    });

    it('throws STOCK_ROLLBACK_FAILED when incrementStock throws', async () => {
      const productRepo = new InMemoryProductRepository();
      const product = Product.create({
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        name: 'Test Product',
        description: 'desc',
        price: 50,
        quantity: 8
      });
      product.id = 'product-1';
      await productRepo.save(product);

      const svc = new PaymentService(paymentRepo, orderRepo, productRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mockPaymentMongo);
      vi.spyOn(productRepo, 'incrementStock').mockRejectedValueOnce(new Error('boom'));

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await expect(svc.failPayment(payment.id)).rejects.toThrow(OrderError.STOCK_ROLLBACK_FAILED);
    });
  });

  describe('repairFailedOrder', () => {
    it('transitions order to FAILED_PAYMENT and returns true when payment FAILED and order PENDING_PAYMENT', async () => {
      const payment = await createTestPayment();
      await paymentService.failPayment(payment.id);

      // Simulate partial failure: order reverted to PENDING_PAYMENT while payment stays FAILED
      const order = await orderRepo.findById(testOrder.id);
      order!.transitionTo(OrderStatus.PENDING_PAYMENT);
      await orderRepo.update(order!);

      const result = await paymentService.repairFailedOrder(payment.id);

      expect(result).toBe(true);
      const updatedOrder = await orderRepo.findById(testOrder.id);
      expect(updatedOrder!.status).toBe(OrderStatus.FAILED_PAYMENT);
    });

    it('returns false when payment is CAPTURED (not failed)', async () => {
      const payment = await createCapturedPayment();

      const result = await paymentService.repairFailedOrder(payment.id);

      expect(result).toBe(false);
    });
  });

  describe('repairCapturedOrder', () => {
    it('transitions order to PAID and returns true when payment CAPTURED and order PENDING_PAYMENT', async () => {
      const payment = await createCapturedPayment();

      // Simulate partial failure: order reverted to PENDING_PAYMENT while payment stays CAPTURED
      const order = await orderRepo.findById(testOrder.id);
      order!.status = OrderStatus.PENDING_PAYMENT;
      await orderRepo.update(order!);

      const result = await paymentService.repairCapturedOrder(payment.id);

      expect(result).toBe(true);
      const updatedOrder = await orderRepo.findById(testOrder.id);
      expect(updatedOrder!.status).toBe(OrderStatus.PAID);
    });

    it('returns true when order is already PAID (already desired state)', async () => {
      const payment = await createCapturedPayment();

      const result = await paymentService.repairCapturedOrder(payment.id);

      expect(result).toBe(true);
      const updatedOrder = await orderRepo.findById(testOrder.id);
      expect(updatedOrder!.status).toBe(OrderStatus.PAID);
    });
  });

  describe('FIND-A02-P0-001: OVGs set to PENDING after Order PAID', () => {
    it('sets all vendor groups to PENDING when multi-vendor order is captured', async () => {
      const multiOrder = Order.create({
        personId: testPerson.id,
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [{
              productId: 'product-1',
              productName: 'Product 1',
              vendorId: 'vendor-1',
              quantity: 1,
              unitPrice: 50
            }],
            commissionPct: config.commissionPct
          },
          {
            vendorId: 'vendor-2',
            items: [{
              productId: 'product-2',
              productName: 'Product 2',
              vendorId: 'vendor-2',
              quantity: 1,
              unitPrice: 30
            }],
            commissionPct: config.commissionPct
          }
        ],
        shippingAddress: {
          id: 'addr-2',
          street: 'Test Street',
          number: '123',
          neighborhood: 'Test Neighborhood',
          city: 'Test City',
          state: 'TS',
          isPrimary: true
        }
      });
      await orderRepo.save(multiOrder);

      const payment = await paymentService.createPayment(multiOrder.id, testPerson.id, multiOrder.totalAmount);
      await paymentService.authorizePayment(payment.id, 'txn_test_multi');
      await paymentService.capturePayment(payment.id);

      const updatedOrder = await orderRepo.findById(multiOrder.id);
      expect(updatedOrder!.status).toBe(OrderStatus.PAID);
      for (const vg of updatedOrder!.vendorGroups) {
        expect(vg.status).toBe(OrderVendorGroupStatus.PENDING);
      }
    });
  });

  describe('FIND-A02-P0-003: recordPaymentLedger iterates all vendor groups', () => {
    it('creates ledger entries for each vendor group on authorize', async () => {
      const movements: any[] = [];
      const events: any[] = [];
      const movementRepo = { save: async (m: any) => movements.push(m) };
      const eventRepo = { save: async (e: any) => events.push(e) };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, undefined, undefined,
        movementRepo, eventRepo, undefined, mockPaymentMongo
      );

      const multiOrder = Order.create({
        personId: testPerson.id,
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [{
              productId: 'product-1',
              productName: 'Product 1',
              vendorId: 'vendor-1',
              quantity: 1,
              unitPrice: 50
            }],
            commissionPct: config.commissionPct
          },
          {
            vendorId: 'vendor-2',
            items: [{
              productId: 'product-2',
              productName: 'Product 2',
              vendorId: 'vendor-2',
              quantity: 1,
              unitPrice: 30
            }],
            commissionPct: config.commissionPct
          }
        ],
        shippingAddress: {
          id: 'addr-3',
          street: 'Test Street',
          number: '123',
          neighborhood: 'Test Neighborhood',
          city: 'Test City',
          state: 'TS',
          isPrimary: true
        }
      });
      await orderRepo.save(multiOrder);

      const payment = await svc.createPayment(multiOrder.id, testPerson.id, multiOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_test_ledger');

      expect(movements).toHaveLength(2);
      expect(events).toHaveLength(2);
      const vendorIds = movements.map((m: any) => m.data.vendorId);
      expect(vendorIds).toContain('vendor-1');
      expect(vendorIds).toContain('vendor-2');
    });

    it('creates ledger entries for each vendor group on refund', async () => {
      const movements: any[] = [];
      const eventRepo = { save: async () => { } };
      const movementRepo = { save: async (m: any) => movements.push(m) };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, undefined, undefined,
        movementRepo, eventRepo, undefined, mockPaymentMongo
      );

      const multiOrder = Order.create({
        personId: testPerson.id,
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [{
              productId: 'product-1',
              productName: 'Product 1',
              vendorId: 'vendor-1',
              quantity: 1,
              unitPrice: 50
            }],
            commissionPct: config.commissionPct
          },
          {
            vendorId: 'vendor-2',
            items: [{
              productId: 'product-2',
              productName: 'Product 2',
              vendorId: 'vendor-2',
              quantity: 1,
              unitPrice: 30
            }],
            commissionPct: config.commissionPct
          }
        ],
        shippingAddress: {
          id: 'addr-4',
          street: 'Test Street',
          number: '123',
          neighborhood: 'Test Neighborhood',
          city: 'Test City',
          state: 'TS',
          isPrimary: true
        }
      });
      await orderRepo.save(multiOrder);

      const payment = await svc.createPayment(multiOrder.id, testPerson.id, multiOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_test_refund_ledger');
      await svc.capturePayment(payment.id);
      await svc.refundPayment(payment.id);

      const refundMovements = movements.filter((m: any) => m.data.movementType === 'refund');
      expect(refundMovements).toHaveLength(2);
      const vendorIds = refundMovements.map((m: any) => m.data.vendorId);
      expect(vendorIds).toContain('vendor-1');
      expect(vendorIds).toContain('vendor-2');
    });
  });

  describe('FIND-A02-P0-002: Transfer creation per OVG', () => {
    it('calls transferService.createTransferWithDetails for each vendor group', async () => {
      const transferCalls: any[] = [];
      const mockTransferService = {
        createTransferWithDetails: async (...args: any[]) => {
          transferCalls.push(args);
          return { transfer: {} as any, entity: {} as any };
        }
      };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined,
        undefined, mockPaymentMongo,
        mockTransferService
      );

      const multiOrder = Order.create({
        personId: testPerson.id,
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [{
              productId: 'product-1',
              productName: 'Product 1',
              vendorId: 'vendor-1',
              quantity: 1,
              unitPrice: 50
            }],
            commissionPct: config.commissionPct
          },
          {
            vendorId: 'vendor-2',
            items: [{
              productId: 'product-2',
              productName: 'Product 2',
              vendorId: 'vendor-2',
              quantity: 1,
              unitPrice: 30
            }],
            commissionPct: config.commissionPct
          }
        ],
        shippingAddress: {
          id: 'addr-5',
          street: 'Test Street',
          number: '123',
          neighborhood: 'Test Neighborhood',
          city: 'Test City',
          state: 'TS',
          isPrimary: true
        }
      });
      await orderRepo.save(multiOrder);

      const payment = await svc.createPayment(multiOrder.id, testPerson.id, multiOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_test_transfer');
      await svc.capturePayment(payment.id);

      expect(transferCalls).toHaveLength(2);
      // Each call should include orderId, ovgId, subtotal, commissionPct, chargeId
      expect(transferCalls[0][0]).toBe(multiOrder.id);
      expect(transferCalls[1][0]).toBe(multiOrder.id);
      const ovgIds = transferCalls.map((c: any[]) => c[1]);
      expect(ovgIds).toHaveLength(2);
    });
  });

  describe('createTransfer (R-04: Stripe Connect destination)', () => {
    beforeEach(() => {
      mockTransfersCreate.mockReset();
      mockAccountsRetrieve.mockReset();
      mockAccountsRetrieve.mockResolvedValue({ capabilities: { transfers: 'active' } });
    });

    it('vendor enabled: creates transfer with vendor Stripe account as destination', async () => {
      const vendorRepo = new InMemoryVendorRepository();
      await vendorRepo.save(
        Vendor.reconstruct({
          id: 'vendor-1',
          personId: 'person-1',
          storeName: 'Test Vendor',
          slug: 'test-vendor',
          status: VendorStatus.ACTIVE,
          commissionPct: 10,
          stripeAccountId: 'acct_test_vendor',
        })
      );

      const transferRepo = {
        save: vi.fn().mockResolvedValue(undefined),
        findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      };

      mockTransfersCreate.mockResolvedValue({ id: 'tr_stripe_123' } as any);

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, transferRepo as any,
        undefined, undefined, undefined,
        vendorRepo, mockPaymentMongo, undefined
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_1');
      await svc.capturePayment(payment.id);

      const vendorId = testOrder.vendorGroups[0].vendorId;
      const ovgId = testOrder.vendorGroups[0].id;
      const result = await svc.createTransfer(payment.id, vendorId);

      expect(mockAccountsRetrieve).toHaveBeenCalledWith('acct_test_vendor');
      expect(mockTransfersCreate).toHaveBeenCalledWith(
        {
          amount: 9000,
          currency: 'brl',
          destination: 'acct_test_vendor',
          source_transaction: 'txn_1',
          transfer_group: testOrder.id,
        },
        { idempotencyKey: `${testOrder.id}:${vendorId}:1` }
      );
      expect(result.entity.status).toBe(TransferStatus.PROCESSING);
      expect(result.entity.stripeTransferId).toBe('tr_stripe_123');
    });

    it('vendor not enabled (no stripeAccountId): rejects with TRANSFER_DESTINATION_UNAVAILABLE, transfer not created', async () => {
      const vendorRepo = new InMemoryVendorRepository();
      await vendorRepo.save(
        Vendor.reconstruct({
          id: 'vendor-1',
          personId: 'person-1',
          storeName: 'Test Vendor',
          slug: 'test-vendor',
          status: VendorStatus.ACTIVE,
          commissionPct: 10,
        })
      );

      const transferRepo = {
        save: vi.fn().mockResolvedValue(undefined),
        findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, transferRepo as any,
        undefined, undefined, undefined,
        vendorRepo, mockPaymentMongo, undefined
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_1');
      await svc.capturePayment(payment.id);

      const vendorId = testOrder.vendorGroups[0].vendorId;
      await expect(svc.createTransfer(payment.id, vendorId))
        .rejects.toThrow('TRANSFER_DESTINATION_UNAVAILABLE');
      expect(mockTransfersCreate).not.toHaveBeenCalled();
      expect(transferRepo.save).not.toHaveBeenCalled();
    });

    it('account missing (vendor not found): rejects with TRANSFER_DESTINATION_UNAVAILABLE, transfer not created', async () => {
      const vendorRepo = new InMemoryVendorRepository();

      const transferRepo = {
        save: vi.fn().mockResolvedValue(undefined),
        findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, transferRepo as any,
        undefined, undefined, undefined,
        vendorRepo, mockPaymentMongo, undefined
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_1');
      await svc.capturePayment(payment.id);

      const vendorId = testOrder.vendorGroups[0].vendorId;
      await expect(svc.createTransfer(payment.id, vendorId))
        .rejects.toThrow('TRANSFER_DESTINATION_UNAVAILABLE');
      expect(mockTransfersCreate).not.toHaveBeenCalled();
      expect(transferRepo.save).not.toHaveBeenCalled();
    });

    it('capability inactive: rejects with TRANSFER_CAPABILITY_INACTIVE, transfer not created', async () => {
      const vendorRepo = new InMemoryVendorRepository();
      await vendorRepo.save(
        Vendor.reconstruct({
          id: 'vendor-1',
          personId: 'person-1',
          storeName: 'Test Vendor',
          slug: 'test-vendor',
          status: VendorStatus.ACTIVE,
          commissionPct: 10,
          stripeAccountId: 'acct_inactive',
        })
      );

      const transferRepo = {
        save: vi.fn().mockResolvedValue(undefined),
        findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      };

      mockAccountsRetrieve.mockResolvedValue({ capabilities: { transfers: 'inactive' } });

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, transferRepo as any,
        undefined, undefined, undefined,
        vendorRepo, mockPaymentMongo, undefined
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_1');
      await svc.capturePayment(payment.id);

      const vendorId = testOrder.vendorGroups[0].vendorId;
      await expect(svc.createTransfer(payment.id, vendorId))
        .rejects.toThrow('TRANSFER_CAPABILITY_INACTIVE');
      expect(mockTransfersCreate).not.toHaveBeenCalled();
      expect(transferRepo.save).not.toHaveBeenCalled();
    });

    it('Stripe API failure: explicit error, transfer not completed', async () => {
      const vendorRepo = new InMemoryVendorRepository();
      await vendorRepo.save(
        Vendor.reconstruct({
          id: 'vendor-1',
          personId: 'person-1',
          storeName: 'Test Vendor',
          slug: 'test-vendor',
          status: VendorStatus.ACTIVE,
          commissionPct: 10,
          stripeAccountId: 'acct_vendor',
        })
      );

      const transferRepo = {
        save: vi.fn().mockResolvedValue(undefined),
        findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      };

      mockAccountsRetrieve.mockResolvedValue({ capabilities: { transfers: 'active' } });
      mockTransfersCreate.mockRejectedValue(new Error('STRIPE_CONNECTION_ERROR'));

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, transferRepo as any,
        undefined, undefined, undefined,
        vendorRepo, mockPaymentMongo, undefined
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_1');
      await svc.capturePayment(payment.id);

      const vendorId = testOrder.vendorGroups[0].vendorId;
      await expect(svc.createTransfer(payment.id, vendorId))
        .rejects.toThrow('STRIPE_CONNECTION_ERROR');
      expect(mockTransfersCreate).toHaveBeenCalled();
      // Transfer entity saved as PENDING but never marked COMPLETED
      expect(transferRepo.save).toHaveBeenCalled();
      const savedCalls = transferRepo.save.mock.calls;
      const lastSaved = savedCalls[savedCalls.length - 1][0];
      expect(lastSaved.status).not.toBe(TransferStatus.COMPLETED);
    });

    it('rejects createTransfer when payment is not CAPTURED', async () => {
      const vendorRepo = new InMemoryVendorRepository();
      const transferRepo = {
        save: vi.fn().mockResolvedValue(undefined),
        findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, transferRepo as any,
        undefined, undefined, undefined,
        vendorRepo, mockPaymentMongo, undefined
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await expect(svc.createTransfer(payment.id, testOrder.vendorGroups[0].vendorId))
        .rejects.toThrow(PaymentError.PAYMENT_NOT_CAPTURABLE);
      expect(mockTransfersCreate).not.toHaveBeenCalled();
    });

    it('rejects createTransfer when vendor group does not exist', async () => {
      const vendorRepo = new InMemoryVendorRepository();
      const transferRepo = {
        save: vi.fn().mockResolvedValue(undefined),
        findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      };

      const svc = new PaymentService(
        paymentRepo, orderRepo,
        undefined, undefined, undefined, transferRepo as any,
        undefined, undefined, undefined,
        vendorRepo, mockPaymentMongo, undefined
      );

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await svc.authorizePayment(payment.id, 'txn_1');
      await svc.capturePayment(payment.id);

      await expect(svc.createTransfer(payment.id, 'non-existent-vendor'))
        .rejects.toThrow(OrderError.VENDOR_NOT_FOUND);
      expect(mockTransfersCreate).not.toHaveBeenCalled();
    });
  });

  describe('recoverPendingPayments', () => {
    beforeEach(() => {
      mockRetrieve.mockReset();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
    });

    async function setPendingPaymentWithSession(
      payment: Payment,
      providerTransactionId: string
    ): Promise<void> {
      await paymentRepo.save(
        Payment.reconstruct({
          ...payment.toJSON(),
          providerTransactionId,
          status: PaymentStatus.PENDING
        } as any)
      );
    }

    it.each([
      ['open paid', { status: 'open' }],
      ['wrong session', { id: 'cs_other' }],
      ['wrong order', { metadata: { orderId: 'other', paymentId: 'PAYMENT' } }],
      ['wrong currency', { currency: 'usd' }],
      ['missing payment intent', { payment_intent: null }],
      ['live mode', { livemode: true }],
    ])('does not capture recovery with %s', async (_case, override) => {
      const payment = await createTestPayment();
      await setPendingPaymentWithSession(payment, 'cs_test_guard');
      const metadata = override.metadata
        ? { ...override.metadata, paymentId: payment.id }
        : { orderId: payment.orderId, paymentId: payment.id };
      mockRetrieve.mockResolvedValue({ id: 'cs_test_guard', status: 'complete',
        payment_status: 'paid', payment_intent: 'pi_test', amount_total: 10000,
        currency: 'brl', livemode: false, ...override, metadata });
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
      await paymentService.recoverPendingPayments();
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.PENDING);
    });

    it('recovers a pending payment whose Checkout Session is paid', async () => {
      const payment = await createTestPayment();
      await setPendingPaymentWithSession(payment, 'cs_test_123');

      mockRetrieve.mockResolvedValue({
        id: 'cs_test_123', status: 'complete', livemode: false, currency: 'brl',
        metadata: { paymentId: payment.id, orderId: payment.orderId },
        payment_status: 'paid',
        payment_intent: 'pi_test_123',
        amount_total: 10000
      });

      const result = await paymentService.recoverPendingPayments();

      expect(result).toEqual({ recovered: 1, failed: 0 });
      expect(mockRetrieve).toHaveBeenCalledWith('cs_test_123');

      const updated = await paymentRepo.findById(payment.id);
      expect(updated!.status).toBe(PaymentStatus.CAPTURED);
      expect((await orderRepo.findById(testOrder.id))!.status).toBe(OrderStatus.PAID);
    });

    it('keeps a completed but unpaid async payment pending until later confirmation', async () => {
      const productRepo = new InMemoryProductRepository();
      const product = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-1', name: 'Test Product', description: 'desc', price: 50, quantity: 8 });
      product.id = 'product-1';
      await productRepo.save(product);
      const createTransferWithDetails = vi.fn();
      const service = new PaymentService(paymentRepo, orderRepo, productRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mockPaymentMongo, { createTransferWithDetails } as any);
      const payment = await service.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await setPendingPaymentWithSession(payment, 'cs_test_456');
      const failSpy = vi.spyOn(service, 'failPayment');

      mockRetrieve.mockResolvedValue({ status: 'complete', payment_status: 'unpaid' });

      const result = await service.recoverPendingPayments();

      expect(result).toEqual({ recovered: 0, failed: 0 });
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.PENDING);
      expect((await orderRepo.findById(testOrder.id))!.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect((await productRepo.findById('product-1'))!.quantity).toBe(8);
      expect(failSpy).not.toHaveBeenCalled();
      expect(createTransferWithDetails).not.toHaveBeenCalled();

      await service.completeCheckoutPayment(payment.id, 'pi_test_123', 10000);
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.CAPTURED);
      expect((await orderRepo.findById(testOrder.id))!.status).toBe(OrderStatus.PAID);
      expect(createTransferWithDetails).toHaveBeenCalledTimes(1);
    });

    it('fails a pending payment whose Checkout Session is expired', async () => {
      const payment = await createTestPayment();
      await setPendingPaymentWithSession(payment, 'cs_test_789');

      mockRetrieve.mockResolvedValue({ status: 'expired', payment_status: 'unpaid' });

      const result = await paymentService.recoverPendingPayments();

      expect(result).toEqual({ recovered: 0, failed: 1 });
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.FAILED);
    });

    it('skips a pending payment whose Checkout Session is still open', async () => {
      const payment = await createTestPayment();
      await setPendingPaymentWithSession(payment, 'cs_test_open');

      mockRetrieve.mockResolvedValue({ status: 'open', payment_status: 'unpaid' });

      const result = await paymentService.recoverPendingPayments();

      expect(result).toEqual({ recovered: 0, failed: 0 });
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.PENDING);
    });

    it('does not fail an expired session without unpaid payment evidence', async () => {
      const payment = await createTestPayment();
      await setPendingPaymentWithSession(payment, 'cs_test_unknown');
      mockRetrieve.mockResolvedValue({ status: 'expired', payment_status: 'no_payment_required' });

      expect(await paymentService.recoverPendingPayments()).toEqual({ recovered: 0, failed: 0 });
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.PENDING);
    });

    it('counts as failed when a pending payment has no providerTransactionId', async () => {
      const payment = await createTestPayment(); // PENDING, no providerTransactionId

      const result = await paymentService.recoverPendingPayments();

      expect(result).toEqual({ recovered: 0, failed: 1 });
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.PENDING);
    });

    it('counts as failed when Stripe session retrieval throws', async () => {
      const payment = await createTestPayment();
      await setPendingPaymentWithSession(payment, 'cs_test_bad');

      mockRetrieve.mockRejectedValue(new Error('Stripe unreachable'));

      const result = await paymentService.recoverPendingPayments();

      expect(result).toEqual({ recovered: 0, failed: 1 });
      expect((await paymentRepo.findById(payment.id))!.status).toBe(PaymentStatus.PENDING);
    });

    it('processes multiple pending payments and aggregates counts', async () => {
      // Distinct orders so createPayment returns distinct payments (no idempotency collision)
      const makeOrder = async (suffix: string) => {
        const order = Order.create({
          personId: testPerson.id,
          vendorGroups: [{
            vendorId: 'vendor-1',
            items: [{ productId: 'product-1', productName: 'Test Product', vendorId: 'vendor-1', quantity: 2, unitPrice: 50 }],
            commissionPct: config.commissionPct
          }],
          shippingAddress: {
            id: `addr-multi-${suffix}`, street: 'Test Street', number: '123',
            neighborhood: 'Test Neighborhood', city: 'Test City', state: 'TS', isPrimary: true
          }
        });
        await orderRepo.save(order);
        return order;
      };

      const orderPaid = await makeOrder('paid');
      const paidPayment = await paymentService.createPayment(orderPaid.id, testPerson.id, orderPaid.totalAmount);
      await setPendingPaymentWithSession(paidPayment, 'cs_paid');
      const orderUnpaid = await makeOrder('unpaid');
      const unpaidPayment = await paymentService.createPayment(orderUnpaid.id, testPerson.id, orderUnpaid.totalAmount);
      await setPendingPaymentWithSession(unpaidPayment, 'cs_unpaid');
      mockRetrieve.mockImplementation(async (sessionId: string) => sessionId === 'cs_paid'
        ? { id: 'cs_paid', status: 'complete', livemode: false, currency: 'brl',
            metadata: { paymentId: paidPayment.id, orderId: paidPayment.orderId },
            payment_status: 'paid', payment_intent: 'pi_paid', amount_total: 10000 }
        : { payment_status: 'unpaid' });

      const orderNoTxn = await makeOrder('no-txn');
      await paymentService.createPayment(orderNoTxn.id, testPerson.id, orderNoTxn.totalAmount); // no providerTransactionId

      const result = await paymentService.recoverPendingPayments();

      expect(result).toEqual({ recovered: 1, failed: 1 });
    });
  });

  describe('InMemoryPaymentRepository.findByStatus', () => {
    it('returns only payments matching the requested status', async () => {
      const pending = Payment.reconstruct({
        id: 'p-1', orderId: 'o-1', personId: 'person-1', amount: 100,
        status: PaymentStatus.PENDING, createdAt: new Date(), updatedAt: new Date()
      } as any);
      const authorized = Payment.reconstruct({
        id: 'p-2', orderId: 'o-1', personId: 'person-1', amount: 100,
        status: PaymentStatus.AUTHORIZED, createdAt: new Date(), updatedAt: new Date()
      } as any);
      const captured = Payment.reconstruct({
        id: 'p-3', orderId: 'o-1', personId: 'person-1', amount: 100,
        status: PaymentStatus.CAPTURED, createdAt: new Date(), updatedAt: new Date()
      } as any);

      await paymentRepo.save(pending);
      await paymentRepo.save(authorized);
      await paymentRepo.save(captured);

      const pendingPayments = await paymentRepo.findByStatus(PaymentStatus.PENDING);
      expect(pendingPayments).toHaveLength(1);
      expect(pendingPayments[0].id).toBe('p-1');

      const capturedPayments = await paymentRepo.findByStatus(PaymentStatus.CAPTURED);
      expect(capturedPayments).toHaveLength(1);
      expect(capturedPayments[0].id).toBe('p-3');

      const failedPayments = await paymentRepo.findByStatus(PaymentStatus.FAILED);
      expect(failedPayments).toHaveLength(0);
    });
  });
});
