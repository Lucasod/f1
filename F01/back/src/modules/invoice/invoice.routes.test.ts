import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository, Person } from '../person/person.domain';
import { AuthService } from '../auth/auth.service';
import { createAuthRoutes } from '../auth/auth.routes';
import { hashPassword } from '../auth/credential.domain';
import { PersonRole } from '../person/person.domain';
import { InvoiceService } from './invoice.service';
import { createInvoiceRoutes } from './invoice.routes';
import { Invoice, InvoiceStatus, InMemoryInvoiceRepository } from './invoice.domain';
import { InMemoryVendorRepository, Vendor } from '../vendor/vendor.domain';
import { Order, OrderStatus, InMemoryOrderRepository } from '../order/order.domain';
import { StorageAdapter } from '../../shared/storage/storage.interface';
import 'dotenv/config';

const VALID_CPF_1 = '52998224725';
const testPassword =  process.env.TEST_USER_PASSWORD!;

describe('Invoice Routes (T-1103)', () => {
  let app: express.Express;
  let personRepo: InMemoryPersonRepository;
  let authService: AuthService;
  let invoiceRepo: InMemoryInvoiceRepository;
  let orderRepo: InMemoryOrderRepository;
  let vendorRepo: InMemoryVendorRepository;
  let storageAdapter: StorageAdapter;
  let invoiceService: InvoiceService;
  let consumerToken: string;
  let adminToken: string;
  let vendorToken: string;
  let invoiceId: string;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
    invoiceRepo = new InMemoryInvoiceRepository();
    orderRepo = new InMemoryOrderRepository();
    vendorRepo = new InMemoryVendorRepository();
    storageAdapter = {
      save: vi.fn().mockResolvedValue({ url: 'https://cdn.example.com/invoices/o.pdf', key: 'invoices/2026/10/o.pdf' }),
      delete: vi.fn(),
      getUrl: vi.fn(),
      validateFile: vi.fn(),
      sanitizeKey: vi.fn((k: string) => k),
    } as unknown as StorageAdapter;
    invoiceService = new InvoiceService(invoiceRepo, orderRepo, storageAdapter);

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));
    app.use('/api/v1/invoices', createInvoiceRoutes({ authService, invoiceService, orderRepo, vendorRepo }));

    // Admin
    const adminPerson = Person.create({
      name: 'Admin', mainInfo: { name: 'Admin', taxIdType: 'CPF', taxIdValue: '98765432100' },
      contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
      addresses: []
    });
    adminPerson.addRole(PersonRole.ADMIN);
    adminPerson.setCredential(await hashPassword(testPassword));
    await personRepo.save(adminPerson);
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: testPassword });
    adminToken = adminLogin.body.tokens.accessToken;

    // Consumer
    const consumerRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Consumer', taxIdType: 'CPF', taxIdValue: VALID_CPF_1, email: 'c@example.com', password: testPassword, role: PersonRole.CONSUMER });
    consumerToken = consumerRegister.body.tokens.accessToken;

    // Vendor (similar to payment.routes.test.ts pattern)
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

    const vendorLogin = await request(app).post('/api/v1/auth/login').send({ email: 'v@example.com', password: testPassword });
    vendorToken = vendorLogin.body.tokens.accessToken;

    // Seed an invoice (vendor-1's order)
    const order = Order.create({
      personId: 'person-x',
      vendorGroups: [{ vendorId: 'vendor-1', items: [{ productId: 'p1', productName: 'Prod', vendorId: 'vendor-1', quantity: 1, unitPrice: 10 }], commissionPct: 10 }],
      shippingAddress: { street: 's', number: '1', neighborhood: 'n', city: 'c', state: 'st', isPrimary: true },
    });
    order.transitionTo(OrderStatus.PAID);
    await orderRepo.save(order);

    const invoice = Invoice.create({ orderId: order.id, vendorId: 'vendor-1', status: InvoiceStatus.PENDING });
    await invoiceRepo.save(invoice);
    invoiceId = invoice.id;
  });

  describe('auth guards', () => {
    it('GET /invoices requires auth', async () => {
      const res = await request(app).get('/api/v1/invoices');
      expect(res.status).toBe(401);
    });
    it('POST generate requires admin', async () => {
      const res = await request(app).post(`/api/v1/invoices/${invoiceId}/generate`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /invoices', () => {
    it('admin lists invoices', async () => {
      const res = await request(app).get('/api/v1/invoices').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoices).toHaveLength(1);
    });
    it('consumer cannot list invoices (403)', async () => {
      const res = await request(app).get('/api/v1/invoices').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(403);
    });
    it('vendor cannot list invoices (403)', async () => {
      const res = await request(app).get('/api/v1/invoices').set('Authorization', `Bearer ${vendorToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /invoices/:invoiceId', () => {
    it('returns invoice', async () => {
      const res = await request(app).get(`/api/v1/invoices/${invoiceId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.id).toBe(invoiceId);
    });
    it('vendor can access invoice for their order (200)', async () => {
      const res = await request(app).get(`/api/v1/invoices/${invoiceId}`).set('Authorization', `Bearer ${vendorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.id).toBe(invoiceId);
    });
    it('vendor cannot access invoice for another vendor order (404)', async () => {
      const otherOrder = Order.create({
        personId: 'person-y',
        vendorGroups: [{ vendorId: 'vendor-2', items: [{ productId: 'p2', productName: 'Prod2', vendorId: 'vendor-2', quantity: 1, unitPrice: 20 }], commissionPct: 10 }],
        shippingAddress: { street: 's2', number: '2', neighborhood: 'n2', city: 'c2', state: 'st', isPrimary: true },
      });
      otherOrder.transitionTo(OrderStatus.PAID);
      await orderRepo.save(otherOrder);
      const otherInvoice = Invoice.create({ orderId: otherOrder.id, vendorId: 'vendor-2', pdfUrl: 'https://cdn.example.com/invoices/o2.pdf', pdfPath: 'invoices/2026/10/o2.pdf' });
      await invoiceRepo.save(otherInvoice);
      const res = await request(app).get(`/api/v1/invoices/${otherInvoice.id}`).set('Authorization', `Bearer ${vendorToken}`);
      expect(res.status).toBe(404);
    });
    it('returns 404 for non-existent', async () => {
      const res = await request(app).get('/api/v1/invoices/nope').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /invoices/order/:orderId', () => {
    it('returns invoice by order', async () => {
      // need orderId; fetch from invoice
      const inv = await invoiceRepo.findById(invoiceId);
      const res = await request(app).get(`/api/v1/invoices/order/${inv!.orderId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.id).toBe(invoiceId);
    });
  });

  describe('POST /invoices/:invoiceId/generate', () => {
    it('regenerates pdf as admin', async () => {
      const res = await request(app).post(`/api/v1/invoices/${invoiceId}/generate`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.status).toBe(InvoiceStatus.GENERATED);
      expect(res.body.invoice.pdfUrl).toBe('https://cdn.example.com/invoices/o.pdf');
    });
    it('returns 404 for non-existent', async () => {
      const res = await request(app).post('/api/v1/invoices/nope/generate').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /invoices/:invoiceId/download', () => {
    it('returns 404 when pdf not yet generated', async () => {
      const res = await request(app).get(`/api/v1/invoices/${invoiceId}/download`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('PDF not yet generated');
    });
    it('returns 404 for non-existent', async () => {
      const res = await request(app).get('/api/v1/invoices/nope/download').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(404);
    });
  });
});
