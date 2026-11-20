import { describe, it, expect, beforeEach } from 'vitest';
import { requestInProcess } from '../../tests/request-in-process';
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
import { mockPaymentMongo } from '../../tests/mock-payment-mongo';
import { Vendor, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Product, ProductStatus, InMemoryProductRepository } from '../product/product.domain';
import { PaymentError } from './payment.service';

const VALID_CPF_1 = '52998224725';
const testPassword = process.env.TEST_USER_PASSWORD!;

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
    paymentService = new PaymentService(
      paymentRepo, orderRepo, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, mockPaymentMongo
    );

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

    const adminLogin = await requestInProcess(app, 'POST', '/api/v1/auth/login', { body: { email: 'admin@example.com', password: testPassword } });

    const consumerRegister = await requestInProcess(app, 'POST', '/api/v1/auth/register', { body: { name: 'Consumer', taxIdType: 'CPF', taxIdValue: VALID_CPF_1, email: 'c@example.com', password: testPassword, role: PersonRole.CONSUMER } });
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
      const res = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      expect(res.status).toBe(201);
      expect(res.body.payment.amount).toBe(100);
      expect(res.body.payment.status).toBe(PaymentStatus.PENDING);
    });
    it('should return 404 for non-existent order', async () => {
      const res = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId: 'x', amount: 100, provider: 'stripe' } });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('ORDER_NOT_FOUND');
    });
  });

  describe('POST /payments/:id/authorize', () => {
    it('should reject public authorize with 403 PROVIDER_CONFIRMATION_REQUIRED', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/authorize`, { token: consumerToken, body: { providerTransactionId: 'pi_123' } });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('PROVIDER_CONFIRMATION_REQUIRED');
    });
  });

  describe('POST /payments/:id/capture', () => {
    it('should reject public capture with 403 PROVIDER_CONFIRMATION_REQUIRED', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/capture`, { token: consumerToken });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('PROVIDER_CONFIRMATION_REQUIRED');
    });
  });

  describe('POST /payments/:id/refund (T-1004)', () => {
    it('should refund a captured payment', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      await paymentService.authorizePayment(pid, 'pi_123');
      await paymentService.capturePayment(pid);
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/refund`, { token: consumerToken });
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.REFUNDED);
      expect(res.body.payment.refundedAt).toBeDefined();
    });
    it('should return 409 when not capturable', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/refund`, { token: consumerToken });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_REFUNDABLE);
    });
    it('should return 409 when already refunded', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      await paymentService.authorizePayment(pid, 'pi_123');
      await paymentService.capturePayment(pid);
      await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/refund`, { token: consumerToken });
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/refund`, { token: consumerToken });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_REFUNDABLE);
    });
    it('should return 404 for non-existent payment', async () => {
      const res = await requestInProcess(app, 'POST', '/api/v1/payments/x/refund', { token: consumerToken });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_FOUND);
    });
  });

  describe('POST /payments/:id/fail (T-1001)', () => {
    it('should fail a pending payment', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/fail`, { token: consumerToken });
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.FAILED);
    });
    it('should be idempotent for an already failed payment', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/fail`, { token: consumerToken });
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/fail`, { token: consumerToken });
      expect(res.status).toBe(200);
      expect(res.body.payment.status).toBe(PaymentStatus.FAILED);
    });
    it('should return 409 when payment is captured', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      await paymentService.authorizePayment(pid, 'pi_123');
      await paymentService.capturePayment(pid);
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/fail`, { token: consumerToken });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_AUTHORIZABLE);
    });
    it('should return 404 for non-owner', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const pid = cr.body.payment.id;
      const other = await requestInProcess(app, 'POST', '/api/v1/auth/register', { body: { name: 'Other', taxIdType: 'CPF', taxIdValue: '12345678909', email: 'other-fail@example.com', password: testPassword, role: PersonRole.CONSUMER } });
      const otherToken = other.body.tokens.accessToken;
      const res = await requestInProcess(app, 'POST', `/api/v1/payments/${pid}/fail`, { token: otherToken });
      expect(res.status).toBe(404);
    });
    it('should return 404 for non-existent payment', async () => {
      const res = await requestInProcess(app, 'POST', '/api/v1/payments/x/fail', { token: consumerToken });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(PaymentError.PAYMENT_NOT_FOUND);
    });
  });

  describe('GET /payments/:id', () => {
    it('should return a payment by ID', async () => {
      const cr = await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const res = await requestInProcess(app, 'GET', `/api/v1/payments/${cr.body.payment.id}`, { token: consumerToken });
      expect(res.status).toBe(200);
      expect(res.body.payment.id).toBe(cr.body.payment.id);
    });
    it('should return 404 for non-existent payment', async () => {
      const res = await requestInProcess(app, 'GET', '/api/v1/payments/x', { token: consumerToken });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /payments/order/:orderId', () => {
    it('should return payments for an order', async () => {
      await requestInProcess(app, 'POST', '/api/v1/payments', { token: consumerToken, body: { orderId, amount: 100, provider: 'stripe' } });
      const res = await requestInProcess(app, 'GET', `/api/v1/payments/order/${orderId}`, { token: consumerToken });
      expect(res.status).toBe(200);
      expect(res.body.payments).toHaveLength(1);
    });
  });
});