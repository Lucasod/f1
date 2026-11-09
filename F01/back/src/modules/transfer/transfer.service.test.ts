import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransferService } from './transfer.service';
import { Transfer, TransferStatus } from './transfer.domain';
import { FinancialService } from '../financial/financial.service';
import { InMemoryFinancialAllocationRepository } from '../financial/financial.domain';

import Stripe from 'stripe';

// Define mocks before vi.mock (which is hoisted)
const mockStripeTransfers = {
  create: vi.fn(),
  retrieve: vi.fn(),
};

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      this.transfers = mockStripeTransfers;
    }),
  };
});

// Keep reference to prevent tree-shaking of mockStripeTransfers
void mockStripeTransfers;

describe('Transfer Service', () => {
  let transferRepo: { save: any; findLastByOrderVendorGroupId: any; findByStripeTransferId: any };
  let financialService: FinancialService;
  let service: TransferService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeTransfers.create.mockReset();
    mockStripeTransfers.retrieve.mockReset();

    transferRepo = {
      save: vi.fn().mockResolvedValue(undefined),
      findLastByOrderVendorGroupId: vi.fn().mockResolvedValue(null),
      findByStripeTransferId: vi.fn().mockResolvedValue(null),
    };

    financialService = new FinancialService(new InMemoryFinancialAllocationRepository());
    service = new TransferService(
      transferRepo as any,
      financialService,
      'sk_test_fake_key_for_testing_only'
    );
  });

  describe('createTransferWithDetails', () => {
    it('creates a transfer with calculated vendor net amount', async () => {
      mockStripeTransfers.create.mockResolvedValue({ id: 'tr_stripe_123' } as any);

      const result = await service.createTransferWithDetails(
        'order-1',
        'ovg-1',
        100,
        10,
        'ch_stripe_456',
        1
      );

      expect(result.entity.amount).toBe(90);
      expect(result.entity.currency).toBe('brl');
      expect(result.entity.status).toBe(TransferStatus.PROCESSING);
      expect(result.entity.stripeTransferId).toBe('tr_stripe_123');
      expect(mockStripeTransfers.create).toHaveBeenCalledWith({
        amount: 9000,
        currency: 'brl',
        destination: '',
        source_transaction: 'ch_stripe_456',
        transfer_group: 'order-1',
      }, { idempotencyKey: 'order-1:ovg-1:1' });
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
