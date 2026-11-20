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
  FinancialStatus,
  OrderError,
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

    const forbidden = await request(app)
      .get(`/api/v1/orders/${otherOrderId}`)
      .set('Authorization', `Bearer ${vendorToken}`)
      .expect(404);
    expect(forbidden.body.order).toBeUndefined();
    await request(app)
      .get('/api/v1/orders/nonexistent-order')
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

  describe('LC-17: fulfillment chain and payment prerequisite', () => {
    it('completes full fulfillment chain when order is PAID first (PENDING → CONFIRMED → PREPARING → SHIPPED → DELIVERED)', async () => {
      // Order must be PAID before vendor groups can advance the order to PROCESSING
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.PAID })
        .expect(200);

      // PENDING -> CONFIRMED: OVG confirm does not require payment, order stays PAID
      await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.CONFIRMED })
        .expect(200);

      const afterConfirm = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(afterConfirm.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.CONFIRMED);
      expect(afterConfirm.body.order.status).toBe(OrderStatus.PAID);

      // CONFIRMED -> PREPARING: allowed because order is PAID, order moves to PROCESSING
      await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.PREPARING })
        .expect(200);

      const afterPreparing = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(afterPreparing.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.PREPARING);
      expect(afterPreparing.body.order.status).toBe(OrderStatus.PROCESSING);

      // PREPARING -> SHIPPED: order moves to SHIPPED
      await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.SHIPPED })
        .expect(200);

      const afterShipped = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(afterShipped.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.SHIPPED);
      expect(afterShipped.body.order.status).toBe(OrderStatus.SHIPPED);

      // SHIPPED -> DELIVERED: order moves to DELIVERED
      await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.DELIVERED })
        .expect(200);

      const afterDelivered = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(afterDelivered.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.DELIVERED);
      expect(afterDelivered.body.order.status).toBe(OrderStatus.DELIVERED);
      expect(afterDelivered.body.order.financialStatus).toBe(FinancialStatus.PAID);
    });

    it('rejects OVG CONFIRMED -> PREPARING when order is not PAID (409, INVALID_STATUS_TRANSITION)', async () => {
      // OVG can be confirmed even when the order is not paid
      await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.CONFIRMED })
        .expect(200);

      const orderBefore = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(orderBefore.body.order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(orderBefore.body.order.financialStatus).toBe(FinancialStatus.PENDING);

      // Advancing to PREPARING must be rejected: PAID is a prerequisite for PROCESSING
      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.PREPARING })
        .expect(409);
      expect(response.body.error).toBe(OrderError.INVALID_STATUS_TRANSITION);

      // Order must not advance to PROCESSING
      const orderAfter = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(orderAfter.body.order.status).toBe(OrderStatus.PENDING_PAYMENT);
    });

    it('allows OVG CONFIRMED -> PREPARING when order is PAID (200, order -> PROCESSING)', async () => {
      // Set order to PAID first
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.PAID })
        .expect(200);

      // Confirm OVG
      await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.CONFIRMED })
        .expect(200);

      // Advance to PREPARING: allowed because order is PAID
      const response = await request(app)
        .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.PREPARING })
        .expect(200);
      expect(response.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.PREPARING);

      const orderAfter = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(orderAfter.body.order.status).toBe(OrderStatus.PROCESSING);
      expect(orderAfter.body.order.financialStatus).toBe(FinancialStatus.PAID);
    });
  });

  describe('LC-18: multi-vendor order integrity', () => {
    const createMultiVendorOrder = async (): Promise<Order> => {
      const order = Order.create({
        personId: ownerPersonId,
        vendorGroups: [
          {
            vendorId: vendorId,
            items: [
              {
                productId: 'mv-product-a',
                productName: 'Product A',
                vendorId: vendorId,
                quantity: 1,
                unitPrice: 10,
              },
            ],
            commissionPct: config.commissionPct,
          },
          {
            vendorId: otherVendorId,
            items: [
              {
                productId: 'mv-product-b',
                productName: 'Product B',
                vendorId: otherVendorId,
                quantity: 1,
                unitPrice: 20,
              },
            ],
            commissionPct: config.commissionPct,
          },
        ],
        shippingAddress: {
          id: 'multi-vendor-address',
          street: 'Multi Vendor Street',
          number: '1',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          isPrimary: true,
        },
      });
      await orderRepository.save(order);
      return order;
    };

    const setOrderPaid = async (orderId: string) => {
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.PAID })
        .expect(200);
    };

    const deliverOVG = async (orderId: string, vendorGroupId: string, token: string) => {
      for (const status of [
        OrderVendorGroupStatus.CONFIRMED,
        OrderVendorGroupStatus.PREPARING,
        OrderVendorGroupStatus.SHIPPED,
        OrderVendorGroupStatus.DELIVERED,
      ]) {
        await request(app)
          .patch(`/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status })
          .expect(200);
      }
    };

    const getVendorGroupId = (order: Order, vendorId: string): string =>
      order.vendorGroups.find((vg) => vg.vendorId === vendorId)!.id;

    it('ensures each vendor only processes their own OVG', async () => {
      const order = await createMultiVendorOrder();
      const vendorAGroupId = getVendorGroupId(order, vendorId);

      // Vendor A confirms their own OVG → 200
      const confirmResponse = await request(app)
        .patch(`/api/v1/orders/${order.id}/vendor-groups/${vendorAGroupId}/status`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ status: OrderVendorGroupStatus.CONFIRMED })
        .expect(200);
      expect(confirmResponse.body.order.vendorGroups[0].status).toBe(OrderVendorGroupStatus.CONFIRMED);

      // Vendor B attempting to confirm vendor A's OVG → 403
      await request(app)
        .patch(`/api/v1/orders/${order.id}/vendor-groups/${vendorAGroupId}/status`)
        .set('Authorization', `Bearer ${otherVendorToken}`)
        .send({ status: OrderVendorGroupStatus.CONFIRMED })
        .expect(403);
    });

    it('treats partially delivered multi-vendor order as not fully delivered', async () => {
      const order = await createMultiVendorOrder();
      const vendorAGroupId = getVendorGroupId(order, vendorId);
      const vendorBGroupId = getVendorGroupId(order, otherVendorId);

      await setOrderPaid(order.id);

      // Vendor A delivers their OVG; vendor B's OVG stays PENDING
      await deliverOVG(order.id, vendorAGroupId, vendorToken);

      const response = await request(app)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.order.status).not.toBe(OrderStatus.DELIVERED);
      expect(
        response.body.order.vendorGroups.find((vg) => vg.vendorId === otherVendorId)!.status
      ).toBe(OrderVendorGroupStatus.PENDING);
    });

    it('marks order as DELIVERED when all vendor groups are DELIVERED', async () => {
      const order = await createMultiVendorOrder();
      const vendorAGroupId = getVendorGroupId(order, vendorId);
      const vendorBGroupId = getVendorGroupId(order, otherVendorId);

      await setOrderPaid(order.id);

      await deliverOVG(order.id, vendorAGroupId, vendorToken);
      await deliverOVG(order.id, vendorBGroupId, otherVendorToken);

      const response = await request(app)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.order.status).toBe(OrderStatus.DELIVERED);
      expect(
        response.body.order.vendorGroups.every((vg) => vg.status === OrderVendorGroupStatus.DELIVERED)
      ).toBe(true);
    });
  });
});
