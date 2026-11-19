import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { InMemoryPersonRepository, Person, PersonRole } from '../person/person.domain';
import { InMemoryVendorRepository, Vendor } from '../vendor/vendor.domain';
import { config } from '../../config';
import { hashPassword } from '../auth/credential.domain';
import {
  InMemoryOrderRepository,
  InMemoryPaymentRepository,
  Order,
  OrderStatus,
  OrderVendorGroupStatus,
  DisputeStatus,
  DisputeType,
  DisputeResolution,
} from './order.domain';
import { OrderService } from './order.service';
import { createOrderRoutes } from './order.routes';
describe('Order routes ownership', () => {
  let app: express.Express;
  let ownerToken: string;
  let otherConsumerToken: string;
  let adminToken: string;
  let orderId: string;
  let ownerPersonId: string;
  let otherConsumerPersonId: string;
  let personRepository: InMemoryPersonRepository;
  let orderRepository: InMemoryOrderRepository;
  let authService: AuthService;
  let ownerEmail: string;
  const password = process.env.TEST_USER_PASSWORD!;

  beforeEach(async () => {
    personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');
    ownerEmail = 'order-owner@example.com';
    const owner = await authService.register({
      name: 'Order Owner',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: ownerEmail,
      password: password,
      role: PersonRole.CONSUMER,
    });
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'other-consumer@example.com',
      password: password,
      role: PersonRole.CONSUMER,
    });
    ownerToken = owner.tokens.accessToken;
    ownerPersonId = owner.person.id;
    otherConsumerToken = otherConsumer.tokens.accessToken;
    otherConsumerPersonId = otherConsumer.person.id;

    const adminPerson = Person.create({
      name: 'Marketplace Admin',
      mainInfo: {
        name: 'Marketplace Admin',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000262',
      },
      contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
      addresses: [],
    });
    adminPerson.addRole(PersonRole.ADMIN);
    adminPerson.setCredential(await hashPassword(password));
    await personRepository.save(adminPerson);
    adminToken = (await authService.login({
      email: 'admin@example.com',
      password: password,
    })).tokens.accessToken;

    orderRepository = new InMemoryOrderRepository();
    const paymentRepository = new InMemoryPaymentRepository();
    const vendorRepository = new InMemoryVendorRepository();
    const order = Order.create({
      personId: owner.person.id,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'order-product',
          productName: 'Order Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 25,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    orderId = order.id;
    await orderRepository.save(order);

    const orderService = new OrderService(
      orderRepository,
      paymentRepository,
      personRepository,
      vendorRepository,
      config,
    );
    app = express();
    app.use(express.json());
    app.use('/api/v1', createOrderRoutes({
      authService,
      orderService,
      personRepo: personRepository,
      vendorRepo: vendorRepository,
    }));
  });

  it('limits consumer order lists and details to orders owned by the authenticated person', async () => {
    const ownerList = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(ownerList.body.total).toBe(1);
    expect(ownerList.body.orders[0].id).toBe(orderId);

    const otherList = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${otherConsumerToken}`)
      .expect(200);
    expect(otherList.body.total).toBe(0);
    expect(otherList.body.orders).toHaveLength(0);

    await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${otherConsumerToken}`)
      .expect(404);
  });

  it('allows Admins to view marketplace orders while preserving Consumer ownership limits', async () => {
    const otherOrder = Order.create({
      personId: otherConsumerPersonId,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'other-order-product',
          productName: 'Other Order Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 40,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'other-delivery-address',
        street: 'Second Street',
        number: '2',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    await orderRepository.save(otherOrder);

    const adminList = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminList.body.total).toBe(2);
    expect(adminList.body.orders.map((order: { id: string }) => order.id))
      .toEqual(expect.arrayContaining([orderId, otherOrder.id]));

    await request(app)
      .get(`/api/v1/orders/${otherOrder.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const consumerList = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(consumerList.body.total).toBe(1);
    expect(consumerList.body.orders.map((order: { id: string }) => order.id)).toEqual([orderId]);

    await request(app)
      .get(`/api/v1/orders/${otherOrder.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it("returns a consumer dashboard summary using only that consumer's orders", async () => {
    const paidOrder = Order.create({
      personId: ownerPersonId,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'paid-order-product',
          productName: 'Paid Order Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 50,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    paidOrder.markPaymentAuthorized();
    await orderRepository.save(paidOrder);

    const refundedOrder = Order.create({
      personId: ownerPersonId,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'refunded-order-product',
          productName: 'Refunded Order Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 75,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    refundedOrder.markPaymentAuthorized();
    refundedOrder.refund();
    await orderRepository.save(refundedOrder);

    const ownerSummary = await request(app)
      .get('/api/v1/orders/summary')
      .set('Authorization', ['Bearer', ownerToken].join(' '))
      .expect(200);
    expect(ownerSummary.body.summary.totalOrders).toBe(3);
    expect(ownerSummary.body.summary.totalSpent).toBe(50);
    expect(ownerSummary.body.summary.recentOrders).toHaveLength(3);
    expect(ownerSummary.body.summary.recentOrders[0].personId).toBe(ownerPersonId);

    const otherSummary = await request(app)
      .get('/api/v1/orders/summary')
      .set('Authorization', ['Bearer', otherConsumerToken].join(' '))
      .expect(200);
    expect(otherSummary.body.summary.totalOrders).toBe(0);
    expect(otherSummary.body.summary.recentOrders).toHaveLength(0);
  });

  it('preserves consumer order access when the same person also has the vendor role', async () => {
    const owner = await personRepository.findByEmail(ownerEmail);
    owner!.addRole(PersonRole.VENDOR);
    await personRepository.update(owner!);
    ownerToken = (await authService.login({
      email: ownerEmail,
      password: password,
    })).tokens.accessToken;

    const list = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', ['Bearer', ownerToken].join(' '))
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.orders[0].personId).toBe(owner!.id);

    const detail = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', ['Bearer', ownerToken].join(' '))
      .expect(200);
    expect(detail.body.order.personId).toBe(owner!.id);
  });
});

describe('Dual-role authorization regression', () => {
  let app: express.Express;
  let dualRoleToken: string;
  let consumerToken: string;
  let vendorToken: string;
  let otherVendorToken: string;
  let adminToken: string;
  let dualRolePersonId: string;
  let consumerPersonId: string;
  let vendorPersonId: string;
  let otherVendorPersonId: string;
  let vendorId: string;
  let vendorId2: string;
  let otherVendorId: string;
  let orderId: string;
  let otherOrderId: string;
  let vendorOrderId: string;
  let personRepository: InMemoryPersonRepository;
  let orderRepository: InMemoryOrderRepository;
  let vendorRepository: InMemoryVendorRepository;
  let authService: AuthService;
  const password = process.env.TEST_USER_PASSWORD!;

  beforeEach(async () => {
    personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');

    // Create a dual-role user (CONSUMER + VENDOR)
    const dualRoleUser = await authService.register({
      name: 'Dual Role User',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'dual-role@example.com',
      password: password,
      role: PersonRole.CONSUMER,
    });
    const dualRolePerson = await personRepository.findByEmail('dual-role@example.com');
    dualRolePerson!.addRole(PersonRole.VENDOR);
    await personRepository.update(dualRolePerson!);
    dualRoleToken = (await authService.login({
      email: 'dual-role@example.com',
      password: password,
    })).tokens.accessToken;
    dualRolePersonId = dualRolePerson!.id;

    // Create a pure consumer
    const consumer = await authService.register({
      name: 'Pure Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'pure-consumer@example.com',
      password: password,
      role: PersonRole.CONSUMER,
    });
    consumerToken = consumer.tokens.accessToken;
    consumerPersonId = consumer.person.id;

    // Create a vendor user (separate from dual-role user)
    const vendorPerson = await authService.register({
      name: 'Test Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000181',
      email: 'vendor@example.com',
      password: password,
      role: PersonRole.VENDOR,
    });
    vendorToken = vendorPerson.tokens.accessToken;
    vendorPersonId = vendorPerson.person.id;

    // Create another vendor user
    const otherVendorPerson = await authService.register({
      name: 'Other Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000343',
      email: 'other-vendor@example.com',
      password: password,
      role: PersonRole.VENDOR,
    });
    otherVendorToken = otherVendorPerson.tokens.accessToken;
    otherVendorPersonId = otherVendorPerson.person.id;

    // Create admin
    const adminPerson = Person.create({
      name: 'Marketplace Admin',
      mainInfo: { name: 'Marketplace Admin', taxIdType: 'CNPJ', taxIdValue: '11222333000262' },
      contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
      addresses: [],
    });
    adminPerson.addRole(PersonRole.ADMIN);
    adminPerson.setCredential(await hashPassword(password));
    await personRepository.save(adminPerson);
    adminToken = (await authService.login({
      email: 'admin@example.com',
      password: password,
    })).tokens.accessToken;

    orderRepository = new InMemoryOrderRepository();
    const paymentRepository = new InMemoryPaymentRepository();
    vendorRepository = new InMemoryVendorRepository();

    // Create vendor profile for dual-role user
    const dualRoleVendor = Vendor.create({
      personId: dualRolePersonId,
      storeName: 'Dual Role Store',
      slug: 'dual-role-store',
      commissionPct: config.commissionPct,
    });
    vendorId = dualRoleVendor.id;
    await vendorRepository.save(dualRoleVendor);

    // Create vendor profile for vendor user (separate vendor)
    const vendor = Vendor.create({
      personId: vendorPersonId,
      storeName: 'Test Store',
      slug: 'test-store',
      commissionPct: config.commissionPct,
    });
    vendorId2 = vendor.id;
    await vendorRepository.save(vendor);

    // Create vendor profile for other vendor
    const otherVendor = Vendor.create({
      personId: otherVendorPersonId,
      storeName: 'Other Store',
      slug: 'other-store',
      commissionPct: config.commissionPct,
    });
    otherVendorId = otherVendor.id;
    await vendorRepository.save(otherVendor);

    // Create order where dual-role user is the buyer (consumer) from vendor user's store (vendorId2)
    const order = Order.create({
      personId: dualRolePersonId,
      vendorGroups: [{
        vendorId: vendorId2,
        items: [{
          productId: 'order-product',
          productName: 'Order Product',
          vendorId: vendorId2,
          quantity: 1,
          unitPrice: 25,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    orderId = order.id;
    await orderRepository.save(order);

    // Create order where vendor user is the vendor (for testing vendor access)
    const vendorOrder = Order.create({
      personId: consumerPersonId,
      vendorGroups: [{
        vendorId: vendorId2,
        items: [{
          productId: 'vendor-order-product',
          productName: 'Vendor Order Product',
          vendorId: vendorId2,
          quantity: 1,
          unitPrice: 25,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'vendor-delivery-address',
        street: 'Vendor Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    vendorOrderId = vendorOrder.id;
    await orderRepository.save(vendorOrder);

    // Create another order where pure consumer buys from other vendor
    const otherOrder = Order.create({
      personId: consumerPersonId,
      vendorGroups: [{
        vendorId: otherVendorId,
        items: [{
          productId: 'other-order-product',
          productName: 'Other Order Product',
          vendorId: otherVendorId,
          quantity: 1,
          unitPrice: 30,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'other-delivery-address',
        street: 'Second Street',
        number: '2',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    otherOrderId = otherOrder.id;
    await orderRepository.save(otherOrder);

    // Create order where dual-role user is the vendor (for testing vendor fulfillment)
    const dualRoleVendorOrder = Order.create({
      personId: consumerPersonId,
      vendorGroups: [{
        vendorId: vendorId,  // Dual-role user's vendor
        items: [{
          productId: 'dual-vendor-product',
          productName: 'Dual Vendor Product',
          vendorId: vendorId,
          quantity: 1,
          unitPrice: 40,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'dual-vendor-address',
        street: 'Dual Vendor Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    await orderRepository.save(dualRoleVendorOrder);

    const orderService = new OrderService(
      orderRepository,
      paymentRepository,
      personRepository,
      vendorRepository,
      config,
    );
    app = express();
    app.use(express.json());
    app.use('/api/v1', createOrderRoutes({
      authService,
      orderService,
      personRepo: personRepository,
      vendorRepo: vendorRepository,
    }));
  });

  it('dual-role user can access their consumer orders (My Purchases)', async () => {
    const list = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${dualRoleToken}`)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.orders[0].personId).toBe(dualRolePersonId);
  });

  it('dual-role user can access their vendor order groups (Sales Orders) via /vendor/orders', async () => {
    const response = await request(app)
      .get('/api/v1/vendor/orders')
      .set('Authorization', `Bearer ${dualRoleToken}`)
      .expect(200);
    // Dual-role user owns vendorId, should see their vendor group from dualRoleVendorOrder
    expect(response.body.vendorGroups).toHaveLength(1);
    expect(response.body.vendorGroups[0].vendorId).toBe(vendorId);
  });

  it('dual-role user purchasing from another vendor sees only their consumer order', async () => {
    // Dual-role user buys from other vendor's store
    const crossOrder = Order.create({
      personId: dualRolePersonId,
      vendorGroups: [{
        vendorId: otherVendorId,
        items: [{
          productId: 'cross-product',
          productName: 'Cross Product',
          vendorId: otherVendorId,
          quantity: 1,
          unitPrice: 50,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'cross-address',
        street: 'Cross Street',
        number: '3',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    await orderRepository.save(crossOrder);

    // As consumer, should see both orders they bought (orderId from vendorId2, crossOrder from otherVendorId)
    const consumerList = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${dualRoleToken}`)
      .expect(200);
    expect(consumerList.body.total).toBe(2);
    expect(consumerList.body.orders.map((o: any) => o.id)).toEqual(expect.arrayContaining([orderId, crossOrder.id]));

    // As vendor, should only see their own vendor groups (vendorId), not other vendor's
    const vendorList = await request(app)
      .get('/api/v1/vendor/orders')
      .set('Authorization', `Bearer ${dualRoleToken}`)
      .expect(200);
    expect(vendorList.body.vendorGroups).toHaveLength(1);
    expect(vendorList.body.vendorGroups[0].vendorId).toBe(vendorId);
  });

  it('pure consumer cannot access vendor-only endpoint /vendor/orders', async () => {
    await request(app)
      .get('/api/v1/vendor/orders')
      .set('Authorization', `Bearer ${consumerToken}`)
      .expect(403);
  });

  it('pure consumer cannot update vendor group status', async () => {
    const vendorGroupId = (await orderRepository.findById(orderId))!.vendorGroups[0].id;
    await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(403);
  });

  it('vendor cannot access another vendor\'s order groups via /vendor/orders', async () => {
    // Vendor user (who owns vendorId2) tries to access /vendor/orders - should only see their own vendor groups
    const response = await request(app)
      .get('/api/v1/vendor/orders')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);
    // Vendor user has 2 orders with their vendorId2: orderId and vendorOrderId
    expect(response.body.vendorGroups).toHaveLength(2);
    expect(response.body.vendorGroups.every((vg: any) => vg.vendorId === vendorId2)).toBe(true);
  });

  it('vendor cannot update another vendor\'s vendor group status', async () => {
    // Vendor user tries to update otherVendor's vendor group - should be forbidden
    const otherVendorGroupId = (await orderRepository.findById(otherOrderId))!.vendorGroups[0].id;
    await request(app)
      .patch(`/api/v1/orders/${otherOrderId}/vendor-groups/${otherVendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(403);
  });

  it('vendor cannot access another vendor\'s order via GET /orders/:orderId → 404', async () => {
    // vendorToken owns vendorId2; otherOrderId belongs to otherVendor (vendorId = otherVendorId)
    // The order exists but the vendor has no vendor group in it → must be 404 (resource hiding), not 403
    await request(app)
      .get(`/api/v1/orders/${otherOrderId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(404);
  });

  it('vendor accessing a non-existent order via GET /orders/:orderId → 404', async () => {
    // Order does not exist at all → must remain 404 (prevents order enumeration)
    await request(app)
      .get('/api/v1/orders/non-existent-order-id')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(404);
  });

  it('buyer (consumer) cannot perform vendor fulfillment actions (update vendor group status)', async () => {
    // Consumer tries to update vendor group status - should be forbidden (requires VENDOR role)
    const vendorGroupId = (await orderRepository.findById(orderId))!.vendorGroups[0].id;
    await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(403);
  });

  it('buyer (consumer) can confirm delivery of their own order items', async () => {
    // Consumer CAN mark their own items as delivered (confirming receipt)
    // Use otherOrderId which belongs to consumerPersonId
    const order = await orderRepository.findById(otherOrderId);
    const itemId = order!.vendorGroups[0].items[0].id;
    const response = await request(app)
      .patch(`/api/v1/orders/${otherOrderId}/items/delivery`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ itemIds: [itemId] })
      .expect(200);
    expect(response.body.order.vendorGroups[0].items[0].deliveredAt).toBeDefined();
  });

  it('dual-role user as buyer CAN confirm delivery of their own order items', async () => {
    // Dual-role user as buyer on orderId (from vendorId2) can confirm delivery
    const order = await orderRepository.findById(orderId);
    const itemId = order!.vendorGroups[0].items[0].id;
    const response = await request(app)
      .patch(`/api/v1/orders/${orderId}/items/delivery`)
      .set('Authorization', `Bearer ${dualRoleToken}`)
      .send({ itemIds: [itemId] })
      .expect(200);
    expect(response.body.order.vendorGroups[0].items[0].deliveredAt).toBeDefined();
  });

  it('dual-role user as vendor CAN fulfill their own vendor items', async () => {
    // Dual-role user as vendor (owns vendorId) can mark items as delivered on their vendor group
    const order = await orderRepository.findById((await orderRepository.findAll())[0].id); // Find the order with vendorId
    const dualVendorOrder = (await orderRepository.findAll()).find(o => o.vendorGroups.some(vg => vg.vendorId === vendorId));
    const vendorGroupId = dualVendorOrder!.vendorGroups[0].id;
    const itemId = dualVendorOrder!.vendorGroups[0].items[0].id;
    const response = await request(app)
      .patch(`/api/v1/orders/${dualVendorOrder!.id}/items/delivery`)
      .set('Authorization', `Bearer ${dualRoleToken}`)
      .send({ itemIds: [itemId] })
      .expect(200);
    expect(response.body.order.vendorGroups[0].items[0].deliveredAt).toBeDefined();
  });

  it('dual-role user as buyer CANNOT fulfill another vendor\'s items (vendor action)', async () => {
    // Dual-role user tries to update vendor group status on other vendor's order - should be forbidden
    const otherVendorGroupId = (await orderRepository.findById(otherOrderId))!.vendorGroups[0].id;
    await request(app)
      .patch(`/api/v1/orders/${otherOrderId}/vendor-groups/${otherVendorGroupId}/status`)
      .set('Authorization', `Bearer ${dualRoleToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(403);
  });

  it('admin exclusivity: admin cannot have CONSUMER or VENDOR role', async () => {
    const admin = await personRepository.findByEmail('admin@example.com');
    expect(admin!.roles).toEqual([PersonRole.ADMIN]);
    expect(admin!.roles).not.toContain(PersonRole.CONSUMER);
    expect(admin!.roles).not.toContain(PersonRole.VENDOR);
  });

  it('admin exclusivity: adding CONSUMER role to admin throws ADMIN_EXCLUSIVE', async () => {
    const admin = await personRepository.findByEmail('admin@example.com');
    expect(() => admin!.addRole(PersonRole.CONSUMER)).toThrow('ADMIN_EXCLUSIVE');
  });

  it('admin exclusivity: adding VENDOR role to admin throws ADMIN_EXCLUSIVE', async () => {
    const admin = await personRepository.findByEmail('admin@example.com');
    expect(() => admin!.addRole(PersonRole.VENDOR)).toThrow('ADMIN_EXCLUSIVE');
  });

  it('admin exclusivity: adding ADMIN role to consumer throws ADMIN_EXCLUSIVE', async () => {
    const consumer = await personRepository.findByEmail('pure-consumer@example.com');
    expect(() => consumer!.addRole(PersonRole.ADMIN)).toThrow('ADMIN_EXCLUSIVE');
  });

  it('admin exclusivity: adding ADMIN role to vendor throws ADMIN_EXCLUSIVE', async () => {
    const vendor = await personRepository.findByEmail('vendor@example.com');
    expect(() => vendor!.addRole(PersonRole.ADMIN)).toThrow('ADMIN_EXCLUSIVE');
  });
});
describe('Order comment route', () => {
  let app: express.Express;
  let ownerToken: string;
  let otherConsumerToken: string;
  let deliveredOrderId: string;
  let pendingOrderId: string;
  let ownerPersonId: string;
  let personRepository: InMemoryPersonRepository;
  let orderRepository: InMemoryOrderRepository;
  let authService: AuthService;
  const password = process.env.TEST_USER_PASSWORD!;

  beforeEach(async () => {
    personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');
    const owner = await authService.register({
      name: 'Order Owner',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'order-owner-comment@example.com',
      password: password,
      role: PersonRole.CONSUMER,
    });
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'other-consumer-comment@example.com',
      password: password,
      role: PersonRole.CONSUMER,
    });
    ownerToken = owner.tokens.accessToken;
    ownerPersonId = owner.person.id;
    otherConsumerToken = otherConsumer.tokens.accessToken;

    orderRepository = new InMemoryOrderRepository();
    const paymentRepository = new InMemoryPaymentRepository();
    const vendorRepository = new InMemoryVendorRepository();

    const deliveredOrder = Order.create({
      personId: owner.person.id,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'order-product',
          productName: 'Order Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 25,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    deliveredOrder.markPaymentAuthorized();
    deliveredOrder.transitionTo(OrderStatus.PROCESSING);
    deliveredOrder.transitionTo(OrderStatus.SHIPPED);
    deliveredOrder.transitionTo(OrderStatus.DELIVERED);
    deliveredOrderId = deliveredOrder.id;
    await orderRepository.save(deliveredOrder);

    const pendingOrder = Order.create({
      personId: owner.person.id,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'pending-product',
          productName: 'Pending Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 25,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    pendingOrderId = pendingOrder.id;
    await orderRepository.save(pendingOrder);

    const orderService = new OrderService(
      orderRepository,
      paymentRepository,
      personRepository,
      vendorRepository,
      config,
    );
    app = express();
    app.use(express.json());
    app.use('/api/v1', createOrderRoutes({
      authService,
      orderService,
      personRepo: personRepository,
      vendorRepo: vendorRepository,
    }));
  });

  it('POST comment to delivered order by owner → 404, feature disabled', async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${deliveredOrderId}/comment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ comment: '  Great order  ' })
      .expect(404);
    expect(res.body.error).toBe('COMMENT_FEATURE_DISABLED');
  });

  it('POST comment to non-delivered order → 404, feature disabled', async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${pendingOrderId}/comment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ comment: 'hello' })
      .expect(404);
    expect(res.body.error).toBe('COMMENT_FEATURE_DISABLED');
  });

  it('POST comment by non-owner → 404, feature disabled', async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${deliveredOrderId}/comment`)
      .set('Authorization', `Bearer ${otherConsumerToken}`)
      .send({ comment: 'hello' })
      .expect(404);
    expect(res.body.error).toBe('COMMENT_FEATURE_DISABLED');
  });

  it('POST second comment → 404, feature disabled', async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${deliveredOrderId}/comment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ comment: 'first' })
      .expect(404);
    expect(res.body.error).toBe('COMMENT_FEATURE_DISABLED');
  });

  it('POST empty comment → 404, feature disabled', async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${deliveredOrderId}/comment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ comment: '   ' })
      .expect(404);
    expect(res.body.error).toBe('COMMENT_FEATURE_DISABLED');
  });

  it('POST comment to non-existent order → 404, feature disabled', async () => {
    const res = await request(app)
      .post('/api/v1/orders/non-existent-order/comment')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ comment: 'hello' })
      .expect(404);
    expect(res.body.error).toBe('COMMENT_FEATURE_DISABLED');
  });

  it('POST comment without auth → 401, auth required', async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${deliveredOrderId}/comment`)
      .send({ comment: 'hello' })
      .expect(401);
    expect(res.body.error).toBe('MISSING_TOKEN');
  });
});

describe('Order dispute route', () => {
  let app: express.Express;
  let ownerToken: string;
  let otherConsumerToken: string;
  let adminToken: string;
  let vendorToken: string;
  let otherVendorToken: string;
  let vendorPersonId: string;
  let otherVendorPersonId: string;
  let vendorId: string;
  let otherVendorId: string;
  let deliveredOrderId: string;
  let ownerPersonId: string;
  let otherConsumerPersonId: string;
  let personRepository: InMemoryPersonRepository;
  let orderRepository: InMemoryOrderRepository;
  let authService: AuthService;
  let orderService: OrderService;
  const password = process.env.TEST_USER_PASSWORD!;

  beforeEach(async () => {
    personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');
    const owner = await authService.register({
      name: 'Order Owner',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'order-dispute@example.com',
      password: password,
      role: PersonRole.CONSUMER,
    });
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'other-consumer-dispute@example.com',
      password: password,
      role: PersonRole.CONSUMER,
    });
    const adminPerson = Person.create({
      name: 'Marketplace Admin',
      mainInfo: {
        name: 'Marketplace Admin',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000262',
      },
      contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
      addresses: [],
    });
    adminPerson.addRole(PersonRole.ADMIN);
    adminPerson.setCredential(await hashPassword(password));
    await personRepository.save(adminPerson);

    ownerToken = owner.tokens.accessToken;
    ownerPersonId = owner.person.id;
    otherConsumerPersonId = otherConsumer.person.id;
    otherConsumerToken = otherConsumer.tokens.accessToken;
    adminToken = (await authService.login({
      email: 'admin@example.com',
      password: password,
    })).tokens.accessToken;

    // Create vendor user (the vendor who owns the vendor group in the order)
    const vendorPerson = await authService.register({
      name: 'Test Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000181',
      email: 'vendor@example.com',
      password: password,
      role: PersonRole.VENDOR,
    });
    vendorToken = vendorPerson.tokens.accessToken;
    vendorPersonId = vendorPerson.person.id;

    // Create another vendor user (used to assert cross-vendor FORBIDDEN)
    const otherVendorPerson = await authService.register({
      name: 'Other Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000343',
      email: 'other-vendor@example.com',
      password: password,
      role: PersonRole.VENDOR,
    });
    otherVendorToken = otherVendorPerson.tokens.accessToken;
    otherVendorPersonId = otherVendorPerson.person.id;

    orderRepository = new InMemoryOrderRepository();
    const paymentRepository = new InMemoryPaymentRepository();
    const vendorRepository = new InMemoryVendorRepository();

    // Create vendor profiles
    const vendor = Vendor.create({
      personId: vendorPersonId,
      storeName: 'Test Store',
      slug: 'test-store',
      commissionPct: config.commissionPct,
    });
    vendorId = vendor.id;
    await vendorRepository.save(vendor);

    const otherVendor = Vendor.create({
      personId: otherVendorPersonId,
      storeName: 'Other Store',
      slug: 'other-store',
      commissionPct: config.commissionPct,
    });
    otherVendorId = otherVendor.id;
    await vendorRepository.save(otherVendor);

    const deliveredOrder = Order.create({
      personId: owner.person.id,
      vendorGroups: [{
        vendorId: vendorId,
        items: [{
          productId: 'dispute-product',
          productName: 'Dispute Product',
          vendorId: vendorId,
          quantity: 1,
          unitPrice: 100,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    deliveredOrder.markPaymentAuthorized();
    deliveredOrder.transitionTo(OrderStatus.PROCESSING);
    deliveredOrder.transitionTo(OrderStatus.SHIPPED);
    deliveredOrder.transitionTo(OrderStatus.DELIVERED);
    // Mark all items as delivered so dispute eligibility checks pass
    const allItems = deliveredOrder.vendorGroups.flatMap(vg => vg.items);
    deliveredOrder.markItemsDeliveredByIds(allItems.map(i => i.id), owner.person.id);
    deliveredOrderId = deliveredOrder.id;
    await orderRepository.save(deliveredOrder);

    orderService = new OrderService(
      orderRepository,
      paymentRepository,
      personRepository,
      vendorRepository,
      config,
    );
    app = express();
    app.use(express.json());
    app.use('/api/v1', createOrderRoutes({
      authService,
      orderService,
      personRepo: personRepository,
      vendorRepo: vendorRepository,
    }));
  });

  it('POST initiate dispute by consumer on delivered item → 201', async () => {
    const res = await request(app)
      .post(`/api/v1/orders/${deliveredOrderId}/items/${(await orderRepository.findById(deliveredOrderId))?.vendorGroups[0]?.items[0]?.id}/disputes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Item arrived damaged' })
      .expect(201);
    expect(res.body.dispute.status).toBe(DisputeStatus.PENDING);
    expect(res.body.dispute.type).toBe(DisputeType.REFUND);
    expect(res.body.dispute.requestedBy).toBe('consumer');
    expect(res.body.dispute.resolution).toBeUndefined();
  });

  it('POST initiate dispute on non-delivered item → 422', async () => {
    const pendingOrder = Order.create({
      personId: ownerPersonId,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'pending-dispute-product',
          productName: 'Pending Dispute Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 50,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    await orderRepository.save(pendingOrder);

    const res = await request(app)
      .post(`/api/v1/orders/${pendingOrder.id}/items/${pendingOrder.vendorGroups[0]?.items[0]?.id}/disputes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Not delivered yet' })
      .expect(422);
    expect(res.body.error).toBe('ORDER_NOT_DELIVERED');
  });

  it('POST initiate dispute by non-owner → 404', async () => {
    const otherOrder = Order.create({
      personId: otherConsumerPersonId,
      vendorGroups: [{
        vendorId: 'owner-vendor',
        items: [{
          productId: 'other-dispute-product',
          productName: 'Other Dispute Product',
          vendorId: 'owner-vendor',
          quantity: 1,
          unitPrice: 75,
        }],
        commissionPct: config.commissionPct,
      }],
      shippingAddress: {
        id: 'delivery-address',
        street: 'Second Street',
        number: '2',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    await orderRepository.save(otherOrder);

    const res = await request(app)
      .post(`/api/v1/orders/${otherOrder.id}/items/${otherOrder.vendorGroups[0]?.items[0]?.id}/disputes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Someone elses dispute' })
      .expect(404);
  });

  it('POST approve dispute by vendor → 200', async () => {
    // First initiate a dispute
    const order = await orderRepository.findById(deliveredOrderId);
    const item = order?.vendorGroups[0]?.items[0];
    await orderService.initiateDispute(item!.id, 'Item arrived damaged', 'consumer');

    // Find the dispute ID
    const updatedOrder = await orderRepository.findById(deliveredOrderId);
    const disputedItem = updatedOrder?.vendorGroups[0]?.items.find((i: any) => i.dispute);
    const disputeId = disputedItem?.dispute?.id;

    const res = await request(app)
      .post(`/api/v1/disputes/${disputeId}/approve`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);
    expect(res.body.dispute.status).toBe(DisputeStatus.APPROVED);
    expect(res.body.dispute.resolution).toBe(DisputeResolution.APPROVED);
    expect(res.body.dispute.resolvedAt).toBeDefined();
    expect(res.body.dispute.resolvedBy).toBe('vendor');
  });

  it('POST approve dispute by another vendor → 403', async () => {
    // First initiate a dispute
    const order = await orderRepository.findById(deliveredOrderId);
    const item = order?.vendorGroups[0]?.items[0];
    await orderService.initiateDispute(item!.id, 'Item arrived damaged', 'consumer');

    // Find the dispute ID
    const updatedOrder = await orderRepository.findById(deliveredOrderId);
    const disputedItem = updatedOrder?.vendorGroups[0]?.items.find((i: any) => i.dispute);
    const disputeId = disputedItem?.dispute?.id;

    await request(app)
      .post(`/api/v1/disputes/${disputeId}/approve`)
      .set('Authorization', `Bearer ${otherVendorToken}`)
      .expect(403);
  });

  it('POST reject dispute by vendor → 200', async () => {
    // First initiate a dispute
    const order = await orderRepository.findById(deliveredOrderId);
    const item = order?.vendorGroups[0]?.items[0];
    await orderService.initiateDispute(item!.id, 'Item wrong product', 'consumer');

    // Find the dispute ID
    const updatedOrder = await orderRepository.findById(deliveredOrderId);
    const disputedItem = updatedOrder?.vendorGroups[0]?.items.find((i: any) => i.dispute);
    const disputeId = disputedItem?.dispute?.id;

    const res = await request(app)
      .post(`/api/v1/disputes/${disputeId}/reject`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);
    expect(res.body.dispute.status).toBe(DisputeStatus.REJECTED);
    expect(res.body.dispute.resolution).toBe(DisputeResolution.REJECTED);
    expect(res.body.dispute.resolvedAt).toBeDefined();
    expect(res.body.dispute.resolvedBy).toBe('vendor');
  });

  it('POST reject dispute by another vendor → 403', async () => {
    // First initiate a dispute
    const order = await orderRepository.findById(deliveredOrderId);
    const item = order?.vendorGroups[0]?.items[0];
    await orderService.initiateDispute(item!.id, 'Item wrong product', 'consumer');

    // Find the dispute ID
    const updatedOrder = await orderRepository.findById(deliveredOrderId);
    const disputedItem = updatedOrder?.vendorGroups[0]?.items.find((i: any) => i.dispute);
    const disputeId = disputedItem?.dispute?.id;

    await request(app)
      .post(`/api/v1/disputes/${disputeId}/reject`)
      .set('Authorization', `Bearer ${otherVendorToken}`)
      .expect(403);
  });

  it('POST admin mediate dispute → 200', async () => {
    // First initiate a dispute
    const order = await orderRepository.findById(deliveredOrderId);
    const item = order?.vendorGroups[0]?.items[0];
    await orderService.initiateDispute(item!.id, 'Item arrived damaged', 'consumer');

    // Find the dispute ID
    const updatedOrder = await orderRepository.findById(deliveredOrderId);
    const disputedItem = updatedOrder?.vendorGroups[0]?.items.find((i: any) => i.dispute);
    const disputeId = disputedItem?.dispute?.id;

    // Admin mediates with APPROVED
    const res = await request(app)
      .post(`/api/v1/disputes/${disputeId}/admin-mediate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'approved' })
      .expect(200);
    expect(res.body.dispute.status).toBe(DisputeStatus.MEDIATED);
    expect(res.body.dispute.resolution).toBe(DisputeResolution.APPROVED);
    expect(res.body.dispute.resolvedAt).toBeDefined();
    expect(res.body.dispute.resolvedBy).toBe('admin');
  });

  it('POST admin mediate dispute with REJECTED → 200', async () => {
    // First initiate a dispute
    const order = await orderRepository.findById(deliveredOrderId);
    const item = order?.vendorGroups[0]?.items[0];
    await orderService.initiateDispute(item!.id, 'Item wrong product', 'consumer');

    // Find the dispute ID
    const updatedOrder = await orderRepository.findById(deliveredOrderId);
    const disputedItem = updatedOrder?.vendorGroups[0]?.items.find((i: any) => i.dispute);
    const disputeId = disputedItem?.dispute?.id;

    // Admin mediates with REJECTED
    const res = await request(app)
      .post(`/api/v1/disputes/${disputeId}/admin-mediate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ resolution: 'rejected' })
      .expect(200);
    expect(res.body.dispute.status).toBe(DisputeStatus.MEDIATED);
    expect(res.body.dispute.resolution).toBe(DisputeResolution.REJECTED);
    expect(res.body.dispute.resolvedAt).toBeDefined();
    expect(res.body.dispute.resolvedBy).toBe('admin');
  });
});
