import { VendorRepository } from '../vendor/vendor.domain';
import { Payout, PayoutStatus, PayoutError, PayoutRepository } from './payout.domain';
import { OrderRepository } from '../order/order.domain';

export class PayoutService {
  constructor(
    private readonly payoutRepo: PayoutRepository,
    private readonly vendorRepo: VendorRepository,
    private readonly orderRepo?: OrderRepository,
  ) {}

  async createPayout(
    vendorId: string,
    personId: string,
    amount: number,
    bankAccount?: string,
  ): Promise<Payout> {
    if (typeof vendorId !== 'string' || vendorId.trim().length === 0) {
      throw new Error(PayoutError.VENDOR_NOT_FOUND);
    }
    if (typeof personId !== 'string' || personId.trim().length === 0) {
      throw new Error(PayoutError.VENDOR_NOT_FOUND);
    }

    const vendor = await this.vendorRepo.findById(vendorId.trim());
    if (!vendor) {
      throw new Error(PayoutError.VENDOR_NOT_FOUND);
    }

    const payout = Payout.create({
      vendorId: vendorId.trim(),
      personId: personId.trim(),
      amount,
      bankAccount,
    });

    return this.payoutRepo.save(payout);
  }

  async getPayoutById(id: string, personId: string, isAdmin: boolean): Promise<Payout | null> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return null;
    }
    const payout = await this.payoutRepo.findById(id.trim());
    if (!payout) {
      return null;
    }
    if (isAdmin) {
      return payout;
    }
    const vendor = await this.vendorRepo.findByPersonId(personId);
    if (vendor && payout.vendorId === vendor.id) {
      return payout;
    }
    return null;
  }

  async listPayouts(
    personId: string,
    isAdmin: boolean,
    vendorIdFilter?: string,
  ): Promise<Payout[]> {
    if (isAdmin) {
      let payouts = await this.payoutRepo.findAll();
      if (typeof vendorIdFilter === 'string' && vendorIdFilter.trim().length > 0) {
        const filter = vendorIdFilter.trim();
        payouts = payouts.filter(payout => payout.vendorId === filter);
      }
      return payouts;
    }

    const vendor = await this.vendorRepo.findByPersonId(personId);
    if (!vendor) {
      return [];
    }
    return this.payoutRepo.findByVendorId(vendor.id);
  }

  async approvePayout(id: string, adminPersonId?: string, isAdmin?: boolean): Promise<Payout> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    const payout = await this.payoutRepo.findById(id.trim());
    if (!payout) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    if (payout.status !== PayoutStatus.PENDING) {
      throw new Error(PayoutError.PAYOUT_NOT_APPROVABLE);
    }
    payout.approve();
    return this.payoutRepo.update(payout);
  }

  async processPayout(id: string): Promise<Payout> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    const payout = await this.payoutRepo.findById(id.trim());
    if (!payout) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    if (payout.status !== PayoutStatus.APPROVED) {
      throw new Error(PayoutError.PAYOUT_NOT_PROCESSABLE);
    }
    payout.startProcessing();
    payout.complete();
    return this.payoutRepo.update(payout);
  }

  async failPayout(id: string, reason: string): Promise<Payout> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    const payout = await this.payoutRepo.findById(id.trim());
    if (!payout) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    if (payout.status !== PayoutStatus.PROCESSING) {
      throw new Error(PayoutError.PAYOUT_NOT_PROCESSABLE);
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error(PayoutError.INVALID_AMOUNT);
    }
    payout.fail(reason);
    return this.payoutRepo.update(payout);
  }

  async cancelPayout(id: string, personId: string, isAdmin: boolean): Promise<Payout> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }
    const payout = await this.payoutRepo.findById(id.trim());
    if (!payout) {
      throw new Error(PayoutError.PAYOUT_NOT_FOUND);
    }

    if (isAdmin) {
      if (payout.status === PayoutStatus.PENDING || payout.status === PayoutStatus.APPROVED) {
        payout.cancel();
        return this.payoutRepo.update(payout);
      }
      throw new Error(PayoutError.PAYOUT_NOT_CANCELLABLE);
    }

    const vendor = await this.vendorRepo.findByPersonId(personId);
    if (!vendor || payout.vendorId !== vendor.id) {
      throw new Error(PayoutError.FORBIDDEN);
    }
    if (payout.status !== PayoutStatus.PENDING) {
      throw new Error(PayoutError.PAYOUT_NOT_CANCELLABLE);
    }
    payout.cancel();
    return this.payoutRepo.update(payout);
  }
}
