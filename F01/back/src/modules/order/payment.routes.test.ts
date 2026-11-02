import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository, Person } from '../person/person.domain';
import { InMemoryOrderRepository, InMemoryPaymentRepository, Order, OrderStatus, PaymentStatus } from '../order/order.domain';
import { AuthService } from '../auth/auth.service';
import { PaymentService } from './payment.service';
import { createPaymentRoutes } from './payment.routes';
import { createAuthRoutes } from '../auth/auth.routes';
import { hashPassword } from '../auth/credential.domain';
import { PersonRole } from '../person/person.domain';
import { config } from '../../config';
import { Vendor, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Product, ProductStatus, InMemoryProductRepository } from '../product/product.domain';
import { PaymentError } from './payment.service';

const VALID_CPF_1 = '52998224725';
const testPassword = 'SecurePass123!';

describe('Payment Routes (T-1004 Refund API)', () => {
  let app: express.Express;
  let personRepo: InMemoryPersonRepository;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let productRepo: InMemoryProductRepository;
  let vendorRepo: InMemoryVendorRepository;
  let authService: AuthService;
  let paymentService: PaymentService;
  let consumerToken: string;
  let vendorId: string;
  let orderId: string;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    orderRepo = new InMemoryOrderRepository();
    paymentRepo = new InMemoryPaymentRepository();
    productRepo = new InMemoryProductRepository();
    vendorRepo = new InMemoryVendorRepository();

    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
    paymentService = new PaymentService(paymentRepo, orderRepo);

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));
    app.use('/api/v1/payments', createPaymentRoutes({ authService, paymentService, vendorRepo, orderRepo }));

    const adminPerson = Person.create({
      name: 'Admin', mainInfo: { name: 'Admin', taxIdType: 'CPF', taxIdValue: '98765432100' },
      contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
      addresses: []
    });
    adminPerson.addRole(PersonRole.ADMIN);
    adminPerson.setCredential(await hashPassword(testPassword));
    await personRepo.save(adminPerson);

    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: testPassword });

    const consumerRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Consumer', taxIdType: 'CPF', taxIdValue: VALID_CPF_1, email: 'c@example.com', password: testPassword, role: PersonRole.CONSUMER });
    consumerToken = consumerRegister.body.tokens.accessToken;
    const consumerId = consumerRegister.body.person.id;

    const vendorPerson = Person.create({
      name: 'Vendor', mainInfo: { name: 'Vendor', taxIdType: 'CPF', taxIdValue: '11122233344' },
      contactInfos: [{ type: 'email', value: 'v@example.com', isPrimary: true }],
      addresses: []
    });
    vendorPerson.addRole(PersonRole.VENDOR);
    vendorPerson.setCredential(await hashPassword(testPassword));
    await personRepo.save(vendorPerson);

    const vendor = Vendor.create({ personId: vendorPerson.id!, storeName: 'Store', slug: 'store', commissionPct: 10 });
    vendor.id = 'vendor-1';
    await vendorRepo.save(vendor);
    vendorId = vendor.id;

    const product = Product.create({ vendorId, categoryId: 'c1', name: 'P', description: 'd', price: 100, quantity: 10, status: ProductStatus.ACTIVE });
    product.id = 'product-1';
    await productRepo.save(product);

    const order = Order.create({
      personId: consumerId,
      vendorGroups: [{ vendorId, items: [{ productId: product.id, productName: 'P', vendorId, quantity: 1, unitPrice: 100 }], commissionPct: 10 }],
      shippingAddress: { id: 'a1', street: 'S', number: '1', neighborhood: 'N', city: 'C', state: 'ST', isPrimary: true }
    });
    order.id = 'order-1';
    await orderRepo.save(order);
    orderId = order.id;
  });
  describe('POST /payments - Create payment', () => {
    it('should create a payment for an order', async () => {
      const res = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      expect(res.status).toBe(201);
      expect(res.body.payment.amount).toBe(100);
      expect(res.body.payment.status).toBe(PaymentStatus.PENDING);
    });
    it('should return 404 for non-existent order', async () => {
      const res = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId: 'x', amount: 100, provider: 'stripe' });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('ORDER_NOT_FOUND');
    });
  });

  describe('POST /payments/:id/authorize', () => {
    it('should authorize a pending payment', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      const res = await request(app).post(`/api/v1/payments/${pid}/authorize`).set('Authorization', `Bearer ${consumerToken}`).send({ providerTransactionId: 'pi_123' });
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.AUTHORIZED);
    });
  });

  describe('POST /payments/:id/capture', () => {
    it('should capture an authorized payment', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      await request(app).post(`/api/v1/payments/${pid}/authorize`).set('Authorization', `Bearer ${consumerToken}`).send({ providerTransactionId: 'pi_123' });
      const res = await request(app).post(`/api/v1/payments/${pid}/capture`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.CAPTURED);
    });
  });

  describe('POST /payments/:id/refund (T-1004)', () => {
    it('should refund a captured payment', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      await request(app).post(`/api/v1/payments/${pid}/authorize`).set('Authorization', `Bearer ${consumerToken}`).send({ providerTransactionId: 'pi_123' });
      await request(app).post(`/api/v1/payments/${pid}/capture`).set('Authorization', `Bearer ${consumerToken}`);
      const res = await request(app).post(`/api/v1/payments/${pid}/refund`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.REFUNDED);
      expect(res.body.payment.refundedAt).toBeDefined();
    });
    it('should return 409 when not capturable', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      const res = await request(app).post(`/api/v1/payments/${pid}/refund`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_REFUNDABLE);
    });
    it('should return 409 when already refunded', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      await request(app).post(`/api/v1/payments/${pid}/authorize`).set('Authorization', `Bearer ${consumerToken}`).send({ providerTransactionId: 'pi_123' });
      await request(app).post(`/api/v1/payments/${pid}/capture`).set('Authorization', `Bearer ${consumerToken}`);
      await request(app).post(`/api/v1/payments/${pid}/refund`).set('Authorization', `Bearer ${consumerToken}`);
      const res = await request(app).post(`/api/v1/payments/${pid}/refund`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_REFUNDABLE);
    });
    it('should return 404 for non-existent payment', async () => {
      const res = await request(app).post('/api/v1/payments/x/refund').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_FOUND);
    });
  });

  describe('POST /payments/:id/fail (T-1001)', () => {
    it('should fail a pending payment', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      const res = await request(app).post(`/api/v1/payments/${pid}/fail`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.FAILED);
    });
    it('should be idempotent for an already failed payment', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      await request(app).post(`/api/v1/payments/${pid}/fail`).set('Authorization', `Bearer ${consumerToken}`);
      const res = await request(app).post(`/api/v1/payments/${pid}/fail`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.FAILED);
    });
    it('should return 409 when payment is captured', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      await request(app).post(`/api/v1/payments/${pid}/authorize`).set('Authorization', `Bearer ${consumerToken}`).send({ providerTransactionId: 'pi_123' });
      await request(app).post(`/api/v1/payments/${pid}/capture`).set('Authorization', `Bearer ${consumerToken}`);
      const res = await request(app).post(`/api/v1/payments/${pid}/fail`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });
    it('should return 404 for non-owner', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const pid = cr.body.payment.id;
      const other = await request(app).post('/api/v1/auth/register').send({ name: 'Other', taxIdType: 'CPF', taxIdValue: '12345678909', email: 'other-fail@example.com', password: testPassword, role: PersonRole.CONSUMER });
      const otherToken = other.body.tokens.accessToken;
      const res = await request(app).post(`/api/v1/payments/${pid}/fail`).set('Authorization', `Bearer ${otherToken}`);
      expect(res.status).toBe(404);
    });
    it('should return 404 for non-existent payment', async () => {
      const res = await request(app).post('/api/v1/payments/x/fail').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_FOUND);
    });
  });

  describe('GET /payments/:id', () => {
    it('should return a payment by ID', async () => {
      const cr = await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const res = await request(app).get(`/api/v1/payments/${cr.body.payment.id}`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.payment.id).toBe(cr.body.payment.id);
    });
    it('should return 404 for non-existent payment', async () => {
      const res = await request(app).get('/api/v1/payments/x').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /payments/order/:orderId', () => {
    it('should return payments for an order', async () => {
      await request(app).post('/api/v1/payments').set('Authorization', `Bearer ${consumerToken}`).send({ orderId, amount: 100, provider: 'stripe' });
      const res = await request(app).get(`/api/v1/payments/order/${orderId}`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.payments).toHaveLength(1);
    });
  });
});