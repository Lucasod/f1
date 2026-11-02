import { describe, it, expect, beforeEach } from 'vitest';
import { PayoutService, } from './payout.service';
import { Payout, PayoutStatus, PayoutError, InMemoryPayoutRepository } from './payout.domain';
import { Vendor, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';

describe('Payout Service (T-1003)', () => {
  let payoutRepo: InMemoryPayoutRepository;
  let vendorRepo: InMemoryVendorRepository;
  let personRepo: InMemoryPersonRepository;
  let service: PayoutService;

  let vendorPerson: Person;
  let vendor: Vendor;
  let adminPerson: Person;

  beforeEach(async () => {
    payoutRepo = new InMemoryPayoutRepository();
    vendorRepo = new InMemoryVendorRepository();
    personRepo = new InMemoryPersonRepository();
    service = new PayoutService(payoutRepo, vendorRepo);

    vendorPerson = Person.create({
      name: 'Vendor Person',
      mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
      contactInfos: [{ type: 'email', value: 'v@test.com', isPrimary: true }],
      addresses: []
    });
    vendorPerson.addRole(PersonRole.VENDOR);
    await personRepo.save(vendorPerson);

    vendor = Vendor.create({ personId: vendorPerson.id!, storeName: 'Store', slug: 'store', commissionPct: 10 });
    vendor.id = 'vendor-1';
    await vendorRepo.save(vendor);

    adminPerson = Person.create({
      name: 'Admin',
      mainInfo: { taxIdType: 'CPF', taxIdValue: '98765432100' },
      contactInfos: [{ type: 'email', value: 'a@test.com', isPrimary: true }],
      addresses: []
    });
    adminPerson.addRole(PersonRole.ADMIN);
    await personRepo.save(adminPerson);
  });

  describe('createPayout', () => {
    it('creates payout for existing vendor', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100, 'acc');
      expect(p.status).toBe(PayoutStatus.PENDING);
      expect(p.amount).toBe(100);
      expect(p.bankAccount).toBe('acc');
      expect(p.vendorId).toBe('vendor-1');
    });

    it('throws VENDOR_NOT_FOUND for non-existent vendor', async () => {
      await expect(service.createPayout('nope', vendorPerson.id!, 100)).rejects.toThrow(PayoutError.VENDOR_NOT_FOUND);
    });

    it('throws INVALID_AMOUNT for invalid amount', async () => {
      await expect(service.createPayout('vendor-1', vendorPerson.id!, 0)).rejects.toThrow(PayoutError.INVALID_AMOUNT);
    });
  });

  describe('getPayoutById ownership', () => {
    it('admin sees any payout', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      const found = await service.getPayoutById(p.id, adminPerson.id!, true);
      expect(found).not.toBeNull();
    });

    it('vendor sees own payout', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      const found = await service.getPayoutById(p.id, vendorPerson.id!, false);
      expect(found).not.toBeNull();
    });

    it('vendor does not see other vendor payout', async () => {
      // another vendor person
      const otherPerson = Person.create({
        name: 'Other', mainInfo: { taxIdType: 'CPF', taxIdValue: '11122233344' },
        contactInfos: [{ type: 'email', value: 'o@test.com', isPrimary: true }],
        addresses: []
      });
      otherPerson.addRole(PersonRole.VENDOR);
      await personRepo.save(otherPerson);
      const otherVendor = Vendor.create({ personId: otherPerson.id!, storeName: 'S2', slug: 's2', commissionPct: 10 });
      otherVendor.id = 'vendor-2';
      await vendorRepo.save(otherVendor);

      const p = await service.createPayout('vendor-2', otherPerson.id!, 50);
      const found = await service.getPayoutById(p.id, vendorPerson.id!, false);
      expect(found).toBeNull();
    });

    it('returns null for non-existent', async () => {
      expect(await service.getPayoutById('nope', vendorPerson.id!, false)).toBeNull();
    });
  });

  describe('listPayouts', () => {
    it('admin lists all', async () => {
      await service.createPayout('vendor-1', vendorPerson.id!, 100);
      const list = await service.listPayouts(adminPerson.id!, true);
      expect(list).toHaveLength(1);
    });

    it('admin filters by vendorId', async () => {
      await service.createPayout('vendor-1', vendorPerson.id!, 100);
      const list = await service.listPayouts(adminPerson.id!, true, 'vendor-1');
      expect(list).toHaveLength(1);
      const empty = await service.listPayouts(adminPerson.id!, true, 'vendor-999');
      expect(empty).toHaveLength(0);
    });

    it('vendor lists own only', async () => {
      await service.createPayout('vendor-1', vendorPerson.id!, 100);
      const list = await service.listPayouts(vendorPerson.id!, false);
      expect(list).toHaveLength(1);
    });

    it('vendor with no profile gets empty', async () => {
      const list = await service.listPayouts('unknown-person', false);
      expect(list).toEqual([]);
    });
  });

  describe('approvePayout', () => {
    it('approves pending payout', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      const approved = await service.approvePayout(p.id, adminPerson.id!);
      expect(approved.status).toBe(PayoutStatus.APPROVED);
    });

    it('throws PAYOUT_NOT_APPROVABLE if not pending', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await service.approvePayout(p.id, adminPerson.id!);
      await expect(service.approvePayout(p.id, adminPerson.id!)).rejects.toThrow(PayoutError.PAYOUT_NOT_APPROVABLE);
    });

    it('throws PAYOUT_NOT_FOUND for non-existent', async () => {
      await expect(service.approvePayout('nope', adminPerson.id!)).rejects.toThrow(PayoutError.PAYOUT_NOT_FOUND);
    });
  });

  describe('processPayout', () => {
    it('processes approved payout to completed', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await service.approvePayout(p.id, adminPerson.id!);
      const processed = await service.processPayout(p.id);
      expect(processed.status).toBe(PayoutStatus.COMPLETED);
      expect(processed.processedAt).toBeInstanceOf(Date);
    });

    it('throws PAYOUT_NOT_PROCESSABLE if not approved', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await expect(service.processPayout(p.id)).rejects.toThrow(PayoutError.PAYOUT_NOT_PROCESSABLE);
    });
  });

  describe('failPayout', () => {
    it('fails a processing payout', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await service.approvePayout(p.id, adminPerson.id!);
      // move to processing without completing by using domain? Use payoutRepo update
      const payout = await payoutRepo.findById(p.id);
      payout!.startProcessing();
      await payoutRepo.update(payout!);
      const failed = await service.failPayout(p.id, 'reason');
      expect(failed.status).toBe(PayoutStatus.FAILED);
      expect(failed.failureReason).toBe('reason');
    });

    it('throws if not processing', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await expect(service.failPayout(p.id, 'r')).rejects.toThrow(PayoutError.PAYOUT_NOT_PROCESSABLE);
    });

    it('throws for empty reason', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await service.approvePayout(p.id, adminPerson.id!);
      const payout = await payoutRepo.findById(p.id);
      payout!.startProcessing();
      await payoutRepo.update(payout!);
      await expect(service.failPayout(p.id, '')).rejects.toThrow(PayoutError.INVALID_AMOUNT);
    });
  });

  describe('cancelPayout', () => {
    it('vendor cancels own pending', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      const cancelled = await service.cancelPayout(p.id, vendorPerson.id!, false);
      expect(cancelled.status).toBe(PayoutStatus.CANCELLED);
    });

    it('admin cancels approved', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await service.approvePayout(p.id, adminPerson.id!);
      const cancelled = await service.cancelPayout(p.id, adminPerson.id!, true);
      expect(cancelled.status).toBe(PayoutStatus.CANCELLED);
    });

    it('throws CANCELLABLE for wrong status', async () => {
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await service.approvePayout(p.id, adminPerson.id!);
      await service.processPayout(p.id);
      await expect(service.cancelPayout(p.id, adminPerson.id!, true)).rejects.toThrow(PayoutError.PAYOUT_NOT_CANCELLABLE);
    });

    it('throws FORBIDDEN for non-owner vendor', async () => {
      const otherPerson = Person.create({
        name: 'Other', mainInfo: { taxIdType: 'CPF', taxIdValue: '11122233344' },
        contactInfos: [{ type: 'email', value: 'o@test.com', isPrimary: true }],
        addresses: []
      });
      otherPerson.addRole(PersonRole.VENDOR);
      await personRepo.save(otherPerson);
      const p = await service.createPayout('vendor-1', vendorPerson.id!, 100);
      await expect(service.cancelPayout(p.id, otherPerson.id!, false)).rejects.toThrow(PayoutError.FORBIDDEN);
    });

    it('throws PAYOUT_NOT_FOUND for non-existent', async () => {
      await expect(service.cancelPayout('nope', vendorPerson.id!, false)).rejects.toThrow(PayoutError.PAYOUT_NOT_FOUND);
    });
  });
});
