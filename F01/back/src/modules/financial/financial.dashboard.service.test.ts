import { describe, it, expect, beforeEach } from 'vitest';
import { VendorFinancialDashboardService } from './financial.dashboard.service';
import { Vendor, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Order, OrderStatus, InMemoryOrderRepository } from '../order/order.domain';
import { Payment, PaymentStatus, InMemoryPaymentRepository } from '../order/order.domain';
import { Payout, PayoutStatus, InMemoryPayoutRepository } from '../payout/payout.domain';
import { FinancialAllocation, FinancialAllocationType, InMemoryFinancialAllocationRepository } from './financial.domain';
import { InMemoryFinancialMovementRepository } from './financial.movement';

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
});
