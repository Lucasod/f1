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
    // The generated key is used as both pdfUrl and pdfPath without calling the
    // storage adapter, which only accepts image MIME types and rejects empty buffers.
    const pdfUrl = key;
    const pdfPath = key;

    const invoice = Invoice.create({
      orderId: order.id,
      vendorId: resolvedVendorId,
      emissionAt: now,
      pdfUrl,
      pdfPath,
      status: InvoiceStatus.GENERATED,
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
    const key = generateInvoiceKey(invoice.orderId, now.getFullYear(), now.getMonth() + 1);
    // Real PDF generation/storage is deferred (no PDF library, no S3 credentials).
    // The generated key is used as both pdfUrl and pdfPath without calling the
    // storage adapter, which only accepts image MIME types and rejects empty buffers.
    invoice.pdfUrl = key;
    invoice.pdfPath = key;
    invoice.status = InvoiceStatus.GENERATED;
    invoice.updatedAt = new Date();

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
