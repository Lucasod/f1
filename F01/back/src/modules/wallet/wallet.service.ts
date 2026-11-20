import {
  Wallet,
  WalletTransaction,
  WalletTransactionType,
  WalletError,
  WalletRepository,
  WalletTransactionRepository,
} from './wallet.domain';
import {
  MovementType,
  FinancialMovementRecord,
  FinancialMovementRepository,
} from '../financial/financial.movement';
import {
  FinancialEventRecord,
  EventType,
  FinancialEventRepository,
} from '../financial/financial.event';
import { FinancialLedger } from '../financial/financial.ledger';

export class WalletService {
  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly txRepo: WalletTransactionRepository,
  ) {}

  async getOrCreateWallet(ownerId: string): Promise<Wallet> {
    let wallet = await this.walletRepo.findByOwnerId(ownerId);
    if (!wallet) {
      wallet = Wallet.create(ownerId);
      await this.walletRepo.save(wallet);
    }
    return wallet;
  }

  async getBalance(ownerId: string): Promise<number> {
    const wallet = await this.getOrCreateWallet(ownerId);
    return wallet.balance;
  }

  async listTransactions(ownerId: string): Promise<WalletTransaction[]> {
    const wallet = await this.walletRepo.findByOwnerId(ownerId);
    if (!wallet) return [];
    return this.txRepo.findByWalletId(wallet.id);
  }

  async credit(
    ownerId: string,
    amount: number,
    referenceId: string,
    reason: string,
    orderId?: string,
  ): Promise<WalletTransaction> {
    // idempotency
    const existing = await this.txRepo.findByReferenceId(referenceId);
    if (existing) {
      return existing;
    }

    const wallet = await this.getOrCreateWallet(ownerId);
    wallet.credit(amount);

    const tx = WalletTransaction.create({
      walletId: wallet.id,
      ownerId,
      type: WalletTransactionType.CREDIT,
      amount,
      referenceId,
      reason,
      orderId,
    });
    await this.txRepo.save(tx);
    await this.walletRepo.update(wallet);
    return tx;
  }

  async debit(
    ownerId: string,
    amount: number,
    referenceId: string,
    reason: string,
    orderId?: string,
  ): Promise<WalletTransaction> {
    const existing = await this.txRepo.findByReferenceId(referenceId);
    if (existing) {
      return existing;
    }

    const wallet = await this.getOrCreateWallet(ownerId);
    wallet.debit(amount);

    const tx = WalletTransaction.create({
      walletId: wallet.id,
      ownerId,
      type: WalletTransactionType.DEBIT,
      amount,
      referenceId,
      reason,
      orderId,
    });
    await this.txRepo.save(tx);
    await this.walletRepo.update(wallet);
    return tx;
  }

  /**
   * Transactional credit that also records to the financial ledger.
   * Must be called within a MongoDB session's withTransaction context.
   * If any operation fails, MongoDB aborts the entire transaction atomically.
   */
  async creditWithLedger(
    ownerId: string,
    amount: number,
    referenceId: string,
    reason: string,
    movementRepo: FinancialMovementRepository,
    eventRepo?: FinancialEventRepository,
    orderId?: string,
  ): Promise<WalletTransaction> {
    // Idempotency check (best-effort; the transaction will also be atomic)
    const existing = await this.txRepo.findByReferenceId(referenceId);
    if (existing) {
      return existing;
    }

    const wallet = await this.getOrCreateWallet(ownerId);
    wallet.credit(amount);

    const now = new Date();
    const movement = FinancialMovementRecord.create({
      movementType: MovementType.CONSUMER_PAYMENT,
      amount,
      currency: 'brl',
      relatedEntityType: 'payment',
      relatedEntityId: referenceId,
      orderId,
      paymentId: referenceId,
      vendorId: undefined,
      effectiveAt: now,
      recordedAt: now,
      idempotencyKey: `wallet:${referenceId}`,
      metadata: { reason },
    });
    await movementRepo.save(movement);

    const tx = WalletTransaction.create({
      walletId: wallet.id,
      ownerId,
      type: WalletTransactionType.CREDIT,
      amount,
      referenceId,
      reason,
      orderId,
    });
    try {
      await this.txRepo.save(tx);
    } catch (err) {
      if (err instanceof Error && err.message === WalletError.DUPLICATE_REFERENCE) {
        const existing = await this.txRepo.findByReferenceId(referenceId);
        if (existing) return existing;
      }
      throw err;
    }
    await this.walletRepo.save(wallet);
    return tx;
  }

  /**
   * Transactional debit that also records to the financial ledger.
   * Must be called within a MongoDB session's withTransaction context.
   * If any operation fails, MongoDB aborts the entire transaction atomically.
   */
  async debitWithLedger(
    ownerId: string,
    amount: number,
    referenceId: string,
    reason: string,
    movementRepo: FinancialMovementRepository,
    eventRepo?: FinancialEventRepository,
    orderId?: string,
  ): Promise<WalletTransaction> {
    const existing = await this.txRepo.findByReferenceId(referenceId);
    if (existing) {
      return existing;
    }

    const wallet = await this.getOrCreateWallet(ownerId);
    wallet.debit(amount);

    const now = new Date();
    const movement = FinancialMovementRecord.create({
      movementType: MovementType.CONSUMER_PAYMENT,
      amount,
      currency: 'brl',
      relatedEntityType: 'payment',
      relatedEntityId: referenceId,
      orderId,
      paymentId: referenceId,
      vendorId: undefined,
      effectiveAt: now,
      recordedAt: now,
      idempotencyKey: `wallet:${referenceId}`,
      metadata: { reason },
    });
    await movementRepo.save(movement);

    const tx = WalletTransaction.create({
      walletId: wallet.id,
      ownerId,
      type: WalletTransactionType.DEBIT,
      amount,
      referenceId,
      reason,
      orderId,
    });
    try {
      await this.txRepo.save(tx);
    } catch (err) {
      if (err instanceof Error && err.message === WalletError.DUPLICATE_REFERENCE) {
        const existing = await this.txRepo.findByReferenceId(referenceId);
        if (existing) return existing;
      }
      throw err;
    }
    await this.walletRepo.save(wallet);
    return tx;
  }

  /**
   * Reconciles the wallet by comparing the materialized balance vs the computed
   * balance from transactions. Returns any discrepancy.
   */
  async reconcile(ownerId: string): Promise<{ materialized: number; computed: number; ok: boolean; discrepancy?: number }> {
    const wallet = await this.getOrCreateWallet(ownerId);
    const materialized = wallet.balance;

    const transactions = await this.txRepo.findByWalletId(wallet.id);
    const computed = round2(
      transactions.reduce((sum, tx) => {
        return tx.type === WalletTransactionType.CREDIT ? sum + tx.amount : sum - tx.amount;
      }, 0)
    );

    const ok = materialized === computed;
    const discrepancy = ok ? undefined : materialized - computed;
    return { materialized, computed, ok, discrepancy };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
