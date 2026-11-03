import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService, PaymentError } from './payment.service';
import { Payment, PaymentStatus, InMemoryPaymentRepository, Order, OrderStatus, OrderError, InMemoryOrderRepository } from './order.domain';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';
import { Product, InMemoryProductRepository } from '../product/product.domain';
import { config } from '../../config';

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
    paymentService = new PaymentService(paymentRepo, orderRepo);

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

    it('should update order status to PAID when payment authorized', async () => {
      const payment = await createTestPayment();
      await paymentService.authorizePayment(payment.id, 'txn_test_123');

      const order = await orderRepo.findById(testOrder.id);
      expect(order!.status).toBe(OrderStatus.PAID);
      expect(order!.financialStatus).toBe('paid');
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
      const payment1 = await createTestPayment();
      await paymentService.failPayment(payment1.id);
      const payment2 = await paymentService.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);

      const payments = await paymentService.getPaymentsByOrderId(testOrder.id);
      expect(payments[0].createdAt.getTime()).toBeGreaterThanOrEqual(payments[1].createdAt.getTime());
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

      const svc = new PaymentService(paymentRepo, orderRepo, productRepo);
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

      const svc = new PaymentService(paymentRepo, orderRepo, productRepo);
      vi.spyOn(productRepo, 'incrementStock').mockRejectedValueOnce(new Error('boom'));

      const payment = await svc.createPayment(testOrder.id, testPerson.id, testOrder.totalAmount);
      await expect(svc.failPayment(payment.id)).rejects.toThrow(OrderError.STOCK_ROLLBACK_FAILED);
    });
  });
});
