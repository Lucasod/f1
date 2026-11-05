import { Invoice, InvoiceStatus, InvoiceError, InvoiceRepository } from './invoice.domain';
import { OrderRepository, OrderStatus } from '../order/order.domain';
import { StorageAdapter } from '../../shared/storage/storage.interface';
import { generateInvoiceKey } from '../../shared/storage/s3.key-generator';

export class InvoiceService {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly orderRepo: OrderRepository,
    private readonly storageAdapter?: StorageAdapter,
  ) {}

  async generateInvoice(orderId: string, vendorId?: string): Promise<Invoice> {
    if (typeof orderId !== 'string' || orderId.trim().length === 0) {
      throw new Error(InvoiceError.ORDER_NOT_FOUND);
    }

    const order = await this.orderRepo.findById(orderId.trim());
    if (!order) {
      throw new Error(InvoiceError.ORDER_NOT_FOUND);
    }

    if (order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.PAID) {
      throw new Error(InvoiceError.ORDER_NOT_ELIGIBLE);
    }

    const existing = await this.invoiceRepo.findByOrderId(order.id);
    if (existing) {
      throw new Error(InvoiceError.INVOICE_ALREADY_EXISTS);
    }

    const resolvedVendorId =
      typeof vendorId === 'string' && vendorId.trim().length > 0
        ? vendorId.trim()
        : order.vendorGroups.length > 0
          ? order.vendorGroups[0].vendorId
          : '';

    if (resolvedVendorId.length === 0) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }

    const now = new Date();
    const key = generateInvoiceKey(order.id, now.getFullYear(), now.getMonth() + 1);
    // Real PDF generation/storage is deferred (no PDF library, no S3 credentials).
    // A generated storage key is NOT proof that a PDF exists, so it must not be
    // exposed as a downloadable URL. The invoice is represented as PENDING until
    // actual PDF bytes are generated and stored (via markGenerated). The key is
    // regenerated when real PDF generation is implemented.
    // Key generated but not stored per CD-035; PDF generation/storage deferred.
    // The invoice remains PENDING until actual PDF bytes are generated and stored.
    key;

    const invoice = Invoice.create({
      orderId: order.id,
      vendorId: resolvedVendorId,
      emissionAt: now,
      pdfUrl: '',
      pdfPath: '',
      status: InvoiceStatus.PENDING,
    });

    return this.invoiceRepo.save(invoice);
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    if (typeof invoiceId !== 'string' || invoiceId.trim().length === 0) {
      return null;
    }
    return this.invoiceRepo.findById(invoiceId.trim());
  }

  async getInvoiceByOrderId(orderId: string): Promise<Invoice | null> {
    if (typeof orderId !== 'string' || orderId.trim().length === 0) {
      return null;
    }
    return this.invoiceRepo.findByOrderId(orderId.trim());
  }

  async listInvoices(
    page: number = 1,
    limit: number = 20,
  ): Promise<{ invoices: Invoice[]; items: Invoice[]; total: number; page: number; limit: number }> {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }

    const all = await this.invoiceRepo.findAll();
    const sorted = [...all].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const total = sorted.length;
    const start = (page - 1) * limit;
    const slice = sorted.slice(start, start + limit);

    return { invoices: slice, items: slice, total, page, limit };
  }

  async regeneratePdf(invoiceId: string): Promise<Invoice> {
    if (typeof invoiceId !== 'string' || invoiceId.trim().length === 0) {
      throw new Error(InvoiceError.INVOICE_NOT_FOUND);
    }

    const invoice = await this.invoiceRepo.findById(invoiceId.trim());
    if (!invoice) {
      throw new Error(InvoiceError.INVOICE_NOT_FOUND);
    }

    const now = new Date();
    const order = await this.orderRepo.findById(invoice.orderId);

    invoice.pdfUrl = '';
    invoice.pdfPath = '';
    invoice.status = InvoiceStatus.PENDING;
    invoice.updatedAt = new Date();
    await this.invoiceRepo.update(invoice);

    if (this.storageAdapter && order) {
      try {
        await this.generatePdfForInvoice(invoice, order);
      } catch {
        // leave pending
      }
    }

    return (await this.invoiceRepo.findById(invoice.id)) ?? invoice;
  }

  private async generatePdfForInvoice(invoice: Invoice, order: any): Promise<Invoice> {
    if (!this.storageAdapter) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    const now = new Date();
    const key = generateInvoiceKey(invoice.orderId, now.getFullYear(), now.getMonth() + 1);
    const buffer = await this.buildPdf(invoice, order);
    const result = await this.storageAdapter.save(buffer, key, 'application/pdf');
    invoice.markGenerated(result.url, result.key);
    return this.invoiceRepo.update(invoice);
  }

  private async buildPdf(invoice: Invoice, order: any): Promise<Buffer> {
    const PDFDocument = require('pdfkit');
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument();
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(18).text('Invoice', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Invoice ID: ${invoice.id}`);
        doc.text(`Order ID: ${invoice.orderId}`);
        doc.text(`Vendor ID: ${invoice.vendorId}`);
        doc.text(`Emission: ${invoice.emissionAt.toISOString()}`);
        doc.text(`Status: ${invoice.status}`);
        doc.moveDown();
        doc.text('Items:');
        const groups = Array.isArray(order?.vendorGroups) ? order.vendorGroups : [];
        for (const vg of groups) {
          for (const item of (vg.items ?? [])) {
            doc.text(`- ${item.productName} x${item.quantity} @ ${item.unitPrice} = ${item.totalPrice}`);
          }
        }
        doc.moveDown();
        doc.text(`Total: ${order?.totalAmount ?? ''}`);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  async generatePdf(invoiceId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findById(invoiceId.trim());
    if (!invoice) throw new Error(InvoiceError.INVOICE_NOT_FOUND);
    const order = await this.orderRepo.findById(invoice.orderId);
    if (!order) throw new Error(InvoiceError.ORDER_NOT_FOUND);
    if (invoice.status !== InvoiceStatus.PENDING) {
      // reset to pending to allow regeneration
      invoice.pdfUrl = '';
      invoice.pdfPath = '';
      invoice.status = InvoiceStatus.PENDING;
      invoice.updatedAt = new Date();
      await this.invoiceRepo.update(invoice);
    }
    if (!this.storageAdapter) {
      throw new Error(InvoiceError.INVALID_INVOICE);
    }
    return this.generatePdfForInvoice(invoice, order);
  }

  async markGenerated(invoiceId: string, pdfUrl: string, pdfPath: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findById(invoiceId.trim());
    if (!invoice) throw new Error(InvoiceError.INVOICE_NOT_FOUND);
    invoice.markGenerated(pdfUrl, pdfPath);
    return this.invoiceRepo.update(invoice);
  }

  async markInvoiceSent(invoiceId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findById(invoiceId.trim());
    if (!invoice) {
      throw new Error(InvoiceError.INVOICE_NOT_FOUND);
    }
    invoice.markSent();
    return this.invoiceRepo.update(invoice);
  }
}
