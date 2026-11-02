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
      const payout = Payout.create({ vendorId: 'v', personId: 'p', amount: 10, bankAccount: '  acc-1  ' });
      expect(payout.bankAccount).toBe('acc-1');
    });

    it('throws VENDOR_NOT_FOUND when vendorId empty', () => {
      expect(() => Payout.create({ vendorId: '', personId: 'p', amount: 10 })).toThrow(PayoutError.VENDOR_NOT_FOUND);
    });

    it('throws VENDOR_NOT_FOUND when personId empty', () => {
      expect(() => Payout.create({ vendorId: 'v', personId: '', amount: 10 })).toThrow(PayoutError.VENDOR_NOT_FOUND);
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
    it('PENDING -> APPROVED', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p.transitionTo(PayoutStatus.APPROVED);
      expect(p.status).toBe(PayoutStatus.APPROVED);
    });

    it('PENDING -> CANCELLED', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p.transitionTo(PayoutStatus.CANCELLED);
      expect(p.status).toBe(PayoutStatus.CANCELLED);
    });

    it('APPROVED -> PROCESSING', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p.transitionTo(PayoutStatus.APPROVED);
      p.transitionTo(PayoutStatus.PROCESSING);
      expect(p.status).toBe(PayoutStatus.PROCESSING);
    });

    it('APPROVED -> CANCELLED', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p.transitionTo(PayoutStatus.APPROVED);
      p.transitionTo(PayoutStatus.CANCELLED);
      expect(p.status).toBe(PayoutStatus.CANCELLED);
    });

    it('PROCESSING -> COMPLETED sets processedAt', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p.transitionTo(PayoutStatus.APPROVED);
      p.transitionTo(PayoutStatus.PROCESSING);
      p.transitionTo(PayoutStatus.COMPLETED);
      expect(p.status).toBe(PayoutStatus.COMPLETED);
      expect(p.processedAt).toBeInstanceOf(Date);
    });

    it('PROCESSING -> FAILED sets failureReason via fail()', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      p.transitionTo(PayoutStatus.APPROVED);
      p.transitionTo(PayoutStatus.PROCESSING);
      p.fail('bank error');
      expect(p.status).toBe(PayoutStatus.FAILED);
      expect(p.failureReason).toBe('bank error');
    });

    it('invalid transition throws', () => {
      const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
      expect(() => p.transitionTo(PayoutStatus.COMPLETED)).toThrow(PayoutError.INVALID_STATUS_TRANSITION);
    });

    it('terminal states have no transitions', () => {
      for (const terminal of [PayoutStatus.COMPLETED, PayoutStatus.FAILED, PayoutStatus.CANCELLED]) {
        const p = Payout.create({ vendorId: 'v', personId: 'p', amount: 10 });
        // move to terminal
        if (terminal === PayoutStatus.COMPLETED) {
          p.transitionTo(PayoutStatus.APPROVED);
          p.transitionTo(PayoutStatus.PROCESSING);
          p.transitionTo(PayoutStatus.COMPLETED);
        } else if (terminal === PayoutStatus.FAILED) {
          p.transitionTo(PayoutStatus.APPROVED);
          p.transitionTo(PayoutStatus.PROCESSING);
          p.fail('x');
        } else {
          p.transitionTo(PayoutStatus.CANCELLED);
        }
        expect(p.canTransitionTo(PayoutStatus.PENDING)).toBe(false);
        expect(() => p.transitionTo(PayoutStatus.PENDING)).toThrow(PayoutError.INVALID_STATUS_TRANSITION);
      }
    });
  });

  describe('InMemoryPayoutRepository', () => {
    it('save/find/update', async () => {
      const repo = new InMemoryPayoutRepository();
      const p = Payout.create({ vendorId: 'v1', personId: 'p1', amount: 50 });
      await repo.save(p);
      expect(await repo.findById(p.id)).not.toBeNull();
      expect(await repo.findByVendorId('v1')).toHaveLength(1);
      expect(await repo.findByPersonId('p1')).toHaveLength(1);
      expect(await repo.findAll()).toHaveLength(1);
      p.transitionTo(PayoutStatus.APPROVED);
      await repo.update(p);
      expect((await repo.findById(p.id))!.status).toBe(PayoutStatus.APPROVED);
    });

    it('update non-existent throws', async () => {
      const repo = new InMemoryPayoutRepository();
      const p = Payout.create({ vendorId: 'v1', personId: 'p1', amount: 50 });
      await expect(repo.update(p)).rejects.toThrow(PayoutError.PAYOUT_NOT_FOUND);
    });
  });
});
