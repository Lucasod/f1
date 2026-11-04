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
} from './order.domain';
import { OrderService } from './order.service';
import { createOrderRoutes } from './order.routes';
  import 'dotenv/config';


describe('Order lifecycle transitions and ownership', () => {
  let app: express.Express;
  let ownerToken: string;
  let otherConsumerToken: string;
  let vendorToken: string;
  let otherVendorToken: string;
  let adminToken: string;
  let orderId: string;
  let vendorGroupId: string;
  let otherOrderId: string;
  let ownerPersonId: string;
  let vendorPersonId: string;
  let otherVendorPersonId: string;
  let vendorId: string;
  let otherVendorId: string;
  let personRepository: InMemoryPersonRepository;
  let orderRepository: InMemoryOrderRepository;
  let vendorRepository: InMemoryVendorRepository;
  let authService: AuthService;
  const validPassword = process.env.TEST_USER_PASSWORD!;
  

  beforeEach(async () => {
    personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');

    const owner = await authService.register({
      name: 'Order Owner',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'order-owner@example.com',
      password: validPassword,
      role: PersonRole.CONSUMER,
    });
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'other-consumer@example.com',
      password: validPassword,
      role: PersonRole.CONSUMER,
    });
    ownerToken = owner.tokens.accessToken;
    ownerPersonId = owner.person.id;
    otherConsumerToken = otherConsumer.tokens.accessToken;

    const vendorPerson = await authService.register({
      name: 'Test Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000181',
      email: 'vendor@example.com',
      password: validPassword,
      role: PersonRole.VENDOR,
    });
    vendorToken = vendorPerson.tokens.accessToken;
    vendorPersonId = vendorPerson.person.id;

    const otherVendorPerson = await authService.register({
      name: 'Other Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000343',
      email: 'other-vendor@example.com',
      password: validPassword,
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
    adminPerson.setCredential(await hashPassword( validPassword!));
    await personRepository.save(adminPerson);
    adminToken = (await authService.login({
      email: 'admin@example.com',
      password: validPassword!,
    })).tokens.accessToken;

    orderRepository = new InMemoryOrderRepository();
    const paymentRepository = new InMemoryPaymentRepository();
    vendorRepository = new InMemoryVendorRepository();

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

    const otherOrder = Order.create({
      personId: owner.person.id,
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

  it('allows vendor to update their own vendor group status (200, status changed)', async () => {
    const response = await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(200);

    expect(response.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.CONFIRMED);
  });

  it('forbids vendor from updating another vendor group (403)', async () => {
    const otherVendorGroupId = (await orderRepository.findById(otherOrderId))!.vendorGroups[0].id;
    await request(app)
      .patch(`/api/v1/orders/${otherOrderId}/vendor-groups/${otherVendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(403);
  });

  it('allows admin to update any vendor group (200)', async () => {
    const response = await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderVendorGroupStatus.CONFIRMED })
      .expect(200);

    expect(response.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.CONFIRMED);
  });

  it('rejects invalid vendor group status transition (409)', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderVendorGroupStatus.SHIPPED })
      .expect(409);
  });

  it('returns 400 for invalid vendor group status value', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: 'invalid_status' })
      .expect(400);
  });

  it('allows admin to update order status directly (200)', async () => {
    const response = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderStatus.PAID })
      .expect(200);

    expect(response.body.order.status).toBe(OrderStatus.PAID);
  });

  it('rejects invalid order status transition for admin (409)', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderStatus.DELIVERED })
      .expect(409);
  });

  it('returns 400 for invalid order status value', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'invalid_status' })
      .expect(400);
  });

  it('forbids consumer from updating order status (403)', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: OrderStatus.PAID })
      .expect(403);
  });

  it('forbids vendor from updating order status (403)', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({ status: OrderStatus.PAID })
      .expect(403);
  });

  it('returns 401 for unauthenticated order status update', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .send({ status: OrderStatus.PAID })
      .expect(401);
  });

  it('vendor can only view orders containing their groups', async () => {
    const listResponse = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);

    expect(listResponse.body.total).toBe(1);
    expect(listResponse.body.orders[0].id).toBe(orderId);

    await request(app)
      .get(`/api/v1/orders/${otherOrderId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(404);

    await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);
  });

  it('vendor /vendor/orders returns only their groups', async () => {
    const response = await request(app)
      .get('/api/v1/vendor/orders')
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(200);

    expect(response.body.vendorGroups).toHaveLength(1);
    expect(response.body.vendorGroups[0].vendorId).toBe(vendorId);
  });
});
