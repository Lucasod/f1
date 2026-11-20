import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransferService } from './transfer.service';
import { Transfer, TransferStatus } from './transfer.domain';
import { FinancialService } from '../financial/financial.service';
import { Vendor, VendorStatus } from '../vendor/vendor.domain';
import { InMemoryFinancialAllocationRepository } from '../financial/financial.domain';
import {
  InMemoryFinancialMovementRepository,
  FinancialMovementRepository,
} from '../financial/financial.movement';
import {
  InMemoryFinancialEventRepository,
  FinancialEventRepository,
} from '../financial/financial.event';
import {
  Order,
  OrderStatus,
  OrderVendorGroupStatus,
  FinancialStatus,
} from '../order/order.domain';

import Stripe from 'stripe';

// Define mocks before vi.mock (which is hoisted)
const mockStripeIntents = { retrieve: vi.fn() };
const mockStripeAccounts = { retrieve: vi.fn() };
const mockStripeTransfers = {
  create: vi.fn(),
  retrieve: vi.fn(),
};

// Mock vendor repository for test
const mockVendorRepo = {
  findById: vi.fn(),
};

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      this.transfers = mockStripeTransfers;
      this.accounts = mockStripeAccounts;
      this.paymentIntents = mockStripeIntents;
    }),
  };
});

// Keep reference to prevent tree-shaking of mockStripeTransfers
void mockStripeTransfers;

describe('Transfer Service', () => {
  let transferRepo: { save: any; findLastByOrderVendorGroupId: any; findByStripeTransferId: any };
  let orderRepo: { findById: any; save: any };
  let financialService: FinancialService;
  let service: TransferService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeTransfers.create.mockReset();
    mockStripeTransfers.retrieve.mockReset();
    mockStripeAccounts.retrieve.mockReset().mockResolvedValue({ capabilities: { transfers: "active" } });

    // Set up order with vendor group for transfer tests
    const testOrder = Order.reconstruct({
      id: 'order-1',
      personId: 'person-1',
      status: OrderStatus.PAID,
      vendorGroups: [
        {
          id: 'ovg-1',
          orderId: 'order-1',
          vendorId: 'vendor-1',
          status: OrderVendorGroupStatus.CONFIRMED,
          items: [],
          subtotal: 100,
          commissionPct: 10,
          commissionAmount: 10,
          vendorNet: 90,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      shippingAddress: {
        id: 'addr-1',
        street: 'Rua X',
        number: '10',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
      totalAmount: 100,
      financialStatus: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      comment: undefined,
      commentedAt: undefined,
      commentedBy: undefined,
      attemptId: undefined,
      acceptedHash: undefined,
    });

    orderRepo = {
      findById: vi.fn().mockResolvedValue(testOrder),
      save: vi.fn().mockResolvedValue(undefined),
    };

    transferRepo = {
      save: vi.fn().mockResolvedValue(undefined),
      findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      findByStripeTransferId: vi.fn().mockResolvedValue(null),
    };

    financialService = new FinancialService(new InMemoryFinancialAllocationRepository());
    service = new TransferService(
      transferRepo as any,
      financialService,
      'sk_test_fake_key_for_testing_only',
      orderRepo as any,
      undefined as any,       // movementRepo
      undefined as any,       // eventRepo
      mockVendorRepo as any   // vendorRepo
    );
  });

  describe('createTransferWithDetails', () => {
    it('rejects an account without active transfer capability', async () => {
      mockVendorRepo.findById.mockResolvedValue({ stripeAccountId: 'acct_inactive' });
      mockStripeAccounts.retrieve.mockResolvedValue({ capabilities: { transfers: 'inactive' } });
      await expect(service.createTransferWithDetails('order-1', 'ovg-1', 100, 10, 'ch_1')).rejects.toThrow('TRANSFER_CAPABILITY_INACTIVE');
      expect(mockStripeTransfers.create).not.toHaveBeenCalled();
      expect(transferRepo.save).not.toHaveBeenCalled();
    });
    it('creates a transfer with calculated vendor net amount and vendor Stripe account as destination', async () => {
      // Set up vendor with Stripe connected account ID
      mockVendorRepo.findById.mockResolvedValue(
        Vendor.reconstruct({
          id: 'vendor-1',
          personId: 'person-1',
          storeName: 'Test Vendor',
          slug: 'test-vendor',
          status: VendorStatus.ACTIVE,
          commissionPct: 10,
          stripeAccountId: 'acct_test_vendor',
        })
      );

      mockStripeIntents.retrieve.mockResolvedValue({ latest_charge: 'ch_stripe_456' });
      mockStripeTransfers.create.mockResolvedValue({ id: 'tr_stripe_123' } as any);

      const result = await service.createTransferWithDetails(
        'order-1',
        'ovg-1',
        100,
        10,
        'pi_stripe_456',
        1
      );

      expect(result.entity.amount).toBe(90);
      expect(result.entity.currency).toBe('brl');
      expect(result.entity.status).toBe(TransferStatus.COMPLETED);
      expect(result.entity.stripeTransferId).toBe('tr_stripe_123');
      expect(mockStripeTransfers.create).toHaveBeenCalledWith({
        amount: 9000,
        currency: 'brl',
        destination: 'acct_test_vendor',
        source_transaction: 'ch_stripe_456',
        transfer_group: 'order-1',
      }, { idempotencyKey: 'order-1:ovg-1:1' });
    });

    it('rejects a missing connected account before persisting or calling Stripe', async () => {
      mockVendorRepo.findById.mockResolvedValue(null);
      await expect(service.createTransferWithDetails('order-1', 'ovg-1', 100, 10, 'ch_stripe_456')).rejects.toThrow('TRANSFER_DESTINATION_UNAVAILABLE');
      expect(transferRepo.save).not.toHaveBeenCalled();
      expect(mockStripeTransfers.create).not.toHaveBeenCalled();
    });

    it('rejects vendor with empty stripeAccountId (not enabled) without calling Stripe', async () => {
      mockVendorRepo.findById.mockResolvedValue({ stripeAccountId: undefined });
      await expect(service.createTransferWithDetails('order-1', 'ovg-1', 100, 10, 'ch_stripe_456')).rejects.toThrow('TRANSFER_DESTINATION_UNAVAILABLE');
      expect(transferRepo.save).not.toHaveBeenCalled();
      expect(mockStripeTransfers.create).not.toHaveBeenCalled();
    });

    it('rejects vendor with blank stripeAccountId (not enabled) without calling Stripe', async () => {
      mockVendorRepo.findById.mockResolvedValue({ stripeAccountId: '   ' });
      await expect(service.createTransferWithDetails('order-1', 'ovg-1', 100, 10, 'ch_stripe_456')).rejects.toThrow('TRANSFER_DESTINATION_UNAVAILABLE');
      expect(transferRepo.save).not.toHaveBeenCalled();
      expect(mockStripeTransfers.create).not.toHaveBeenCalled();
    });

    it('reports explicit error when Stripe transfers.create fails, transfer not completed', async () => {
      mockVendorRepo.findById.mockResolvedValue({ stripeAccountId: 'acct_vendor' });
      mockStripeAccounts.retrieve.mockResolvedValue({ capabilities: { transfers: 'active' } });
      mockStripeTransfers.create.mockRejectedValue(new Error('STRIPE_CONNECTION_ERROR'));

      await expect(service.createTransferWithDetails('order-1', 'ovg-1', 100, 10, 'ch_stripe_456'))
        .rejects.toThrow('STRIPE_CONNECTION_ERROR');
      expect(mockStripeTransfers.create).toHaveBeenCalled();
      // Entity should be marked failed, not completed
      expect(transferRepo.save).toHaveBeenCalled();
      const savedCalls = transferRepo.save.mock.calls;
      const savedEntity = savedCalls[savedCalls.length - 1][0];
      expect(savedEntity.status).toBe(TransferStatus.FAILED);
    });

    it('is idempotent: returns existing completed transfer', async () => {
      const existingTransfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 90,
        currency: 'brl',
      });
      existingTransfer.stripeTransferId = 'tr_existing';
      existingTransfer.status = TransferStatus.COMPLETED;

      transferRepo.findLastByOrderVendorGroupId.mockResolvedValue(existingTransfer);
      mockStripeTransfers.retrieve.mockResolvedValue({ id: 'tr_existing' } as any);

      const result = await service.createTransferWithDetails(
        'order-1',
        'ovg-1',
        100,
        10,
        'ch_stripe_456',
        1
      );

      expect(result.entity.stripeTransferId).toBe('tr_existing');
      expect(mockStripeTransfers.create).not.toHaveBeenCalled();
    });
  });

  describe('completeTransfer', () => {
    it('marks a pending transfer as completed', async () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 90,
        currency: 'brl',
      });
      transfer.stripeTransferId = 'tr_123';
      transfer.status = TransferStatus.PROCESSING;

      transferRepo.findByStripeTransferId.mockResolvedValue(transfer);
      transferRepo.save.mockImplementation(async (t: Transfer) => {
        Object.assign(transfer, t);
        return t;
      });

      const result = await service.completeTransfer('tr_123');
      expect(result.status).toBe(TransferStatus.COMPLETED);
    });

    it('returns null for unknown transfer', async () => {
      transferRepo.findByStripeTransferId.mockResolvedValue(null);
      const result = await service.completeTransfer('tr_unknown');
      expect(result).toBeNull();
    });
  });

  describe('vendorId resolution in ledger records', () => {
    it('fills vendorId from the order vendor group in movement and event records', async () => {
      const movementRepo = new InMemoryFinancialMovementRepository();
      const eventRepo = new InMemoryFinancialEventRepository();

      const vendorLedgerService = new TransferService(
        transferRepo as any,
        financialService,
        'sk_test_fake_key_for_testing_only',
        orderRepo as any,
        movementRepo,
        eventRepo,
      );

      const orderId = 'order-1';
      const orderVendorGroupId = 'ovg-1';
      const vendorId = 'vendor-1';

      orderRepo.findById.mockResolvedValue(
        Order.reconstruct({
          id: orderId,
          personId: 'person-1',
          status: OrderStatus.PAID,
          vendorGroups: [
            {
              id: orderVendorGroupId,
              orderId,
              vendorId,
              status: OrderVendorGroupStatus.CONFIRMED,
              items: [],
              subtotal: 100,
              commissionPct: 10,
              commissionAmount: 10,
              vendorNet: 90,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          shippingAddress: {
            id: 'addr-1',
            street: 'Rua X',
            number: '10',
            neighborhood: 'Centro',
            city: 'São Paulo',
            state: 'SP',
            isPrimary: true,
          },
          totalAmount: 100,
          financialStatus: FinancialStatus.PAID,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const transfer = Transfer.create({
        orderId,
        orderVendorGroupId,
        amount: 90,
        currency: 'brl',
      });
      transfer.stripeTransferId = 'tr_123';
      transfer.status = TransferStatus.PROCESSING;

      transferRepo.findByStripeTransferId.mockResolvedValue(transfer);
      transferRepo.save.mockResolvedValue(transfer);

      await vendorLedgerService.completeTransfer('tr_123');

      const movements = await movementRepo.findByEntity(
        'transfer',
        transfer.id,
      );
      expect(movements.length).toBeGreaterThan(0);
      expect(movements[0].data.vendorId).toBe(vendorId);

      const events = await eventRepo.findByOrderId(orderId);
      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.data.vendorId === vendorId)).toBe(true);
    });

    it('leaves vendorId undefined when order is not found', async () => {
      const movementRepo = new InMemoryFinancialMovementRepository();
      const eventRepo = new InMemoryFinancialEventRepository();

      const vendorLedgerService = new TransferService(
        transferRepo as any,
        financialService,
        'sk_test_fake_key_for_testing_only',
        orderRepo as any,
        movementRepo,
        eventRepo,
      );

      orderRepo.findById.mockResolvedValue(null);

      const transfer = Transfer.create({
        orderId: 'order-missing',
        orderVendorGroupId: 'ovg-1',
        amount: 90,
        currency: 'brl',
      });
      transfer.stripeTransferId = 'tr_123';
      transfer.status = TransferStatus.PROCESSING;

      transferRepo.findByStripeTransferId.mockResolvedValue(transfer);
      transferRepo.save.mockResolvedValue(transfer);

      await vendorLedgerService.completeTransfer('tr_123');

      const movements = await movementRepo.findByEntity(
        'transfer',
        transfer.id,
      );
      expect(movements.length).toBeGreaterThan(0);
      expect(movements[0].data.vendorId).toBeUndefined();

      const events = await eventRepo.findByOrderId('order-missing');
      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.data.vendorId === undefined)).toBe(true);
    });
  });

  describe('failTransfer', () => {
    it('marks a processing transfer as failed', async () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 90,
        currency: 'brl',
      });
      transfer.stripeTransferId = 'tr_123';
      transfer.status = TransferStatus.PROCESSING;

      transferRepo.findByStripeTransferId.mockResolvedValue(transfer);
      transferRepo.save.mockImplementation(async (t: Transfer) => {
        Object.assign(transfer, t);
        return t;
      });

      const result = await service.failTransfer('tr_123');
      expect(result.status).toBe(TransferStatus.FAILED);
    });
  });

  describe('reverseTransfer', () => {
    it('marks a transfer as reversed', async () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 90,
        currency: 'brl',
      });
      transfer.stripeTransferId = 'tr_123';
      transfer.status = TransferStatus.COMPLETED;

      transferRepo.findByStripeTransferId.mockResolvedValue(transfer);
      transferRepo.save.mockImplementation(async (t: Transfer) => {
        Object.assign(transfer, t);
        return t;
      });

      const result = await service.reverseTransfer('tr_123');
      expect(result.status).toBe(TransferStatus.REVERSED);
    });
  });
});
