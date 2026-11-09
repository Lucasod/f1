import { describe, it, expect } from 'vitest';
import { Transfer, TransferStatus } from './transfer.domain';

describe('Transfer Domain', () => {
  describe('Transfer.create', () => {
    it('creates a pending transfer with generated ID', () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 100,
        currency: 'brl',
      });
      expect(transfer.id).toBe('order-1-transfer-ovg-1');
      expect(transfer.orderId).toBe('order-1');
      expect(transfer.orderVendorGroupId).toBe('ovg-1');
      expect(transfer.amount).toBe(100);
      expect(transfer.currency).toBe('brl');
      expect(transfer.status).toBe(TransferStatus.PENDING);
    });
  });

  describe('Transfer.status transitions', () => {
    it('completes a pending transfer', () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 100,
        currency: 'brl',
      });
      transfer.complete();
      expect(transfer.status).toBe(TransferStatus.COMPLETED);
    });

    it('fails a pending transfer', () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 100,
        currency: 'brl',
      });
      transfer.fail();
      expect(transfer.status).toBe(TransferStatus.FAILED);
    });

    it('reverses a completed transfer', () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 100,
        currency: 'brl',
      });
      transfer.complete();
      transfer.reverse();
      expect(transfer.status).toBe(TransferStatus.REVERSED);
    });
  });

  describe('toJSON/roundtrip', () => {
    it('serializes and reconstructs a transfer', () => {
      const transfer = Transfer.create({
        orderId: 'order-1',
        orderVendorGroupId: 'ovg-1',
        amount: 100,
        currency: 'brl',
      });
      transfer.stripeTransferId = 'tr_123';
      const json = transfer.toJSON();
      const reconstructed = Transfer.reconstruct(json);
      expect(reconstructed.id).toBe(transfer.id);
      expect(reconstructed.amount).toBe(100);
      expect(reconstructed.stripeTransferId).toBe('tr_123');
    });
  });
});
