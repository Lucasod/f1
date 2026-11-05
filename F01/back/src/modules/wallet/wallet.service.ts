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
    const tx = WalletTransaction.create({
      walletId: wallet.id,
      ownerId,
      type: WalletTransactionType.CREDIT,
      amount,
      referenceId,
      reason,
      orderId,
    });
    wallet.credit(amount);
    await this.walletRepo.update(wallet);
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
    wallet.debit(amount);
    await this.walletRepo.update(wallet);
    await this.txRepo.save(tx);
    return tx;
  }

  async reconcile(ownerId: string): Promise<{ materialized: number; computed: number; ok: boolean }> {
    const wallet = await this.walletRepo.findByOwnerId(ownerId);
    if (!wallet) {
      return { materialized: 0, computed: 0, ok: true };
    }
    const txs = await this.txRepo.findByWalletId(wallet.id);
    const computed = txs.reduce((sum, tx) => {
      return tx.type === WalletTransactionType.CREDIT ? sum + tx.amount : sum - tx.amount;
    }, 0);
    return { materialized: wallet.balance, computed: round2(computed), ok: Math.abs(wallet.balance - computed) < 0.0001 };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
