import { describe, it, expect } from 'vitest';
import { Invoice, InvoiceStatus, InvoiceError, InMemoryInvoiceRepository } from './invoice.domain';

describe('Invoice Domain (T-1103)', () => {
  describe('Invoice.create', () => {
    it('creates an invoice with valid data', () => {
      const invoice = Invoice.create({ orderId: 'order-1', vendorId: 'vendor-1' });
      expect(invoice.status).toBe(InvoiceStatus.PENDING);
      expect(invoice.orderId).toBe('order-1');
      expect(invoice.vendorId).toBe('vendor-1');
      expect(invoice.id).toBeTruthy();
      expect(invoice.emissionAt).toBeInstanceOf(Date);
      expect(invoice.createdAt).toBeInstanceOf(Date);
      expect(invoice.updatedAt).toBeInstanceOf(Date);
    });

    it('stores optional pdf fields', () => {
      const invoice = Invoice.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        pdfUrl: 'https://cdn.example.com/invoices/x.pdf',
        pdfPath: 'invoices/2026/10/order-1.pdf',
      });
      expect(invoice.pdfUrl).toBe('https://cdn.example.com/invoices/x.pdf');
      expect(invoice.pdfPath).toBe('invoices/2026/10/order-1.pdf');
    });

    it('throws INVALID_INVOICE when orderId empty', () => {
      expect(() => Invoice.create({ orderId: '', vendorId: 'v' })).toThrow(InvoiceError.INVALID_INVOICE);
    });

    it('throws INVALID_INVOICE when vendorId empty', () => {
      expect(() => Invoice.create({ orderId: 'o', vendorId: '' })).toThrow(InvoiceError.INVALID_INVOICE);
    });

    it('throws INVALID_INVOICE for invalid status', () => {
      expect(() => Invoice.create({ orderId: 'o', vendorId: 'v', status: 'bad' as any })).toThrow(InvoiceError.INVALID_INVOICE);
    });

    it('allows PENDING status', () => {
      const invoice = Invoice.create({ orderId: 'o', vendorId: 'v', status: InvoiceStatus.PENDING });
      expect(invoice.status).toBe(InvoiceStatus.PENDING);
      expect(invoice.pdfUrl).toBe('');
      expect(invoice.pdfPath).toBe('');
    });

    it('markGenerated transitions to GENERATED with urls', () => {
      const invoice = Invoice.create({ orderId: 'o', vendorId: 'v', status: InvoiceStatus.PENDING });
      invoice.markGenerated('https://cdn.example.com/invoices/x.pdf', 'invoices/2026/10/x.pdf');
      expect(invoice.status).toBe(InvoiceStatus.GENERATED);
      expect(invoice.pdfUrl).toBe('https://cdn.example.com/invoices/x.pdf');
      expect(invoice.pdfPath).toBe('invoices/2026/10/x.pdf');
    });
  });

  describe('Invoice.reconstruct', () => {
    it('reconstructs from data', () => {
      const now = new Date();
      const data = {
        id: 'inv-1',
        orderId: 'order-1',
        vendorId: 'vendor-1',
        emissionAt: now,
        pdfUrl: 'url',
        pdfPath: 'path',
        status: InvoiceStatus.SENT,
        createdAt: now,
        updatedAt: now,
      };
      const invoice = Invoice.reconstruct(data);
      expect(invoice.id).toBe('inv-1');
      expect(invoice.status).toBe(InvoiceStatus.SENT);
      expect(invoice.toJSON()).toEqual(data);
    });
  });

  describe('InMemoryInvoiceRepository', () => {
    it('save/find/update/findByOrderId', async () => {
      const repo = new InMemoryInvoiceRepository();
      const invoice = Invoice.create({ orderId: 'order-1', vendorId: 'vendor-1' });
      await repo.save(invoice);
      expect(await repo.findById(invoice.id)).not.toBeNull();
      expect(await repo.findByOrderId('order-1')).not.toBeNull();
      expect(await repo.findAll()).toHaveLength(1);
      invoice.markSent();
      await repo.update(invoice);
      expect((await repo.findById(invoice.id))!.status).toBe(InvoiceStatus.SENT);
    });

    it('update non-existent throws', async () => {
      const repo = new InMemoryInvoiceRepository();
      const invoice = Invoice.create({ orderId: 'order-1', vendorId: 'vendor-1' });
      await expect(repo.update(invoice)).rejects.toThrow(InvoiceError.INVOICE_NOT_FOUND);
    });
  });
});
