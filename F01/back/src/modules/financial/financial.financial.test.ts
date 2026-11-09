import { describe, it, expect } from 'vitest';
import { FinancialAllocation, FinancialAllocationType, FinancialError } from './financial.domain';

describe('Financial Domain', () => {
  describe('FinancialAllocation.create', () => {
    it('creates a capture allocation', () => {
      const allocation = FinancialAllocation.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        type: FinancialAllocationType.CAPTURE,
        gross: 100,
        fees: 10,
        net: 90,
        referenceId: 'ref-1',
      });
      expect(allocation.orderId).toBe('order-1');
      expect(allocation.vendorId).toBe('vendor-1');
      expect(allocation.type).toBe(FinancialAllocationType.CAPTURE);
      expect(allocation.gross).toBe(100);
      expect(allocation.fees).toBe(10);
      expect(allocation.net).toBe(90);
      expect(allocation.referenceId).toBe('ref-1');
      expect(allocation.adjustments).toBe(0);
    });

    it('creates a refund allocation with adjustments', () => {
      const allocation = FinancialAllocation.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        type: FinancialAllocationType.REFUND,
        gross: 50,
        fees: 5,
        adjustments: 2,
        net: 43,
        referenceId: 'ref-2',
      });
      expect(allocation.type).toBe(FinancialAllocationType.REFUND);
      expect(allocation.adjustments).toBe(2);
    });

    it('throws INVALID_REFERENCE for empty orderId', () => {
      expect(() => FinancialAllocation.create({
        orderId: '',
        vendorId: 'vendor-1',
        type: FinancialAllocationType.CAPTURE,
        gross: 100,
        fees: 10,
        net: 90,
        referenceId: 'ref-1',
      })).toThrow(FinancialError.INVALID_REFERENCE);
    });

    it('throws INVALID_REFERENCE for empty vendorId', () => {
      expect(() => FinancialAllocation.create({
        orderId: 'order-1',
        vendorId: '',
        type: FinancialAllocationType.CAPTURE,
        gross: 100,
        fees: 10,
        net: 90,
        referenceId: 'ref-1',
      })).toThrow(FinancialError.INVALID_REFERENCE);
    });

    it('throws INVALID_REFERENCE for invalid type', () => {
      expect(() => FinancialAllocation.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        type: 'invalid' as any,
        gross: 100,
        fees: 10,
        net: 90,
        referenceId: 'ref-1',
      })).toThrow(FinancialError.INVALID_REFERENCE);
    });

    it('throws INVALID_REFERENCE for empty referenceId', () => {
      expect(() => FinancialAllocation.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        type: FinancialAllocationType.CAPTURE,
        gross: 100,
        fees: 10,
        net: 90,
        referenceId: '',
      })).toThrow(FinancialError.INVALID_REFERENCE);
    });
  });

  describe('toJSON/roundtrip', () => {
    it('serializes and reconstructs an allocation', () => {
      const allocation = FinancialAllocation.create({
        orderId: 'order-1',
        vendorId: 'vendor-1',
        type: FinancialAllocationType.CAPTURE,
        gross: 100,
        fees: 10,
        net: 90,
        referenceId: 'ref-1',
      });
      const json = allocation.toJSON();
      const reconstructed = FinancialAllocation.reconstruct(json);
      expect(reconstructed.gross).toBe(100);
      expect(reconstructed.net).toBe(90);
      expect(reconstructed.referenceId).toBe('ref-1');
    });
  });
});
