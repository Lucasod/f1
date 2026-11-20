import { describe, it, expect, beforeEach } from 'vitest';
import { FinancialService } from './financial.service';
import { FinancialAllocation, FinancialAllocationType, InMemoryFinancialAllocationRepository, FinancialError } from './financial.domain';

describe('Financial Service', () => {
  let repo: InMemoryFinancialAllocationRepository;
  let service: FinancialService;

  beforeEach(() => {
    repo = new InMemoryFinancialAllocationRepository();
    service = new FinancialService(repo);
  });

  describe('createAllocation', () => {
    it('creates a capture allocation with idempotency by referenceId', async () => {
      const allocation = await service.createAllocation(
        'order-1', 'vendor-1', FinancialAllocationType.CAPTURE,
        100, 10, 90, 'ref-capture-1'
      );
      expect(allocation.orderId).toBe('order-1');
      expect(allocation.vendorId).toBe('vendor-1');
      expect(allocation.type).toBe(FinancialAllocationType.CAPTURE);
      expect(allocation.gross).toBe(100);
      expect(allocation.fees).toBe(10);
      expect(allocation.net).toBe(90);
      expect(allocation.referenceId).toBe('ref-capture-1');
    });

    it('returns existing allocation for duplicate reference (idempotency)', async () => {
      const a1 = await service.createAllocation('order-1', 'vendor-1', FinancialAllocationType.CAPTURE, 100, 10, 90, 'ref-dup');
      const a2 = await service.createAllocation('order-1', 'vendor-1', FinancialAllocationType.CAPTURE, 200, 20, 180, 'ref-dup');
      expect(a2.id).toBe(a1.id);
      expect(a2.gross).toBe(100);
    });

    it('throws INVALID_REFERENCE for empty orderId', async () => {
      await expect(service.createAllocation('', 'vendor-1', FinancialAllocationType.CAPTURE, 100, 10, 90, 'ref')).rejects.toThrow(FinancialError.INVALID_REFERENCE);
    });

    it('throws INVALID_REFERENCE for empty vendorId', async () => {
      await expect(service.createAllocation('order-1', '', FinancialAllocationType.CAPTURE, 100, 10, 90, 'ref')).rejects.toThrow(FinancialError.INVALID_REFERENCE);
    });

    it('throws INVALID_REFERENCE for empty referenceId', async () => {
      await expect(service.createAllocation('order-1', 'vendor-1', FinancialAllocationType.CAPTURE, 100, 10, 90, '')).rejects.toThrow(FinancialError.INVALID_REFERENCE);
    });
  });

  describe('listByOrder', () => {
    it('returns allocations for a specific order', async () => {
      await service.createAllocation('order-1', 'vendor-1', FinancialAllocationType.CAPTURE, 100, 10, 90, 'ref-1');
      await service.createAllocation('order-1', 'vendor-1', FinancialAllocationType.REFUND, 50, 5, 45, 'ref-2');
      await service.createAllocation('order-2', 'vendor-1', FinancialAllocationType.CAPTURE, 200, 20, 180, 'ref-3');

      const allocations = await service.listByOrder('order-1');
      expect(allocations).toHaveLength(2);
      expect(allocations.every(a => a.orderId === 'order-1')).toBe(true);
    });
  });

  describe('listByVendor', () => {
    it('returns allocations for a specific vendor', async () => {
      await service.createAllocation('order-1', 'vendor-1', FinancialAllocationType.CAPTURE, 100, 10, 90, 'ref-1');
      await service.createAllocation('order-2', 'vendor-2', FinancialAllocationType.CAPTURE, 200, 20, 180, 'ref-2');

      const allocations = await service.listByVendor('vendor-1');
      expect(allocations).toHaveLength(1);
      expect(allocations[0].vendorId).toBe('vendor-1');
    });
  });

  describe('findAll', () => {
    it('returns all allocations', async () => {
      await service.createAllocation('order-1', 'vendor-1', FinancialAllocationType.CAPTURE, 100, 10, 90, 'ref-1');
      await service.createAllocation('order-2', 'vendor-2', FinancialAllocationType.REFUND, 50, 5, 45, 'ref-2');

      const allocations = await service.findAll();
      expect(allocations).toHaveLength(2);
    });
  });
});
