import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { InMemoryPersonRepository, Person, PersonRole } from '../person/person.domain';
import { InMemoryVendorRepository } from '../vendor/vendor.domain';
import { config } from '../../config';
import { hashPassword } from '../auth/credential.domain';
import {
  InMemoryOrderRepository,
  InMemoryPaymentRepository,
  Order,
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

  beforeEach(async () => {
    personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');
    ownerEmail = 'order-owner@example.com';
    const owner = await authService.register({
      name: 'Order Owner',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: ownerEmail,
      password: 'SecurePass123!',
      role: PersonRole.CONSUMER,
    });
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'other-consumer@example.com',
      password: 'SecurePass123!',
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
    adminPerson.setCredential(await hashPassword('SecurePass123!'));
    await personRepository.save(adminPerson);
    adminToken = (await authService.login({
      email: 'admin@example.com',
      password: 'SecurePass123!',
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

  it('returns a consumer dashboard summary using only that consumer’s orders', async () => {
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
      password: 'SecurePass123!',
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
