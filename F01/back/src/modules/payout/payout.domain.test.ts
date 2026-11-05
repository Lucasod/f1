import { describe, it, expect } from 'vitest';
import { Payout, PayoutStatus, PayoutError, InMemoryPayoutRepository } from './payout.domain';

describe('Payout Domain (T-1003)', () => {
  describe('Payout.create', () => {
    it('creates a pending payout with valid data', () => {
      const payout = Payout.create({ vendorId: 'vendor-1', personId: 'person-1', amount: 100 });
      expect(payout.status).toBe(PayoutStatus.PENDING);
      expect(payout.vendorId).toBe('vendor-1');
      expect(payout.personId).toBe('person-1');
      expect(payout.amount).toBe(100);
      expect(payout.requestedAt).toBeInstanceOf(Date);
      expect(payout.createdAt).toBeInstanceOf(Date);
      expect(payout.updatedAt).toBeInstanceOf(Date);
    });

    it('stores optional bankAccount', () => {
      const payout = Payout.create({ vendorId: 'v', personId: 'p', amount: 10, bankAccount: '  acc-1 ' });
      expect(payout.bankAccount).toBe('acc-1');
    });

    it('throws VENDOR_NOT_FOUND when vendorId empty', () => {
      expect(() => Payout.create({ vendorId: '', personId: 'p', amount: 10 })).toThrow(PayoutError.VENDOR_NOT_FOUND);
    });

    it('throws INVALID_PERSON_ID when personId empty', () => {
      expect(() => Payout.create({ vendorId: 'v', personId: '', amount: 10 })).toThrow(PayoutError.INVALID_PERSON_ID);
    });

    it('throws INVALID_AMOUNT for amount <= 0', () => {
      expect(() => Payout.create({ vendorId: 'v', personId: 'p', amount: 0 })).toThrow(PayoutError.INVALID_AMOUNT);
      expect(() => Payout.create({ vendorId: 'v', personId: 'p', amount: -5 })).toThrow(PayoutError.INVALID_AMOUNT);
    });

    it('throws INVALID_AMOUNT for non-finite amount', () => {
      expect(() => Payout.create({ vendorId: 'v', personId: 'p', amount: NaN })).toThrow(PayoutError.INVALID_AMOUNT);
      expect(() => Payout.create({ vendorId: 'v', personId: 'p', amount: Infinity })).toThrow(PayoutError.INVALID_AMOUNT);
    });
  });

  describe('status transitions', () => {
    it('PENDING -> APPROVED creates new record', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      const newPayout = p.transitionTo(PayoutStatus.APPROVED);
      expect(newPayout.status).toBe(PayoutStatus.APPROVED);
      expect(newPayout.eventId).toBeDefined();
      expect(newPayout.originalEventId).toBeDefined();
      expect(newPayout.eventType).toBe('payout_approved');
      // Original record is preserved
      expect(p.status).toBe(PayoutStatus.PENDING);
    });

    it('PENDING -> CANCELLED creates new record', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      const newPayout = p.transitionTo(PayoutStatus.CANCELLED);
      expect(newPayout.status).toBe(PayoutStatus.CANCELLED);
      expect(newPayout.eventId).toBeDefined();
      expect(newPayout.originalEventId).toBeDefined();
      expect(newPayout.eventType).toBe('payout_cancelled');
      // Original record is preserved
      expect(p.status).toBe(PayoutStatus.PENDING);
    });

    it('APPROVED -> PROCESSING creates new record with event chain', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      const approved = p.transitionTo(PayoutStatus.APPROVED);
      expect(approved.status).toBe(PayoutStatus.APPROVED);
      expect(approved.eventType).toBe('payout_approved');
      const processing = approved.transitionTo(PayoutStatus.PROCESSING);
      expect(processing.status).toBe(PayoutStatus.PROCESSING);
      expect(processing.eventType).toBe('payout_processing');
      // Original record preserved at each step
      expect(p.status).toBe(PayoutStatus.PENDING);
    });

    it('APPROVED -> CANCELLED creates new record', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      const approved = p.transitionTo(PayoutStatus.APPROVED);
      expect(approved.status).toBe(PayoutStatus.APPROVED);
      const cancelled = approved.transitionTo(PayoutStatus.CANCELLED);
      expect(cancelled.status).toBe(PayoutStatus.CANCELLED);
      expect(cancelled.eventType).toBe('payout_cancelled');
      expect(p.status).toBe(PayoutStatus.PENDING);
    });

    it('PROCESSING -> COMPLETED sets processedAt and eventType', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      const approved = p.transitionTo(PayoutStatus.APPROVED);
      const processing = approved.transitionTo(PayoutStatus.PROCESSING);
      const completed = processing.transitionTo(PayoutStatus.COMPLETED);
      expect(completed.status).toBe(PayoutStatus.COMPLETED);
      expect(completed.processedAt).toBeInstanceOf(Date);
      expect(completed.eventType).toBe('payout_completed');
      // Original record preserved
      expect(p.status).toBe(PayoutStatus.PENDING);
    });

it('PROCESSING -> FAILED sets failureReason and eventType', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p.approve();
      p.startProcessing();
      p.fail('bank error');
      expect(p.status).toBe(PayoutStatus.FAILED);
      expect(p.failureReason).toBe('bank error');
      expect(p.eventType).toBe('payout_failed');
    });

    it('invalid transition throws', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      expect(() => p.transitionTo(PayoutStatus.COMPLETED)).toThrow(PayoutError.INVALID_STATUS_TRANSITION);
    });

    it('terminal states have no transitions', () => {
      // Test COMPLETED terminal state: PENDING -> APPROVED -> PROCESSING -> COMPLETED
      const p1 = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p1.approve();
      p1.startProcessing();
      p1.complete();
      expect(p1.status).toBe(PayoutStatus.COMPLETED);
      expect(() => p1.transitionTo(PayoutStatus.PENDING)).toThrow(PayoutError.INVALID_STATUS_TRANSITION);

      // Test FAILED terminal state: PENDING -> APPROVED -> PROCESSING -> FAILED
      const p2 = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p2.approve();
      p2.startProcessing();
      p2.fail('x');
      expect(p2.status).toBe(PayoutStatus.FAILED);
      expect(() => p2.transitionTo(PayoutStatus.PENDING)).toThrow(PayoutError.INVALID_STATUS_TRANSITION);

      // Test CANCELLED terminal state: PENDING -> APPROVED -> CANCELLED
      const p3 = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p3.approve();
      p3.cancel();
      expect(p3.status).toBe(PayoutStatus.CANCELLED);
      expect(() => p3.transitionTo(PayoutStatus.PENDING)).toThrow(PayoutError.INVALID_STATUS_TRANSITION);
    });
  });

  describe('InMemoryPayoutRepository', () => {
    it('save/find/update', async () => {
      const repo = new InMemoryPayoutRepository();
      const p = Payout.create({ vendorId: 'v1', personId: 'p1', amount: 50 });
      const newPayout = p.transitionTo(PayoutStatus.APPROVED);
      await repo.save(newPayout);
      expect(await repo.findById(newPayout.id)).not.toBeNull();
      expect(await repo.findByVendorId('v1')).toHaveLength(1);
      expect(await repo.findByPersonId('p1')).toHaveLength(1);
      expect(await repo.findAll()).toHaveLength(1);
      expect((await repo.findById(newPayout.id))!.status).toBe(PayoutStatus.APPROVED);
    });

    it('update non-existent throws', async () => {
      const repo = new InMemoryPayoutRepository();
      const p = Payout.create({ vendorId: 'v1', personId: 'p1', amount: 50 });
      await expect(repo.update(p)).rejects.toThrow(PayoutError.PAYOUT_NOT_FOUND);
    });
  });
});