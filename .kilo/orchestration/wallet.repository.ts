/**
 * Wallet and Transaction repository interfaces and implementations for T-1007.
 *
 * Follows interface-based repository injection pattern (project convention:
 * interface_based_repository_injection). Backend uses interface-based
 * repository injection for all four domain modules; MongoDB implementations
 * are primary in normal flow, InMemory only for dev fallback.
 */

import { Wallet, Transaction, TransactionType, ReferenceType } from './wallet.domain.ts';

// -- Repository interfaces --

export * from './wallet.domain.ts';

export interface WalletRepository {
  findByOwner(ownerType: 'vendor' | 'marketplace', ownerId: string): Promise<Wallet | null>;
  findById(id: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<Wallet>;
  deleteById(id: string): Promise<void>;
}

export interface TransactionRepository {
  findByWallet(walletId: string): Promise<Transaction[]>;
  findByReference(referenceId: string, referenceType: ReferenceType): Promise<Transaction | null>;
  create(transaction: Transaction): Promise<Transaction>;
  findLatestByWallet(walletId: string): Promise<Transaction | null>;
}

// -- InMemory implementations (dev fallback) --

export class InMemoryWalletRepository implements WalletRepository {
  private wallets: Map<string, Wallet> = new Map();

  async findByOwner(ownerType: 'vendor' | 'marketplace', ownerId: string): Promise<Wallet | null> {
    for (const [, w] of this.wallets) {
      if (w.ownerType === ownerType && w.ownerId === ownerId) {
        return w;
      }
    }
    return null;
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) || null;
  }

  async save(wallet: Wallet): Promise<Wallet> {
    this.wallets.set(wallet.ownerId, wallet);
    return wallet;
  }

  async deleteById(id: string): Promise<void> {
    // Append-only: deletion not allowed; no-op to enforce principle
    // Financial adjustments should use transactions, not wallet deletion
  }
}

export class InMemoryTransactionRepository implements TransactionRepository {
  private transactions: Map<string, Transaction> = new Map();

  async findByWallet(walletId: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values())
      .filter((t) => t.walletId === walletId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findByReference(referenceId: string, referenceType: ReferenceType): Promise<Transaction | null> {
    for (const t of this.transactions.values()) {
      if (t.referenceId === referenceId && t.referenceType === referenceType) {
        return t;
      }
    }
    return null;
  }

  async create(transaction: Transaction): Promise<Transaction> {
    const key = transaction.walletId + '-' + transaction.createdAt;
    this.transactions.set(key, transaction);
    // Store the transaction ID for later reference (last_transaction_id)
    transaction._id = key;
    return transaction;
  }

  async findLatestByWallet(walletId: string): Promise<Transaction | null> {
    const byWallet = await this.findByWallet(walletId);
    return byWallet?.[0] || null;
  }
}

// -- MongoDB implementations (primary) --

import { MongoClient, ObjectId } from 'mongodb';

export class MongoDBWalletRepository implements WalletRepository {
  constructor(private client: MongoClient, private dbName: string) {
    if (!client) {
      throw new Error('MongoClient is required for MongoDBWalletRepository');
    }
  }

  private get collection() {
    return this.client.db(this.dbName).collection('wallets');
  }

  async findByOwner(ownerType: 'vendor' | 'marketplace', ownerId: string): Promise<Wallet | null> {
    const doc = await this.collection.findOne({ ownerType, ownerId });
    if (!doc) return null;
    return {
      ownerType: doc.ownerType,
      ownerId: doc.ownerId.toString(),
      currency: doc.currency,
      balance: doc.balance.toNumber(),
      last_transaction_id: doc.last_transaction_id?.toString(),
    };
  }

  async findById(id: string): Promise<Wallet | null> {
    const doc = await this.collection.findOne({ ownerId: new ObjectId(id) });
    if (!doc) return null;
    return {
      ownerType: doc.ownerType,
      ownerId: doc.ownerId.toString(),
      currency: doc.currency,
      balance: doc.balance.toNumber(),
      last_transaction_id: doc.last_transaction_id?.toString(),
    };
  }

  async save(wallet: Wallet): Promise<Wallet> {
    await this.collection.updateOne(
      { ownerId: new ObjectId(wallet.ownerId) },
      {
        $set: {
          ownerType: wallet.ownerType,
          currency: wallet.currency,
          balance: wallet.balance,
          last_transaction_id: wallet.last_transaction_id ? new ObjectId(wallet.last_transaction_id) : undefined,
        },
      },
      { upsert: true },
    );
    return wallet;
  }

  async deleteById(id: string): Promise<void> {
    // Append-only enforcement: wallet deletion not permitted.
    // Financial adjustments should use transactions with REFUND/ADJUSTMENT types instead.
    throw new Error('Operation not allowed: wallets are append-only; use transactions for financial adjustments');
  }
}

export class MongoDBTransactionRepository implements TransactionRepository {
  constructor(private client: MongoClient, private dbName: string) {
    if (!client) {
      throw new Error('MongoClient is required for MongoDBTransactionRepository');
    }
  }

  private get collection() {
    return this.client.db(this.dbName).collection('transactions');
  }

  async findByWallet(walletId: string): Promise<Transaction[]> {
    const cursor = this.collection.find({ walletId });
    const docs = await cursor.sort({ createdAt: -1 }).toArray();
    return docs.map((doc) => ({
      walletId: doc.walletId,
      type: doc.type,
      amount: doc.amount,
      runningBalance: doc.runningBalance,
      referenceId: doc.referenceId,
      referenceType: doc.referenceType,
      paymentId: doc.paymentId,
      refundId: doc.refundId,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
    }));
  }

  async findByReference(referenceId: string, referenceType: ReferenceType): Promise<Transaction | null> {
    const doc = await this.collection.findOne({ referenceId, referenceType });
    if (!doc) return null;
    return {
      walletId: doc.walletId,
      type: doc.type,
      amount: doc.amount,
      runningBalance: doc.runningBalance,
      referenceId: doc.referenceId,
      referenceType: doc.referenceType,
      paymentId: doc.paymentId,
      refundId: doc.refundId,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
    };
  }

  async create(transaction: Transaction): Promise<Transaction> {
    // Atomic MongoDB session: create Transaction AND update Wallet balance in same session
    if (this.client) {
      const session = this.client.startSession();
      await session.withTransaction(async () => {
        // Insert the transaction
        const result = await this.collection.insertOne({
          walletId: transaction.walletId,
          type: transaction.type,
          amount: transaction.amount,
          runningBalance: transaction.runningBalance,
          referenceId: transaction.referenceId,
          referenceType: transaction.referenceType,
          paymentId: transaction.paymentId,
          refundId: transaction.refundId,
          metadata: transaction.metadata,
          createdAt: new Date(),
        });

        // Set the inserted ID on the transaction for the service layer reference
        transaction._id = result.insertedId;

        // Update the wallet balance atomically, setting last_transaction_id to the inserted ID
        const walletCollection = this.client.db(this.dbName).collection('wallets');
        await walletCollection.updateOne(
          { ownerId: new ObjectId(transaction.walletId) },
          {
            $inc: { balance: transaction.amount },
            $set: { last_transaction_id: result.insertedId },
          },
        );
      });
      // session.withTransaction auto-ends the session; no explicit end needed
    } else {
      // Fallback: simple insert without atomic session (InMemory-compatible path)
      const result = await this.collection.insertOne({
        walletId: transaction.walletId,
        type: transaction.type,
        amount: transaction.amount,
        runningBalance: transaction.runningBalance,
        referenceId: transaction.referenceId,
        referenceType: transaction.referenceType,
        paymentId: transaction.paymentId,
        refundId: transaction.refundId,
        metadata: transaction.metadata,
        createdAt: new Date(),
      });
      // Set the inserted ID on the transaction for InMemory path reference
      transaction._id = result.insertedId?.toString();
    }

    return {
      ...transaction,
      createdAt: new Date().toISOString(),
    };
  }

  async findLatestByWallet(walletId: string): Promise<Transaction | null> {
    const doc = await this.collection.findOne({ walletId }, { sort: { createdAt: -1 } });
    if (!doc) return null;
    return {
      walletId: doc.walletId,
      type: doc.type,
      amount: doc.amount,
      runningBalance: doc.runningBalance,
      referenceId: doc.referenceId,
      referenceType: doc.referenceType,
      paymentId: doc.paymentId,
      refundId: doc.refundId,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
    };
  }
}