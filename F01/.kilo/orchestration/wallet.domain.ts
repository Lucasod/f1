/**
 * Wallet and Transaction domain models for T-1007.
 *
 * Schemas from F-001 analysis:
 *   Wallet: ownerType, ownerId, currency, balance, last_transaction_id
 *   Transaction: walletId, type, amount, runningBalance, referenceId, referenceType, paymentId, refundId, metadata, createdAt
 *
 * Transaction type enum: SALE | COMMISSION | REFUND | PAYOUT | ADJUSTMENT
 * referenceType enum: OrderVendorGroup | Order | Refund | Payout
 * Append-only enforcement (no update/delete on transactions)
 * Wallet ownership isolation (vendor sees only own, admin sees all)
 * Marketplace singleton wallet (ownerType="marketplace", ownerId="marketplace")
 */
export type TransactionType = 'SALE' | 'COMMISSION' | 'REFUND' | 'PAYOUT' | 'ADJUSTMENT';

export type ReferenceType = 'OrderVendorGroup' | 'Order' | 'Refund' | 'Payout';

export interface Wallet {
  ownerType: 'vendor' | 'marketplace';
  ownerId: string;
  currency: string;
  balance: number;
  last_transaction_id?: string;
}

export interface Transaction {
  walletId: string;
  type: TransactionType;
  amount: number;
  runningBalance: number;
  referenceId: string;
  referenceType: ReferenceType;
  paymentId?: string;
  refundId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}