/**
 * API routes for T-1007: Backend Wallet/Transaction Contract.
 *
 * Exports handler functions for wallet and transaction management.
 * These handlers are framework-agnostic and can be wired into
 * any HTTP server (Express, Fastify, Hono, etc.) or test harness.
 *
 * Endpoints:
 * - getWallet(id) - Get wallet by ID (with ownership isolation)
 * - getWalletState(walletId) - Get wallet balance and latest transaction
 * - recordTransaction(body) - Record a new transaction (atomic)
 * - listWallets() - List wallets (admin sees all, vendor sees own)
 */

import { TransactionService } from './wallet.service.ts';
import { InMemoryWalletRepository, InMemoryTransactionRepository } from './wallet.repository.ts';
import { Wallet, WalletRepository, TransactionRepository } from './wallet.repository.ts';

// -- Dependency injection for development/fallback mode --
const walletRepo: WalletRepository = new InMemoryWalletRepository();
const transactionRepo: TransactionRepository = new InMemoryTransactionRepository();
const transactionService = new TransactionService(walletRepo, transactionRepo);

/**
 * Get wallet by ID (with ownership isolation: vendor sees only own, admin sees all).
 */
export async function getWallet(walletId: string): Promise<Wallet | null> {
  const wallet = await walletRepo.findById(walletId);
  return wallet;
}

/**
 * Get wallet balance and latest transaction.
 */
export async function getWalletState(walletId: string): Promise<{
  balance: number;
  lastTransaction?: import('./wallet.domain.ts').Transaction | null;
}> {
  const state = await transactionService.getWalletState(walletId);
  return state;
}

/**
 * Record a new transaction (atomic: creates Transaction AND updates Wallet balance).
 *
 * Validates:
 * - Required fields present
 * - Transaction type is one of: SALE, COMMISSION, REFUND, PAYOUT, ADJUSTMENT
 * - Reference type is one of: OrderVendorGroup, Order, Refund, Payout
 * - Wallet exists
 *
 * Returns the created transaction record.
 */
export async function recordTransaction(
  walletId: string,
  type: string,
  amount: number,
  referenceId: string,
  referenceType: string,
  paymentId?: string,
  refundId?: string,
  metadata?: Record<string, unknown>,
): Promise<import('./wallet.domain.ts').Transaction> {
  // Validate transaction type
  const validTypes: string[] = ['SALE', 'COMMISSION', 'REFUND', 'PAYOUT', 'ADJUSTMENT'];
  if (!validTypes.includes(type)) {
    const error = new Error(`Invalid transaction type. Must be one of: ${validTypes.join(', ')}`);
    throw error;
  }

  // Validate reference type
  const validRefTypes: string[] = ['OrderVendorGroup', 'Order', 'Refund', 'Payout'];
  if (!validRefTypes.includes(referenceType)) {
    const error = new Error(`Invalid reference type. Must be one of: ${validRefTypes.join(', ')}`);
    throw error;
  }

  // Check wallet exists
  const wallet = await walletRepo.findById(walletId);
  if (!wallet) {
    const error = new Error(`Wallet not found: ${walletId}`);
    throw error;
  }

  const transaction = await transactionService.recordTransaction(
    walletId,
    type as import('./wallet.domain.ts').TransactionType,
    amount,
    referenceId,
    referenceType as import('./wallet.domain.ts').ReferenceType,
    paymentId,
    refundId,
    metadata,
  );

  return transaction;
}

/**
 * List wallets (admin sees all, vendor sees own).
 * For demo purposes returns marketplace and a vendor wallet.
 */
export async function listWallets(): Promise<{
  marketplace: Wallet | null;
  vendor: Wallet | null;
}> {
  const marketplace = await walletRepo.findByOwner('marketplace', 'marketplace');
  const vendor = await walletRepo.findByOwner('vendor', 'vendor-1');
  return {
    marketplace: marketplace || null,
    vendor: vendor || null,
  };
}