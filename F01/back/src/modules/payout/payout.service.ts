import { VendorRepository } from '../vendor/vendor.domain';
import { Payout, PayoutStatus, PayoutError, PayoutRepository } from './payout.domain';
import { OrderRepository } from '../order/order.domain';
import type { WalletService } from '../wallet/wallet.service';
import {
  FinancialMovementRecord,
  MovementType,
  FinancialMovementRepository,
} from '../financial/financial.movement';
import {
  FinancialEventRecord,
  EventType,
  FinancialEventRepository,
} from '../financial/financial.event';

export class PayoutService {
  private readonly payoutRepo: PayoutRepository;
  private readonly vendorRepo: VendorRepository;
  private readonly orderRepo?: OrderRepository;
  private readonly walletService?: WalletService;
  private readonly movementRepo?: FinancialMovementRepository;
  private readonly eventRepo?: FinancialEventRepository;

  constructor(
    payoutRepo: PayoutRepository,
    vendorRepo: VendorRepository,
    orderRepo?: OrderRepository,
    walletService?: WalletService,
    movementRepo?: FinancialMovementRepository,
    eventRepo?: FinancialEventRepository,
  ) {
    this.payoutRepo = payoutRepo;
    this.vendorRepo = vendorRepo;
    this.orderRepo = orderRepo;
    this.walletService = walletService;
    this.movementRepo = movementRepo;
    this.eventRepo = eventRepo;
  }

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

    await this.payoutRepo.save(payout);
    await this.recordPayoutLedger(payout, MovementType.VENDOR_PAYOUT, EventType.PAYOUT_REQUESTED);
    return payout;
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
    const updated = await this.payoutRepo.update(payout);
    await this.recordPayoutLedger(updated, MovementType.VENDOR_PAYOUT, EventType.PAYOUT_APPROVED);
    return updated;
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
    const updated = await this.payoutRepo.update(payout);
    await this.recordPayoutLedger(updated, MovementType.VENDOR_PAYOUT, EventType.PAYOUT_PROCESSING);
    await this.recordPayoutLedger(updated, MovementType.VENDOR_PAYOUT, EventType.PAYOUT_COMPLETED);
    return updated;
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
    const updated = await this.payoutRepo.update(payout);
    await this.recordPayoutLedger(updated, MovementType.VENDOR_PAYOUT, EventType.PAYOUT_FAILED);
    return updated;
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
        const updated = await this.payoutRepo.update(payout);
        await this.recordPayoutLedger(updated, MovementType.VENDOR_PAYOUT, EventType.PAYOUT_CANCELLED);
        return updated;
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
    const updated = await this.payoutRepo.update(payout);
    await this.recordPayoutLedger(updated, MovementType.VENDOR_PAYOUT, EventType.PAYOUT_CANCELLED);
    return updated;
  }

  /**
   * Records a financial movement and event for a payout state transition.
   * Best-effort: skipped when no movement/event repository is wired.
   */
  private async recordPayoutLedger(
    payout: Payout,
    movementType: MovementType,
    eventType: EventType,
  ): Promise<void> {
    const now = new Date();

    if (this.movementRepo) {
      const movement = FinancialMovementRecord.create({
        movementType,
        amount: payout.amount,
        currency: 'brl',
        relatedEntityType: 'payout',
        relatedEntityId: payout.id,
        orderId: payout.reference,
        vendorId: payout.vendorId,
        effectiveAt: now,
        recordedAt: now,
        idempotencyKey: `payout:${payout.id}:${movementType}`,
      });
      await this.movementRepo.save(movement);
    }

    if (this.eventRepo) {
      const event = FinancialEventRecord.create({
        eventType,
        eventSource: 'internal',
        eventTimestamp: now,
        orderId: payout.reference,
        vendorId: payout.vendorId,
      });
      await this.eventRepo.save(event);
    }
  }
}
