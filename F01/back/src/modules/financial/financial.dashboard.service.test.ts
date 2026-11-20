import { describe, it, expect, beforeEach } from 'vitest';
import { VendorFinancialDashboardService } from './financial.dashboard.service';
import { Vendor, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Order, OrderStatus, InMemoryOrderRepository } from '../order/order.domain';
import { Payment, PaymentStatus, InMemoryPaymentRepository } from '../order/order.domain';
import { Payout, PayoutStatus, InMemoryPayoutRepository } from '../payout/payout.domain';
import { FinancialAllocation, FinancialAllocationType, InMemoryFinancialAllocationRepository } from './financial.domain';
import { FinancialMovementRecord, InMemoryFinancialMovementRepository, MovementType } from './financial.movement';

describe('VendorFinancialDashboardService (FIND-A02-P1-001: currency BRL)', () => {
  let vendorRepo: InMemoryVendorRepository;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let payoutRepo: InMemoryPayoutRepository;
  let allocationRepo: InMemoryFinancialAllocationRepository;
  let movementRepo: InMemoryFinancialMovementRepository;
  let service: VendorFinancialDashboardService;

  let vendor: Vendor;
  let order: Order;
  let payment: Payment;

  beforeEach(() => {
    vendorRepo = new InMemoryVendorRepository();
    orderRepo = new InMemoryOrderRepository();
    paymentRepo = new InMemoryPaymentRepository();
    payoutRepo = new InMemoryPayoutRepository();
    allocationRepo = new InMemoryFinancialAllocationRepository();
    movementRepo = new InMemoryFinancialMovementRepository();
    service = new VendorFinancialDashboardService(
      vendorRepo, orderRepo, paymentRepo, movementRepo, allocationRepo, payoutRepo
    );

    vendor = Vendor.create({
      personId: 'person-1',
      name: 'Test Vendor',
      storeName: 'Test Store',
      slug: 'test-store',
      commissionPct: 10,
    });
    vendor.id = 'vendor-1';
    void vendorRepo.save(vendor);

    order = Order.create({
      personId: 'person-1',
      vendorGroups: [{
        vendorId: 'vendor-1',
        items: [{
          productId: 'product-1',
          productName: 'Product 1',
          vendorId: 'vendor-1',
          quantity: 1,
          unitPrice: 100
        }],
        commissionPct: 10
      }],
      shippingAddress: {
        id: 'addr-1',
        street: 'Test Street',
        number: '123',
        neighborhood: 'Test Neighborhood',
        city: 'Test City',
        state: 'TS',
        isPrimary: true
      }
    });
    order.transitionTo(OrderStatus.PAID);
    void orderRepo.save(order);

    payment = Payment.create({
      orderId: order.id,
      personId: 'person-1',
      amount: 100,
    });
    payment.authorize('txn_test_123');
    payment.capture();
    void paymentRepo.save(payment);
  });

  it('getVendorDashboard returns history entries with BRL currency (not USD)', async () => {
    const dashboard = await service.getVendorDashboard('vendor-1');

    // All history entries should use BRL as the transaction currency (CD-054)
    for (const entry of dashboard.history) {
      expect(entry.currency).toBe('BRL');
    }

    // Should have at least one payment entry with BRL
    const paymentEntries = dashboard.history.filter(e => e.relatedEntityType === 'payment');
    expect(paymentEntries.length).toBeGreaterThan(0);
    for (const entry of paymentEntries) {
      expect(entry.currency).toBe('BRL');
    }
  });
  it('uses the capture date for the selected period and the order group net', async () => {
    const beforeCapture = new Date(payment.capturedAt!.getTime() - 1000);
    const afterCapture = new Date(payment.capturedAt!.getTime() + 1000);
    vendor.commissionPct = 50;
    expect((await service.getVendorDashboard('vendor-1', beforeCapture, afterCapture)).netExpectedAmount).toBe(90);
    const outsidePeriod = await service.getVendorDashboard('vendor-1', afterCapture, new Date(afterCapture.getTime() + 1000));
    expect(outsidePeriod.grossSales).toBe(0);
    expect(outsidePeriod.netExpectedAmount).toBe(0);
  });
  it('does not count unpaid or duplicated captures in vendor sales history', async () => {
    const unpaid = Payment.create({ orderId: order.id, personId: 'person-1', amount: 100 });
    await paymentRepo.save(unpaid);
    const allocation = FinancialAllocation.create({ orderId: order.id, vendorId: 'vendor-1', type: FinancialAllocationType.CAPTURE, gross: 100, fees: 10, net: 90, referenceId: payment.id });
    await allocationRepo.save(allocation);
    const dashboard = await service.getVendorDashboard('vendor-1');
    const sales = dashboard.history.filter(entry => entry.movementType === MovementType.CONSUMER_PAYMENT);
    expect(sales.map(entry => entry.amount)).toEqual([100]);
  });
  it('does not expose another vendor or unassigned movements from a shared order', async () => {
    const now = new Date();
    for (const vendorId of ['vendor-1', 'vendor-2', undefined]) {
      await movementRepo.save(FinancialMovementRecord.create({
        movementType: MovementType.VENDOR_TRANSFER,
        amount: vendorId === 'vendor-1' ? 30 : 900,
        currency: 'brl', relatedEntityType: 'transfer',
        relatedEntityId: `transfer-${vendorId}`, orderId: order.id, vendorId,
        effectiveAt: now, recordedAt: now,
      }));
    }
    const dashboard = await service.getVendorDashboard('vendor-1');
    const transfers = dashboard.history.filter(entry => entry.relatedEntityType === 'transfer');
    expect(transfers.map(entry => entry.relatedEntityId)).toEqual(['transfer-vendor-1']);
  });

  it('does not expose the full payment amount of a multi-vendor order', async () => {
    const sharedOrder = Order.create({
      personId: 'buyer',
      vendorGroups: [
        { vendorId: 'vendor-1', commissionPct: 10, items: [{ productId: 'p1', productName: 'A', vendorId: 'vendor-1', quantity: 1, unitPrice: 20 }] },
        { vendorId: 'vendor-2', commissionPct: 10, items: [{ productId: 'p2', productName: 'B', vendorId: 'vendor-2', quantity: 1, unitPrice: 500 }] },
      ],
      shippingAddress: { id: 'a', street: 'Street', number: '1', neighborhood: 'N', city: 'City', state: 'SP', isPrimary: true },
    });
    await orderRepo.save(sharedOrder);
    const sharedPayment = Payment.create({ orderId: sharedOrder.id, personId: 'buyer', amount: 520 });
    sharedPayment.authorize('simulated-reference');
    sharedPayment.capture();
    await paymentRepo.save(sharedPayment);
    const dashboard = await service.getVendorDashboard('vendor-1');
    expect(dashboard.history.find(entry => entry.id === sharedPayment.id)?.amount).toBe(20);
  });

  it('does not count ledger authorization and capture movements as additional sales', async () => {
    for (const id of ['authorization', 'capture']) {
      await movementRepo.save(FinancialMovementRecord.create({ movementType: MovementType.CONSUMER_PAYMENT, amount: 100, currency: 'BRL', relatedEntityType: 'payment', relatedEntityId: payment.id, orderId: order.id, vendorId: 'vendor-1', effectiveAt: new Date(), recordedAt: new Date() }));
    }
    const dashboard = await service.getVendorDashboard('vendor-1');
    expect(dashboard.history.filter(entry => entry.movementType === MovementType.CONSUMER_PAYMENT).map(entry => entry.amount)).toEqual([100]);
  });

});
