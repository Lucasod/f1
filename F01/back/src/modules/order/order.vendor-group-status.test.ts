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
  OrderVendorGroup,
  OrderVendorGroupStatus,
} from './order.domain';
import { OrderService } from './order.service';
import { createOrderRoutes } from './order.routes';

describe('Order vendor group status update', () => {
  let app: express.Express;
  let ownerToken: string;
  let otherConsumerToken: string;
  let vendorToken: string;
  let otherVendorToken: string;
  let adminToken: string;
  let orderId: string;
  let vendorGroupId: string;
  let ownerPersonId: string;
  let otherConsumerPersonId: string;
  let vendorPersonId: string;
  let otherVendorPersonId: string;
  let vendorId: string;
  let otherVendorId: string;
  let personRepository: InMemoryPersonRepository;
  let orderRepository: InMemoryOrderRepository;
  let vendorRepository: InMemoryVendorRepository;
  let authService: AuthService;
  let ownerEmail: string;
  const testPassword = process.env.TEST_USER_PASSWORD!;

  beforeEach(async () => {
    personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');
    ownerEmail = 'order-owner@example.com';
    const owner = await authService.register({
      name: 'Order Owner',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: ownerEmail,
      password: testPassword,
      role: PersonRole.CONSUMER,
    });
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'other-consumer@example.com',
      password: testPassword,
      role: PersonRole.CONSUMER,
    });
    ownerToken = owner.tokens.accessToken;
    ownerPersonId = owner.person.id;
    otherConsumerToken = otherConsumer.tokens.accessToken;
    otherConsumerPersonId = otherConsumer.person.id;

    // Create vendor user (the vendor who owns the vendor group in the order)
    const vendorPerson = await authService.register({
      name: 'Test Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000181',
      email: 'vendor@example.com',
      password: testPassword,
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
      password: testPassword,
      role: PersonRole.VENDOR,
    });
    otherVendorToken = otherVendorPerson.tokens.accessToken;
    otherVendorPersonId = otherVendorPerson.person.id;

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
    adminPerson.setCredential(await hashPassword(testPassword));
    await personRepository.save(adminPerson);
    adminToken = (await authService.login({
      email: 'admin@example.com',
      password: testPassword,
    })).tokens.accessToken;

    orderRepository = new InMemoryOrderRepository();
    const paymentRepository = new InMemoryPaymentRepository();
    vendorRepository = new InMemoryVendorRepository();

    // Create vendor profile for the vendor who owns the vendor group
    const vendor = Vendor.create({
      personId: vendorPersonId,
      storeName: 'Test Store',
      slug: 'test-store',
      commissionPct: config.commissionPct,
    });
    vendorId = vendor.id;
    await vendorRepository.save(vendor);

    // Create another vendor profile
    const otherVendor = Vendor.create({
      personId: otherVendorPersonId,
      storeName: 'Other Store',
      slug: 'other-store',
      commissionPct: config.commissionPct,
    });
    otherVendorId = otherVendor.id;
    await vendorRepository.save(otherVendor);

    // Create order with vendor group owned by 'vendor'
    const order = Order.create({
      personId: owner.person.id,
      vendorGroups: [{
        vendorId: vendorId,
        items: [{
          productId: 'order-product',
          productName: 'Order Product',
          vendorId: vendorId,
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
    vendorGroupId = order.vendorGroups[0].id;
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

  it('allows vendor to update their own vendor group status from PENDING to CONFIRMED', async () => {
    const response = await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(200);

    expect(response.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.CONFIRMED);
    expect(response.body.order.vendorGroups[0].vendorId).toBe(vendorId);
  });

  it('forbids vendor from updating another vendor\'s vendor group', async () => {
    // Create an order with a vendor group owned by otherVendor
    const otherOrder = Order.create({
      personId: ownerPersonId,
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
    const otherOrderId = otherOrder.id;
    const otherVendorGroupId = otherOrder.vendorGroups[0].id;
    await orderRepository.save(otherOrder);

    await request(app)
      .patch(`/api/v1/orders/${otherOrderId}/vendor-groups/${otherVendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(403);
  });

  it('rejects invalid status transition (PENDING to SHIPPED)', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.SHIPPED })
      .expect(409);
  });

  it('allows admin to update any vendor group status', async () => {
    const response = await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(200);

    expect(response.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.CONFIRMED);
  });

  it('returns 404 for non-existent order', async () => {
    const fakeOrderId = 'non-existent-order-id';
    const fakeVendorGroupId = 'non-existent-vg-id';

    await request(app)
      .patch(`/api/v1/orders/${fakeOrderId}/vendor-groups/${fakeVendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(404);
  });

  it('returns 400 for invalid status value', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'invalid_status' })
      .expect(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(401);
  });

  it('normalizes persisted uppercase status and allows PENDING -> CONFIRMED transition', () => {
    // Simulates data persisted with uppercase status ("PENDING"), as found in
    // MongoDB for order-ts-1795032892374. Before the fix,
    // `VALID_VENDOR_GROUP_TRANSITIONS[this.status]` resolved to `undefined` and
    // `updateStatus` threw `TypeError: Cannot read properties of undefined
    // (reading 'includes')`, which surfaced as a 500 from the confirm endpoint.
    const vendorGroup = OrderVendorGroup.reconstruct({
      id: 'vg-ts-1795032892374',
      orderId: 'order-ts-1795032892374',
      vendorId: 'vendor-00cjp4oa',
      status: 'PENDING', // uppercase, as persisted in MongoDB
      items: [{
        id: 'item-1795032892374-0',
        productId: 'prod-1000000000010-000010',
        productName: 'iPhone 15 Pro',
        vendorId: 'vendor-00cjp4oa',
        quantity: 1,
        unitPrice: 9999,
        totalPrice: 9999,
      }],
      subtotal: 9999,
      commissionPct: 10,
      commissionAmount: 999.9,
      vendorNet: 8999.1,
      createdAt: new Date('2026-11-18T20:14:52.374Z'),
      updatedAt: new Date('2026-11-18T20:14:52.374Z'),
    });

    expect(vendorGroup.status).toBe(OrderVendorGroupStatus.PENDING);

    // Previously threw: TypeError: Cannot read properties of undefined (reading 'includes')
    vendorGroup.updateStatus(OrderVendorGroupStatus.CONFIRMED);

    expect(vendorGroup.status).toBe(OrderVendorGroupStatus.CONFIRMED);
  });
});