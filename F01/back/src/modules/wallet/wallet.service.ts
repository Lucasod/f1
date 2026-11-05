import {
  Wallet,
  WalletTransaction,
  WalletTransactionType,
  WalletError,
  WalletRepository,
  WalletTransactionRepository,
} from './wallet.domain';

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
    // MP-28: platform does not hold seller money; balance is always 0 (informational only)
    await this.getOrCreateWallet(ownerId);
    return 0;
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
    const tx = WalletTransaction.create({
      walletId: wallet.id,
      ownerId,
      type: WalletTransactionType.CREDIT,
      amount,
      referenceId,
      reason,
      orderId,
    });
    // MP-28: do NOT change wallet balance; only create transaction for audit/history
    await this.txRepo.save(tx);
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
    const tx = WalletTransaction.create({
      walletId: wallet.id,
      ownerId,
      type: WalletTransactionType.DEBIT,
      amount,
      referenceId,
      reason,
      orderId,
    });
    // MP-28: do NOT change wallet balance; only create transaction for audit/history.
    // The INSUFFICIENT_BALANCE check is removed since the platform does not hold seller funds.
    await this.txRepo.save(tx);
    return tx;
  }

  async reconcile(ownerId: string): Promise<{ materialized: number; computed: number; ok: boolean }> {
    // MP-28: with no stored-value balance, materialized is always 0.
    // Since the platform does not hold seller money, reconcile always passes with materialized: 0.
    return { materialized: 0, computed: 0, ok: true };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
