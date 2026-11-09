import { describe, it, expect, beforeEach } from 'vitest';
import { WalletService } from './wallet.service';
import { InMemoryWalletRepository, InMemoryWalletTransactionRepository, WalletTransactionType } from './wallet.domain';

describe('Wallet Service', () => {
  let walletRepo: InMemoryWalletRepository;
  let txRepo: InMemoryWalletTransactionRepository;
  let service: WalletService;

  beforeEach(() => {
    walletRepo = new InMemoryWalletRepository();
    txRepo = new InMemoryWalletTransactionRepository();
    service = new WalletService(walletRepo, txRepo);
  });

  describe('getOrCreateWallet', () => {
    it('creates a new wallet for an owner', async () => {
      const wallet = await service.getOrCreateWallet('owner-1');
      expect(wallet.ownerId).toBe('owner-1');
      expect(wallet.balance).toBe(0);
    });

    it('returns existing wallet on second call', async () => {
      const w1 = await service.getOrCreateWallet('owner-1');
      const w2 = await service.getOrCreateWallet('owner-1');
      expect(w2.id).toBe(w1.id);
    });
  });

  describe('getBalance', () => {
    it('returns 0 balance (MP-28: platform does not hold seller money)', async () => {
      const balance = await service.getBalance('owner-1');
      expect(balance).toBe(0);
    });
  });

  describe('credit', () => {
    it('creates a credit transaction with idempotency', async () => {
      const tx = await service.credit('owner-1', 100, 'ref-1', 'Order payment', 'order-1');
      expect(tx.type).toBe(WalletTransactionType.CREDIT);
      expect(tx.amount).toBe(100);
      expect(tx.referenceId).toBe('ref-1');
      expect(tx.orderId).toBe('order-1');
    });

    it('returns existing transaction for duplicate reference (idempotency)', async () => {
      const tx1 = await service.credit('owner-1', 100, 'ref-1', 'Order payment');
      const tx2 = await service.credit('owner-1', 200, 'ref-1', 'Duplicate');
      expect(tx2.id).toBe(tx1.id);
      expect(tx2.amount).toBe(100);
    });

    it('throws INVALID_AMOUNT for zero or negative amount', async () => {
      await expect(service.credit('owner-1', 0, 'ref-1', 'Test')).rejects.toThrow();
      await expect(service.credit('owner-1', -50, 'ref-2', 'Test')).rejects.toThrow();
    });
  });

  describe('debit', () => {
    it('creates a debit transaction with idempotency', async () => {
      const tx = await service.debit('owner-1', 50, 'ref-debit-1', 'Payout', 'order-1');
      expect(tx.type).toBe(WalletTransactionType.DEBIT);
      expect(tx.amount).toBe(50);
    });

    it('returns existing transaction for duplicate reference (idempotency)', async () => {
      const tx1 = await service.debit('owner-1', 50, 'ref-debit-2', 'Payout');
      const tx2 = await service.debit('owner-1', 100, 'ref-debit-2', 'Duplicate');
      expect(tx2.id).toBe(tx1.id);
    });

    it('throws INVALID_AMOUNT for zero or negative amount', async () => {
      await expect(service.debit('owner-1', 0, 'ref-1', 'Test')).rejects.toThrow();
    });
  });

  describe('listTransactions', () => {
    it('returns transactions for the wallet owner', async () => {
      await service.credit('owner-1', 100, 'ref-1', 'Credit');
      await service.debit('owner-1', 30, 'ref-2', 'Debit');
      await service.credit('owner-2', 200, 'ref-3', 'Other owner');

      const txs = await service.listTransactions('owner-1');
      expect(txs).toHaveLength(2);
      expect(txs.every(t => t.ownerId === 'owner-1')).toBe(true);
    });

    it('returns empty array for owner with no wallet', async () => {
      const txs = await service.listTransactions('nonexistent');
      expect(txs).toEqual([]);
    });
  });

  describe('reconcile', () => {
    it('returns materialized 0 and computed 0 with ok true (MP-28)', async () => {
      await service.credit('owner-1', 100, 'ref-1', 'Credit');
      await service.debit('owner-1', 30, 'ref-2', 'Debit');

      const result = await service.reconcile('owner-1');
      expect(result.materialized).toBe(0);
      expect(result.computed).toBe(0);
      expect(result.ok).toBe(true);
    });
  });
});
