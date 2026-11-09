import { describe, it, expect } from 'vitest';
import { Payout, PayoutStatus, PayoutError } from './payout.domain';

describe('Payout Domain', () => {
  describe('Payout.create', () => {
    it('creates a pending payout', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
        bankAccount: 'acc-123',
      });
      expect(payout.vendorId).toBe('vendor-1');
      expect(payout.personId).toBe('person-1');
      expect(payout.amount).toBe(100);
      expect(payout.status).toBe(PayoutStatus.PENDING);
      expect(payout.bankAccount).toBe('acc-123');
      expect(payout.eventId).toBeDefined();
      expect(payout.eventType).toBe('payout_requested');
    });

    it('throws VENDOR_NOT_FOUND for empty vendorId', () => {
      expect(() => Payout.create({
        vendorId: '',
        personId: 'person-1',
        amount: 100,
      })).toThrow(PayoutError.VENDOR_NOT_FOUND);
    });

    it('throws INVALID_PERSON_ID for empty personId', () => {
      expect(() => Payout.create({
        vendorId: 'vendor-1',
        personId: '',
        amount: 100,
      })).toThrow(PayoutError.INVALID_PERSON_ID);
    });

    it('throws INVALID_AMOUNT for zero or negative', () => {
      expect(() => Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 0,
      })).toThrow(PayoutError.INVALID_AMOUNT);
    });
  });

  describe('Payout.status transitions', () => {
    it('approves a pending payout', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
      });
      payout.approve();
      expect(payout.status).toBe(PayoutStatus.APPROVED);
      expect(payout.eventType).toBe('payout_approved');
    });

    it('starts processing an approved payout', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
      });
      payout.approve();
      payout.startProcessing();
      expect(payout.status).toBe(PayoutStatus.PROCESSING);
    });

    it('completes a processing payout', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
      });
      payout.approve();
      payout.startProcessing();
      payout.complete();
      expect(payout.status).toBe(PayoutStatus.COMPLETED);
      expect(payout.processedAt).toBeDefined();
    });

    it('fails a processing payout', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
      });
      payout.approve();
      payout.startProcessing();
      payout.fail('Insufficient funds');
      expect(payout.status).toBe(PayoutStatus.FAILED);
      expect(payout.failureReason).toBe('Insufficient funds');
    });

    it('cancels a pending payout', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
      });
      payout.cancel();
      expect(payout.status).toBe(PayoutStatus.CANCELLED);
    });

    it('throws INVALID_STATUS_TRANSITION for invalid transition', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
      });
      payout.approve();
      payout.startProcessing();
      payout.complete();
      expect(() => payout.cancel()).toThrow(PayoutError.INVALID_STATUS_TRANSITION);
    });
  });

  describe('canTransitionTo', () => {
    it('returns true for valid transitions', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
      });
      expect(payout.canTransitionTo(PayoutStatus.APPROVED)).toBe(true);
      expect(payout.canTransitionTo(PayoutStatus.CANCELLED)).toBe(true);
      expect(payout.canTransitionTo(PayoutStatus.COMPLETED)).toBe(false);
    });
  });

  describe('toJSON/roundtrip', () => {
    it('serializes and reconstructs a payout', () => {
      const payout = Payout.create({
        vendorId: 'vendor-1',
        personId: 'person-1',
        amount: 100,
        bankAccount: 'acc-123',
      });
      payout.approve();
      const json = payout.toJSON();
      const reconstructed = Payout.reconstruct(json);
      expect(reconstructed.status).toBe(PayoutStatus.APPROVED);
      expect(reconstructed.amount).toBe(100);
      expect(reconstructed.eventId).toBe(payout.eventId);
    });
  });
});
