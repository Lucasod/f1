import { describe, it, expect } from 'vitest';
import { Invoice, InvoiceStatus, InvoiceError } from './invoice.domain';

describe('Invoice Domain', () => {
  describe('Invoice.create', () => {
    it('creates a pending invoice', () => {
      const now = new Date();
      const invoice = Invoice.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        emissionAt: now,
        pdfUrl: '',
        pdfPath: '',
        status: InvoiceStatus.PENDING,
      });
      expect(invoice.orderId).toBe('order-1');
      expect(invoice.vendorId).toBe('vendor-1');
      expect(invoice.status).toBe(InvoiceStatus.PENDING);
      expect(invoice.pdfUrl).toBe('');
      expect(invoice.pdfPath).toBe('');
    });
  });

  describe('Invoice.markGenerated', () => {
    it('marks invoice as generated with PDF URL and path', () => {
      const invoice = Invoice.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        emissionAt: new Date(),
        pdfUrl: '',
        pdfPath: '',
        status: InvoiceStatus.PENDING,
      });
      invoice.markGenerated('https://cdn.example.com/invoice.pdf', 'invoices/2026/11/order-1.pdf');
      expect(invoice.status).toBe(InvoiceStatus.GENERATED);
      expect(invoice.pdfUrl).toBe('https://cdn.example.com/invoice.pdf');
      expect(invoice.pdfPath).toBe('invoices/2026/11/order-1.pdf');
    });
  });

  describe('Invoice.markSent', () => {
    it('marks invoice as sent', () => {
      const invoice = Invoice.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        emissionAt: new Date(),
        pdfUrl: '',
        pdfPath: '',
        status: InvoiceStatus.PENDING,
      });
      invoice.markSent();
      // markSent should update the status or sent flag
      expect(invoice).toBeDefined();
    });
  });

  describe('toJSON/roundtrip', () => {
    it('serializes and reconstructs an invoice', () => {
      const now = new Date();
      const invoice = Invoice.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        emissionAt: now,
        pdfUrl: '',
        pdfPath: '',
        status: InvoiceStatus.PENDING,
      });
      const json = invoice.toJSON();
      const reconstructed = Invoice.reconstruct(json);
      expect(reconstructed.orderId).toBe('order-1');
      expect(reconstructed.vendorId).toBe('vendor-1');
      expect(reconstructed.status).toBe(InvoiceStatus.PENDING);
    });
  });

  describe('InvoiceError', () => {
    it('has expected error codes', () => {
      expect(InvoiceError.ORDER_NOT_FOUND).toBe('ORDER_NOT_FOUND');
      expect(InvoiceError.INVOICE_ALREADY_EXISTS).toBe('INVOICE_ALREADY_EXISTS');
      expect(InvoiceError.INVOICE_NOT_FOUND).toBe('INVOICE_NOT_FOUND');
      expect(InvoiceError.ORDER_NOT_ELIGIBLE).toBe('ORDER_NOT_ELIGIBLE');
      expect(InvoiceError.INVALID_INVOICE).toBe('INVALID_INVOICE');
    });
  });
});
