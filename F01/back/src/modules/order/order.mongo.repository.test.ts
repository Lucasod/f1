import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Order, OrderStatus, OrderVendorGroupStatus, FinancialStatus, Address, OrderRepository } from './order.domain';
import { MongoOrderRepository } from './order.mongo.repository';

// Test database configuration
const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB_NAME_BASE = 'fs01_marketplace_test';
const TEST_DB_NAME_SUFFIX = `_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const TEST_DB_NAME = `${TEST_DB_NAME_BASE}${TEST_DB_NAME_SUFFIX}`;

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

describeIfMongo('MongoOrderRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let ordersCollection: Collection;
  let repo: OrderRepository;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);
    global.__testDbName = TEST_DB_NAME;
    
    ordersCollection = db.collection('orders');
    
    // Create indexes
    await ordersCollection.createIndex({ personId: 1, createdAt: -1 });
    await ordersCollection.createIndex({ status: 1, createdAt: -1 });
    await ordersCollection.createIndex({ 'vendorGroups.vendorId': 1 });
    await ordersCollection.createIndex({ createdAt: -1 });
  });

  afterAll(async () => {
    await db?.dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    // Clear orders collection before each test
    await ordersCollection.deleteMany({});
    
    // Create repository instance
    repo = new MongoOrderRepository(db);
  });

  describe('MongoOrderRepository - Contract Compliance', () => {
    it('should implement OrderRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findByPersonId).toBe('function');
      expect(typeof repo.findByStatus).toBe('function');
      expect(typeof repo.findAll).toBe('function');
      expect(typeof repo.update).toBe('function');
    });

    it('should save and find order by ID', async () => {
      const order = createTestOrder();

      await repo.save(order);
      const found = await repo.findById(order.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(order.id);
      expect(found!.personId).toBe(order.personId);
      expect(found!.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(found!.vendorGroups).toHaveLength(1);
      expect(found!.totalAmount).toBe(150);
    });

    it('should find orders by person ID', async () => {
      const order1 = createTestOrder({ personId: 'person-1' });
      const order2 = createTestOrder({ personId: 'person-1' });
      const order3 = createTestOrder({ personId: 'person-2' });

      await repo.save(order1);
      await repo.save(order2);
      await repo.save(order3);

      const person1Orders = await repo.findByPersonId('person-1');
      const person2Orders = await repo.findByPersonId('person-2');

      expect(person1Orders).toHaveLength(2);
      expect(person2Orders).toHaveLength(1);
      expect(person1Orders[0].personId).toBe('person-1');
      expect(person2Orders[0].personId).toBe('person-2');
    });

    it('should find orders by status', async () => {
      const order1 = createTestOrder();
      const order2 = createTestOrder();
      const order3 = createTestOrder();

      // Save all as PENDING_PAYMENT first (real flow)
      await repo.save(order1);
      await repo.save(order2);
      await repo.save(order3);

      // Transition and re-save as PAID
      order2.transitionTo(OrderStatus.PAID);
      order3.transitionTo(OrderStatus.PAID);
      await repo.save(order2);
      await repo.save(order3);

      const pendingOrders = await repo.findByStatus(OrderStatus.PENDING_PAYMENT);
      const paidOrders = await repo.findByStatus(OrderStatus.PAID);

      expect(pendingOrders).toHaveLength(1);
      expect(paidOrders).toHaveLength(2);
      expect(pendingOrders[0].status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(paidOrders.every(o => o.status === OrderStatus.PAID)).toBe(true);
    });

    it('should find all orders sorted by createdAt descending', async () => {
      const order1 = createTestOrder();
      // Wait to ensure different createdAt timestamps
      await new Promise(resolve => setTimeout(resolve, 20));
      const order2 = createTestOrder();
      await new Promise(resolve => setTimeout(resolve, 20));
      const order3 = createTestOrder();

      await repo.save(order1);
      await repo.save(order2);
      await repo.save(order3);

      const allOrders = await repo.findAll();

      expect(allOrders).toHaveLength(3);
      // Should be sorted by createdAt descending (newest first)
      expect(allOrders[0].id).toBe(order3.id);
      expect(allOrders[1].id).toBe(order2.id);
      expect(allOrders[2].id).toBe(order1.id);
    });

    it('should update existing order', async () => {
      const order = createTestOrder();
      await repo.save(order);

      const found = await repo.findById(order.id);
      expect(found).not.toBeNull();
      
      found!.transitionTo(OrderStatus.PAID);
      found!.markPaymentAuthorized();
      await repo.update(found!);

      const updated = await repo.findById(order.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe(OrderStatus.PAID);
    });

    it('should persist and retrieve all Order fields including vendor groups and items', async () => {
      const order = createTestOrder({
        vendorGroups: [
          {
            vendorId: 'vendor-1',
            items: [
              { productId: 'prod-1', productName: 'Product 1', vendorId: 'vendor-1', quantity: 2, unitPrice: 50 },
              { productId: 'prod-2', productName: 'Product 2', vendorId: 'vendor-1', quantity: 1, unitPrice: 30 }
            ],
            commissionPct: 10
          },
          {
            vendorId: 'vendor-2',
            items: [
              { productId: 'prod-3', productName: 'Product 3', vendorId: 'vendor-2', quantity: 1, unitPrice: 100 }
            ],
            commissionPct: 15
          }
        ]
      });

      await repo.save(order);
      const found = await repo.findById(order.id);

      expect(found).not.toBeNull();
      expect(found!.vendorGroups).toHaveLength(2);
      expect(found!.vendorGroups[0].vendorId).toBe('vendor-1');
      expect(found!.vendorGroups[0].items).toHaveLength(2);
      expect(found!.vendorGroups[0].items[0].productName).toBe('Product 1');
      expect(found!.vendorGroups[0].items[0].quantity).toBe(2);
      expect(found!.vendorGroups[0].items[0].totalPrice).toBe(100);
      expect(found!.vendorGroups[1].vendorId).toBe('vendor-2');
      expect(found!.vendorGroups[1].items).toHaveLength(1);
      expect(found!.vendorGroups[1].items[0].productName).toBe('Product 3');
      expect(found!.totalAmount).toBe(230); // 130 + 100
      expect(found!.financialStatus).toBe(FinancialStatus.PENDING);
      expect(found!.shippingAddress.street).toBe('Rua Teste');
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist vendor group status transitions', async () => {
      const order = createTestOrder();
      await repo.save(order);

      const found = await repo.findById(order.id);
      expect(found).not.toBeNull();
      
      found!.updateVendorGroupStatus('vendor-1', OrderVendorGroupStatus.CONFIRMED);
      await repo.update(found!);

      const updated = await repo.findById(order.id);
      expect(updated).not.toBeNull();
      expect(updated!.vendorGroups[0].status).toBe(OrderVendorGroupStatus.CONFIRMED);
    });

    it('should persist shipping address', async () => {
      const address: Address = {
        id: 'addr-1',
        street: 'Av. Principal',
        number: '1000',
        neighborhood: 'Centro',
        city: 'Rio de Janeiro',
        state: 'RJ',
        isPrimary: true
      };

      const order = createTestOrder({ shippingAddress: address });
      await repo.save(order);

      const found = await repo.findById(order.id);
      expect(found).not.toBeNull();
      expect(found!.shippingAddress.street).toBe('Av. Principal');
      expect(found!.shippingAddress.city).toBe('Rio de Janeiro');
      expect(found!.shippingAddress.state).toBe('RJ');
    });

    it('should return null for non-existent order', async () => {
      const found = await repo.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should return empty array for person with no orders', async () => {
      const orders = await repo.findByPersonId('non-existent-person');
      expect(orders).toEqual([]);
    });

    it('should return empty array for status with no orders', async () => {
      const orders = await repo.findByStatus(OrderStatus.DELIVERED);
      expect(orders).toEqual([]);
    });
  });
});

function createTestOrder(overrides: Partial<{
  personId: string;
  vendorGroups: { vendorId: string; items: { productId: string; productName: string; vendorId: string; quantity: number; unitPrice: number }[]; commissionPct: number }[];
  shippingAddress: Address;
}> = {}): Order {
  return Order.create({
    personId: overrides.personId ?? 'test-person-1',
    vendorGroups: overrides.vendorGroups ?? [
      {
        vendorId: 'vendor-1',
        items: [
          { productId: 'prod-1', productName: 'Test Product', vendorId: 'vendor-1', quantity: 1, unitPrice: 100 },
          { productId: 'prod-2', productName: 'Another Product', vendorId: 'vendor-1', quantity: 2, unitPrice: 25 }
        ],
        commissionPct: 10
      }
    ],
    shippingAddress: overrides.shippingAddress ?? {
      id: 'addr-1',
      street: 'Rua Teste',
      number: '123',
      neighborhood: 'Bairro Teste',
      city: 'São Paulo',
      state: 'SP',
      isPrimary: true
    }
  });
}