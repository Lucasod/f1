import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceService } from './invoice.service';
import { Invoice, InvoiceStatus, InvoiceError, InMemoryInvoiceRepository } from './invoice.domain';
import { Order, OrderStatus, InMemoryOrderRepository } from '../order/order.domain';
import { StorageAdapter } from '../../shared/storage/storage.interface';

describe('Invoice Service (T-1103)', () => {
  let invoiceRepo: InMemoryInvoiceRepository;
  let orderRepo: InMemoryOrderRepository;
  let storageAdapter: StorageAdapter;
  let service: InvoiceService;

  beforeEach(() => {
    invoiceRepo = new InMemoryInvoiceRepository();
    orderRepo = new InMemoryOrderRepository();
    storageAdapter = {
      save: vi.fn().mockResolvedValue({ url: 'https://cdn.example.com/invoices/o.pdf', key: 'invoices/2026/10/o.pdf' }),
      delete: vi.fn(),
      getUrl: vi.fn(),
      validateFile: vi.fn(),
      sanitizeKey: vi.fn((k: string) => k),
    } as unknown as StorageAdapter;
    service = new InvoiceService(invoiceRepo, orderRepo, storageAdapter);
  });

  async function createOrder(status: OrderStatus = OrderStatus.DELIVERED): Promise<Order> {
    const order = Order.create({
      personId: 'person-1',
      vendorGroups: [{ vendorId: 'vendor-1', items: [{ productId: 'p1', productName: 'Prod', vendorId: 'vendor-1', quantity: 1, unitPrice: 10 }], commissionPct: 10 }],
      shippingAddress: { street: 's', number: '1', neighborhood: 'n', city: 'c', state: 'st', isPrimary: true },
    });
    if (status !== OrderStatus.PENDING_PAYMENT) {
      order.transitionTo(OrderStatus.PAID);
      if (status === OrderStatus.DELIVERED) {
        order.transitionTo(OrderStatus.PROCESSING);
        order.transitionTo(OrderStatus.SHIPPED);
        order.transitionTo(OrderStatus.DELIVERED);
      } else if (status === OrderStatus.PAID) {
        // stay paid
      }
    }
    await orderRepo.save(order);
    // if status paid, order already paid; if delivered handled
    if (status === OrderStatus.PAID) {
      // no-op
    }
    return order;
  }

  describe('generateInvoice', () => {
    it('generates invoice for eligible delivered order', async () => {
      const order = await createOrder(OrderStatus.DELIVERED);
      const invoice = await service.generateInvoice(order.id, 'vendor-1');
      expect(invoice.status).toBe(InvoiceStatus.GENERATED);
      expect(invoice.orderId).toBe(order.id);
      expect(invoice.pdfUrl).toContain('invoices');
      expect(storageAdapter.save).not.toHaveBeenCalled();
      expect(await invoiceRepo.findByOrderId(order.id)).not.toBeNull();
    });

    it('generates invoice for paid order', async () => {
      const order = await createOrder(OrderStatus.PAID);
      const invoice = await service.generateInvoice(order.id);
      expect(invoice.status).toBe(InvoiceStatus.GENERATED);
      expect(invoice.vendorId).toBe('vendor-1');
    });

    it('throws ORDER_NOT_FOUND for missing order', async () => {
      await expect(service.generateInvoice('nope')).rejects.toThrow(InvoiceError.ORDER_NOT_FOUND);
    });

    it('throws ORDER_NOT_ELIGIBLE for pending order', async () => {
      const order = await createOrder(OrderStatus.PENDING_PAYMENT);
      await expect(service.generateInvoice(order.id)).rejects.toThrow(InvoiceError.ORDER_NOT_ELIGIBLE);
    });

    it('throws INVOICE_ALREADY_EXISTS for duplicate', async () => {
      const order = await createOrder(OrderStatus.DELIVERED);
      await service.generateInvoice(order.id, 'vendor-1');
      await expect(service.generateInvoice(order.id, 'vendor-1')).rejects.toThrow(InvoiceError.INVOICE_ALREADY_EXISTS);
    });
  });

  describe('getInvoice', () => {
    it('returns invoice by id', async () => {
      const order = await createOrder(OrderStatus.DELIVERED);
      const created = await service.generateInvoice(order.id, 'vendor-1');
      const found = await service.getInvoice(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for non-existent', async () => {
      expect(await service.getInvoice('nope')).toBeNull();
    });
  });

  describe('getInvoiceByOrderId', () => {
    it('returns invoice by order', async () => {
      const order = await createOrder(OrderStatus.DELIVERED);
      await service.generateInvoice(order.id, 'vendor-1');
      const found = await service.getInvoiceByOrderId(order.id);
      expect(found).not.toBeNull();
    });

    it('returns null for non-existent', async () => {
      expect(await service.getInvoiceByOrderId('nope')).toBeNull();
    });
  });

  describe('listInvoices', () => {
    it('paginates', async () => {
      for (let i = 0; i < 3; i++) {
        const order = await createOrder(OrderStatus.DELIVERED);
        // need unique orders; createOrder generates unique order id
        await service.generateInvoice(order.id, 'vendor-1');
      }
      const first = await service.listInvoices(1, 2);
      expect(first.invoices).toHaveLength(2);
      expect(first.total).toBe(3);
      expect(first.page).toBe(1);
      expect(first.limit).toBe(2);
      const second = await service.listInvoices(2, 2);
      expect(second.invoices).toHaveLength(1);
    });
  });
});
