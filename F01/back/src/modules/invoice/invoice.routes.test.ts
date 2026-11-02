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
import { Invoice, InMemoryInvoiceRepository } from './invoice.domain';
import { Order, OrderStatus, InMemoryOrderRepository } from '../order/order.domain';
import { StorageAdapter } from '../../shared/storage/storage.interface';

const VALID_CPF_1 = '52998224725';
const testPassword = 'SecurePass123!';

describe('Invoice Routes (T-1103)', () => {
  let app: express.Express;
  let personRepo: InMemoryPersonRepository;
  let authService: AuthService;
  let invoiceRepo: InMemoryInvoiceRepository;
  let orderRepo: InMemoryOrderRepository;
  let storageAdapter: StorageAdapter;
  let invoiceService: InvoiceService;
  let consumerToken: string;
  let adminToken: string;
  let invoiceId: string;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
    invoiceRepo = new InMemoryInvoiceRepository();
    orderRepo = new InMemoryOrderRepository();
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
    app.use('/api/v1/invoices', createInvoiceRoutes({ authService, invoiceService }));

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

    // Seed an invoice
    const order = Order.create({
      personId: 'person-x',
      vendorGroups: [{ vendorId: 'vendor-1', items: [{ productId: 'p1', productName: 'Prod', vendorId: 'vendor-1', quantity: 1, unitPrice: 10 }], commissionPct: 10 }],
      shippingAddress: { street: 's', number: '1', neighborhood: 'n', city: 'c', state: 'st', isPrimary: true },
    });
    order.transitionTo(OrderStatus.PAID);
    await orderRepo.save(order);

    const invoice = Invoice.create({ orderId: order.id, vendorId: 'vendor-1', pdfUrl: 'https://cdn.example.com/invoices/o.pdf', pdfPath: 'invoices/2026/10/o.pdf' });
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
    it('lists invoices', async () => {
      const res = await request(app).get('/api/v1/invoices').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoices).toHaveLength(1);
    });
  });

  describe('GET /invoices/:invoiceId', () => {
    it('returns invoice', async () => {
      const res = await request(app).get(`/api/v1/invoices/${invoiceId}`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.id).toBe(invoiceId);
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
      const res = await request(app).get(`/api/v1/invoices/order/${inv!.orderId}`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.id).toBe(invoiceId);
    });
  });

  describe('POST /invoices/:invoiceId/generate', () => {
    it('regenerates pdf as admin', async () => {
      const res = await request(app).post(`/api/v1/invoices/${invoiceId}/generate`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.pdfUrl).toBeTruthy();
    });
    it('returns 404 for non-existent', async () => {
      const res = await request(app).post('/api/v1/invoices/nope/generate').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /invoices/:invoiceId/download', () => {
    it('returns pdfUrl', async () => {
      const res = await request(app).get(`/api/v1/invoices/${invoiceId}/download`).set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.pdfUrl).toBeTruthy();
    });
    it('returns 404 for non-existent', async () => {
      const res = await request(app).get('/api/v1/invoices/nope/download').set('Authorization', `Bearer ${consumerToken}`);
      expect(res.status).toBe(404);
    });
  });
});
