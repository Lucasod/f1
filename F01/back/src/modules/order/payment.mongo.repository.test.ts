import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Payment, PaymentStatus, PaymentRepository, OrderError } from './order.domain';
import { MongoPaymentRepository } from './payment.mongo.repository';

// Test database configuration
const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB_NAME = 'fs01_marketplace_test';

// MongoDB availability check utility
async function isMongoAvailable(uri: string): Promise<boolean> {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

// Check MongoDB availability before registering tests
const mongoAvailable = await isMongoAvailable(TEST_MONGO_URI);
const describeIfMongo = mongoAvailable
  ? describe
  : (name: string, fn: () => void) => describe.skip(`${name} (MongoDB unavailable at ${TEST_MONGO_URI})`, fn);

describeIfMongo('MongoPaymentRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let paymentsCollection: Collection;
  let repo: PaymentRepository;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);
    
    paymentsCollection = db.collection('payments');
    
    // Create indexes
    await paymentsCollection.createIndex({ orderId: 1, createdAt: -1 });
    await paymentsCollection.createIndex({ personId: 1, createdAt: -1 });
    await paymentsCollection.createIndex({ status: 1 });
    await paymentsCollection.createIndex({ providerTransactionId: 1 }, { unique: true, sparse: true });
    await paymentsCollection.createIndex({ createdAt: -1 });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    // Clear collections before each test
    await paymentsCollection.deleteMany({});
    
    // Create repository instance
    repo = new MongoPaymentRepository(db);
  });

  describe('MongoPaymentRepository - Contract Compliance', () => {
    it('should implement PaymentRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findByOrderId).toBe('function');
      expect(typeof repo.findByPersonId).toBe('function');
      expect(typeof repo.update).toBe('function');
    });

    it('should save and find payment by ID', async () => {
      const payment = createTestPayment();

      await repo.save(payment);
      const found = await repo.findById(payment.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(payment.id);
      expect(found!.orderId).toBe(payment.orderId);
      expect(found!.personId).toBe(payment.personId);
      expect(found!.amount).toBe(payment.amount);
      expect(found!.status).toBe(PaymentStatus.PENDING);
    });

    it('should find payments by order ID', async () => {
      const payment1 = createTestPayment({ orderId: 'order-1', amount: 100 });
      const payment2 = createTestPayment({ orderId: 'order-1', amount: 50 });
      const payment3 = createTestPayment({ orderId: 'order-2', amount: 200 });

      await repo.save(payment1);
      await repo.save(payment2);
      await repo.save(payment3);

      const order1Payments = await repo.findByOrderId('order-1');
      const order2Payments = await repo.findByOrderId('order-2');

      expect(order1Payments).toHaveLength(2);
      expect(order2Payments).toHaveLength(1);
      expect(order1Payments.every(p => p.orderId === 'order-1')).toBe(true);
      expect(order2Payments[0].orderId).toBe('order-2');
    });

    it('should find payments by person ID', async () => {
      const payment1 = createTestPayment({ personId: 'person-1', amount: 100 });
      const payment2 = createTestPayment({ personId: 'person-1', amount: 50 });
      const payment3 = createTestPayment({ personId: 'person-2', amount: 200 });

      await repo.save(payment1);
      await repo.save(payment2);
      await repo.save(payment3);

      const person1Payments = await repo.findByPersonId('person-1');
      const person2Payments = await repo.findByPersonId('person-2');

      expect(person1Payments).toHaveLength(2);
      expect(person2Payments).toHaveLength(1);
      expect(person1Payments.every(p => p.personId === 'person-1')).toBe(true);
      expect(person2Payments[0].personId).toBe('person-2');
    });

    it('should find all payments sorted by createdAt descending', async () => {
      const payment1 = createTestPayment({ orderId: 'order-1' });
      // Wait to ensure different createdAt timestamps
      await new Promise(resolve => setTimeout(resolve, 20));
      const payment2 = createTestPayment({ orderId: 'order-2' });
      await new Promise(resolve => setTimeout(resolve, 20));
      const payment3 = createTestPayment({ orderId: 'order-3' });

      await repo.save(payment1);
      await repo.save(payment2);
      await repo.save(payment3);

      // Use findByPersonId to test ordering
      const allForPerson = await repo.findByPersonId('test-person');

      expect(allForPerson).toHaveLength(3);
      // Should be sorted by createdAt descending (newest first)
      expect(allForPerson[0].id).toBe(payment3.id);
      expect(allForPerson[1].id).toBe(payment2.id);
      expect(allForPerson[2].id).toBe(payment1.id);
    });

    it('should update existing payment', async () => {
      const payment = createTestPayment();
      await repo.save(payment);

      const found = await repo.findById(payment.id);
      expect(found).not.toBeNull();
      
      found!.authorize('txn-12345');
      await repo.update(found!);

      const updated = await repo.findById(payment.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe(PaymentStatus.AUTHORIZED);
      expect(updated!.providerTransactionId).toBe('txn-12345');
      expect(updated!.authorizedAt).toBeInstanceOf(Date);
    });

    it('should persist all Payment fields', async () => {
      const payment = createTestPayment({
        provider: 'stripe',
        amount: 299.99
      });

      await repo.save(payment);
      const found = await repo.findById(payment.id);

      expect(found).not.toBeNull();
      expect(found!.provider).toBe('stripe');
      expect(found!.amount).toBe(299.99);
      expect(found!.status).toBe(PaymentStatus.PENDING);
      expect(found!.orderId).toBe('test-order-1');
      expect(found!.personId).toBe('test-person');
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist payment status transitions', async () => {
      const payment = createTestPayment();
      await repo.save(payment);

      const found = await repo.findById(payment.id);
      expect(found).not.toBeNull();
      
      // Authorize
      found!.authorize('txn-auth-123');
      await repo.update(found!);
      
      let updated = await repo.findById(payment.id);
      expect(updated!.status).toBe(PaymentStatus.AUTHORIZED);
      expect(updated!.authorizedAt).toBeInstanceOf(Date);
      expect(updated!.providerTransactionId).toBe('txn-auth-123');
      
      // Capture
      updated!.capture();
      await repo.update(updated!);
      
      updated = await repo.findById(payment.id);
      expect(updated!.status).toBe(PaymentStatus.CAPTURED);
      expect(updated!.capturedAt).toBeInstanceOf(Date);
      
      // Refund
      updated!.refund();
      await repo.update(updated!);
      
      updated = await repo.findById(payment.id);
      expect(updated!.status).toBe(PaymentStatus.REFUNDED);
      expect(updated!.refundedAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent payment', async () => {
      const found = await repo.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should return empty array for order with no payments', async () => {
      const payments = await repo.findByOrderId('non-existent-order');
      expect(payments).toEqual([]);
    });

    it('should return empty array for person with no payments', async () => {
      const payments = await repo.findByPersonId('non-existent-person');
      expect(payments).toEqual([]);
    });

    it('should handle provider transaction ID uniqueness', async () => {
      const payment1 = createTestPayment({ orderId: 'order-1' });
      await repo.save(payment1);
      
      const found1 = await repo.findById(payment1.id);
      expect(found1).not.toBeNull();
      found1!.authorize('txn-unique-123');
      await repo.update(found1!);

      // Create another payment and try to use same providerTransactionId
      const payment2 = createTestPayment({ orderId: 'order-2' });
      await repo.save(payment2);
      
      const found2 = await repo.findById(payment2.id);
      expect(found2).not.toBeNull();
      found2!.authorize('txn-unique-123'); // Same transaction ID
      
      // The unique sparse index should prevent duplicate providerTransactionId
      // Note: MongoDB unique sparse index allows multiple nulls but only one non-null value
      await expect(repo.update(found2!)).rejects.toThrow();
    });
  });
});

function createTestPayment(overrides: Partial<{
  orderId: string;
  personId: string;
  amount: number;
  provider: string;
}> = {}): Payment {
  return Payment.create({
    orderId: overrides.orderId ?? 'test-order-1',
    personId: overrides.personId ?? 'test-person',
    amount: overrides.amount ?? 150,
    provider: overrides.provider ?? 'mock'
  });
}