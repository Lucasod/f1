import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { PersonRole } from '../person/person.domain';
import { InMemoryVendorRepository, Vendor } from '../vendor/vendor.domain';
import { InMemoryOrderRepository, Order } from '../order/order.domain';
import { Invoice, InvoiceError, InvoiceStatus, InMemoryInvoiceRepository } from './invoice.domain';
import { InvoiceService } from './invoice.service';
import { createInvoiceRoutes } from './invoice.routes';

describe('Receipt global authorization CR007', () => {
  let app: express.Express;
  let order: Order;
  let invoice: Invoice;
  let orders: InMemoryOrderRepository;
  let invoices: InMemoryInvoiceRepository;
  let vendors: InMemoryVendorRepository;
  let service: InvoiceService;
  let actor: { sub: string; roles: PersonRole[] };
  let download: ReturnType<typeof vi.spyOn>;
  let writes: ReturnType<typeof vi.spyOn>[];

  const routes = ['order', 'invoice', 'download'] as const;
  type Route = typeof routes[number];
  const group = (vendorId: string, unitPrice: number) => ({
    vendorId, commissionPct: 10,
    items: [{ productId: `product-${vendorId}`, productName: `Item ${vendorId}`, vendorId, quantity: 2, unitPrice }],
  });

  beforeEach(async () => {
    actor = { sub: 'seller-a', roles: [PersonRole.VENDOR] };
    orders = new InMemoryOrderRepository();
    invoices = new InMemoryInvoiceRepository();
    vendors = new InMemoryVendorRepository();
    for (const suffix of ['a', 'b']) {
      const vendor = Vendor.create({ personId: `seller-${suffix}`, storeName: `Store ${suffix}`, slug: `store-${suffix}`, commissionPct: 10 });
      vendor.id = `vendor-${suffix}`;
      await vendors.save(vendor);
    }
    const buyingVendor = Vendor.create({ personId: 'buyer', storeName: 'Buyer store', slug: 'buyer-store', commissionPct: 10 });
    buyingVendor.id = 'vendor-c';
    await vendors.save(buyingVendor);
    order = Order.create({
      personId: 'buyer', vendorGroups: [group('vendor-a', 10), group('vendor-b', 37)],
      shippingAddress: { street: 'Main', number: '1', neighborhood: 'Center', city: 'City', state: 'ST', isPrimary: true },
    });
    await orders.save(order);
    invoice = Invoice.create({ orderId: order.id, vendorId: 'vendor-a', status: InvoiceStatus.GENERATED,
      pdfUrl: 'https://example.invalid/global-receipt.pdf', pdfPath: 'private/global-receipt.pdf' });
    await invoices.save(invoice);
    service = new InvoiceService(invoices, orders);
    download = vi.spyOn(service, 'downloadInvoice'); // Call through to the real PDFKit service on authorized requests.
    writes = [vi.spyOn(invoices, 'save'), vi.spyOn(invoices, 'update'), vi.spyOn(orders, 'save'),
      vi.spyOn(orders, 'update'), vi.spyOn(service, 'generateInvoice'), vi.spyOn(service, 'generatePdf'), vi.spyOn(service, 'regeneratePdf')];
    // Only identity verification is stubbed; real middleware, routes, service and PDF rendering run locally.
    const authService = { verifyToken: vi.fn(() => ({ ...actor, type: 'access' })) } as unknown as AuthService;
    app = express();
    app.use('/invoices', createInvoiceRoutes({ authService, invoiceService: service, orderRepo: orders, vendorRepo: vendors }));
  });

  function get(route: Route, authenticated = true) {
    const path = route === 'order' ? `order/${order.id}` : `${invoice.id}${route === 'download' ? '/download' : ''}`;
    const call = request(app).get(`/invoices/${path}`);
    return authenticated ? call.auth('fixture-identity', { type: 'bearer' }) : call;
  }

  function expectNoWrites() {
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  }

  async function expectDenied(route: Route) {
    const before = JSON.stringify(invoice.toJSON());
    const res = await get(route);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: InvoiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(download).not.toHaveBeenCalled();
    expectNoWrites();
    expect(JSON.stringify(invoice.toJSON())).toBe(before);
  }

  for (const route of routes) {
    for (const seller of ['a', 'b']) {
      it(`denies multivendor participant ${seller} via ${route}`, async () => {
        actor.sub = `seller-${seller}`;
        await expectDenied(route);
      });
    }

    it(`denies a legacy unrelated invoice label via ${route}`, async () => {
      invoice = Invoice.reconstruct({ ...invoice.toJSON(), vendorId: 'legacy-vendor' });
      vi.spyOn(invoices, 'findById').mockResolvedValue(invoice);
      vi.spyOn(invoices, 'findByOrderId').mockResolvedValue(invoice);
      await expectDenied(route);
    });

    it(`denies a dual-role participant who is not the buyer via ${route}`, async () => {
      actor.roles = [PersonRole.CONSUMER, PersonRole.VENDOR];
      await expectDenied(route);
    });

    for (const identity of ['buyer', 'dual-buyer', 'admin']) {
      it(`preserves complete multivendor receipt for ${identity} via ${route}`, async () => {
        actor = identity === 'admin' ? { sub: 'operator', roles: [PersonRole.ADMIN] }
          : { sub: 'buyer', roles: identity === 'dual-buyer' ? [PersonRole.CONSUMER, PersonRole.VENDOR] : [PersonRole.CONSUMER] };
        const res = await get(route);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        if (route === 'download') {
          expect(res.headers['content-type']).toContain('application/pdf');
          expect(Buffer.isBuffer(res.body)).toBe(true);
          expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
          expect(download).toHaveBeenCalledExactlyOnceWith(invoice.id);
        } else {
          expect(res.body.invoice.id).toBe(invoice.id);
          expect(res.body.invoice.pdfUrl).toBe(invoice.pdfUrl);
        }
        expectNoWrites();
      });
    }

    it(`preserves an entirely owned single-vendor receipt via ${route} without raw storage links`, async () => {
      order = Order.create({ personId: 'buyer', vendorGroups: [group('vendor-a', 10)], shippingAddress: order.shippingAddress });
      vi.spyOn(orders, 'findById').mockResolvedValue(order);
      invoice = Invoice.reconstruct({ ...invoice.toJSON(), orderId: order.id });
      vi.spyOn(invoices, 'findById').mockResolvedValue(invoice);
      vi.spyOn(invoices, 'findByOrderId').mockResolvedValue(invoice);
      const res = await get(route);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      if (route === 'download') {
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
        expect(download).toHaveBeenCalledExactlyOnceWith(invoice.id);
      } else {
        expect(res.body.invoice.id).toBe(invoice.id);
        expect(res.body.invoice).not.toHaveProperty('pdfUrl');
        expect(res.body.invoice).not.toHaveProperty('pdfPath');
      }
      expectNoWrites();
    });

    for (const identity of ['foreign-consumer', 'foreign-vendor']) {
      it(`denies ${identity} via ${route}`, async () => {
        actor = { sub: 'outsider', roles: [identity === 'foreign-consumer' ? PersonRole.CONSUMER : PersonRole.VENDOR] };
        await expectDenied(route);
      });
    }

    it(`requires authentication via ${route}`, async () => {
      const res = await get(route, false);
      expect(res.status).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(download).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it(`allows multiple groups when every item belongs to the same vendor via ${route}`, async () => {
      const own = Order.create({ personId: 'buyer', vendorGroups: [group('vendor-a', 10), group('vendor-a', 37)], shippingAddress: order.shippingAddress });
      const data = own.toJSON();
      data.id = order.id;
      data.vendorGroups.forEach(entry => { entry.orderId = order.id; });
      vi.spyOn(orders, 'findById').mockResolvedValue(data as unknown as Order);
      const res = await get(route);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      if (route === 'download') expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      else {
        expect(res.body.invoice).not.toHaveProperty('pdfUrl');
        expect(res.body.invoice).not.toHaveProperty('pdfPath');
      }
      expectNoWrites();
    });

    it(`denies a missing receipt via ${route} without rendering or writing`, async () => {
      actor = { sub: 'buyer', roles: [PersonRole.CONSUMER] };
      vi.spyOn(invoices, 'findById').mockResolvedValue(null);
      vi.spyOn(invoices, 'findByOrderId').mockResolvedValue(null);
      await expectDenied(route);
    });

    for (const corruption of ['missing-order', 'missing-buyer', 'wrong-order', 'empty-groups', 'missing-groups', 'null-group', 'empty-items', 'missing-items', 'null-item', 'foreign-item', 'missing-item-owner', 'missing-group-owner', 'wrong-group-order', 'wrong-invoice-label']) {
      it(`fails closed for vendor ${corruption} via ${route}`, async () => {
        const own = Order.create({ personId: 'buyer', vendorGroups: [group('vendor-a', 10)], shippingAddress: order.shippingAddress });
        const data = own.toJSON();
        data.id = order.id;
        data.vendorGroups[0].orderId = order.id;
        switch (corruption) {
          case 'missing-buyer': data.personId = ''; break;
          case 'wrong-order': data.id = 'other-order'; break;
          case 'empty-groups': data.vendorGroups = []; break;
          case 'missing-groups': data.vendorGroups = undefined as never; break;
          case 'null-group': data.vendorGroups[0] = null as never; break;
          case 'empty-items': data.vendorGroups[0].items = []; break;
          case 'missing-items': data.vendorGroups[0].items = undefined as never; break;
          case 'null-item': data.vendorGroups[0].items[0] = null as never; break;
          case 'foreign-item': data.vendorGroups[0].items[0].vendorId = 'vendor-b'; break;
          case 'missing-item-owner': data.vendorGroups[0].items[0].vendorId = ''; break;
          case 'missing-group-owner': data.vendorGroups[0].vendorId = ''; break;
          case 'wrong-group-order': data.vendorGroups[0].orderId = 'other-order'; break;
          case 'wrong-invoice-label': invoice = Invoice.reconstruct({ ...invoice.toJSON(), vendorId: 'vendor-b' }); break;
        }
        vi.spyOn(orders, 'findById').mockResolvedValue(corruption === 'missing-order' ? null : data as unknown as Order);
        vi.spyOn(invoices, 'findById').mockResolvedValue(invoice);
        vi.spyOn(invoices, 'findByOrderId').mockResolvedValue(invoice);
        await expectDenied(route);
      });
    }
  }

  it('denies an inconsistent order lookup even for the apparent buyer', async () => {
    actor = { sub: 'buyer', roles: [PersonRole.CONSUMER] };
    vi.spyOn(invoices, 'findByOrderId').mockResolvedValue(Invoice.reconstruct({ ...invoice.toJSON(), orderId: 'other-order' }));
    await expectDenied('order');
  });

  it('keeps list and regeneration Admin-only for vendors and dual-role buyers', async () => {
    for (const roles of [[PersonRole.VENDOR], [PersonRole.CONSUMER, PersonRole.VENDOR]]) {
      actor.roles = roles;
      expect((await request(app).get('/invoices').auth('fixture-identity', { type: 'bearer' })).status).toBe(403);
      expect((await request(app).post(`/invoices/${invoice.id}/generate`).auth('fixture-identity', { type: 'bearer' })).status).toBe(403);
    }
    expectNoWrites();
  });
});
