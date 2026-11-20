import { describe, it, expect } from 'vitest';
import { Wallet, WalletTransaction, WalletTransactionType, WalletError } from './wallet.domain';

describe('Wallet Domain', () => {
  describe('Wallet.create', () => {
    it('creates a wallet with zero balance', () => {
      const wallet = Wallet.create('owner-1');
      expect(wallet.ownerId).toBe('owner-1');
      expect(wallet.balance).toBe(0);
    });

    it('throws INVALID_OWNER for empty ownerId', () => {
      expect(() => Wallet.create('')).toThrow(WalletError.INVALID_OWNER);
      expect(() => Wallet.create('   ')).toThrow(WalletError.INVALID_OWNER);
    });
  });

  describe('Wallet.credit', () => {
    it('increases balance', () => {
      const wallet = Wallet.create('owner-1');
      wallet.credit(100);
      expect(wallet.balance).toBe(100);
    });

    it('throws INVALID_AMOUNT for zero or negative', () => {
      const wallet = Wallet.create('owner-1');
      expect(() => wallet.credit(0)).toThrow(WalletError.INVALID_AMOUNT);
      expect(() => wallet.credit(-50)).toThrow(WalletError.INVALID_AMOUNT);
    });
  });

  describe('Wallet.debit', () => {
    it('decreases balance', () => {
      const wallet = Wallet.create('owner-1');
      wallet.credit(100);
      wallet.debit(30);
      expect(wallet.balance).toBe(70);
    });

    it('throws INSUFFICIENT_BALANCE when balance is too low', () => {
      const wallet = Wallet.create('owner-1');
      expect(() => wallet.debit(100)).toThrow(WalletError.INSUFFICIENT_BALANCE);
    });

    it('throws INVALID_AMOUNT for zero or negative', () => {
      const wallet = Wallet.create('owner-1');
      expect(() => wallet.debit(0)).toThrow(WalletError.INVALID_AMOUNT);
    });
  });

  describe('WalletTransaction.create', () => {
    it('creates a credit transaction', () => {
      const tx = WalletTransaction.create({
        walletId: 'wallet-1',
        ownerId: 'owner-1',
        type: WalletTransactionType.CREDIT,
        amount: 100,
        referenceId: 'ref-1',
        reason: 'Payment',
      });
      expect(tx.type).toBe(WalletTransactionType.CREDIT);
      expect(tx.amount).toBe(100);
      expect(tx.referenceId).toBe('ref-1');
      expect(tx.reason).toBe('Payment');
    });

    it('creates a debit transaction', () => {
      const tx = WalletTransaction.create({
        walletId: 'wallet-1',
        ownerId: 'owner-1',
        type: WalletTransactionType.DEBIT,
        amount: 50,
        referenceId: 'ref-2',
        reason: 'Payout',
      });
      expect(tx.type).toBe(WalletTransactionType.DEBIT);
    });

    it('throws WALLET_NOT_FOUND for empty walletId', () => {
      expect(() => WalletTransaction.create({
        walletId: '',
        ownerId: 'owner-1',
        type: WalletTransactionType.CREDIT,
        amount: 100,
        referenceId: 'ref-1',
        reason: 'Test',
      })).toThrow(WalletError.WALLET_NOT_FOUND);
    });

    it('throws INVALID_AMOUNT for invalid type', () => {
      expect(() => WalletTransaction.create({
        walletId: 'wallet-1',
        ownerId: 'owner-1',
        type: 'invalid' as any,
        amount: 100,
        referenceId: 'ref-1',
        reason: 'Test',
      })).toThrow(WalletError.INVALID_AMOUNT);
    });
  });

  describe('toJSON/roundtrip', () => {
    it('serializes and reconstructs a wallet', () => {
      const wallet = Wallet.create('owner-1');
      wallet.credit(100);
      const json = wallet.toJSON();
      const reconstructed = Wallet.reconstruct(json);
      expect(reconstructed.balance).toBe(100);
      expect(reconstructed.ownerId).toBe('owner-1');
    });

    it('serializes and reconstructs a transaction', () => {
      const tx = WalletTransaction.create({
        walletId: 'wallet-1',
        ownerId: 'owner-1',
        type: WalletTransactionType.CREDIT,
        amount: 100,
        referenceId: 'ref-1',
        reason: 'Test',
      });
      const json = tx.toJSON();
      const reconstructed = WalletTransaction.reconstruct(json);
      expect(reconstructed.amount).toBe(100);
      expect(reconstructed.referenceId).toBe('ref-1');
    });
  });
});
