import { Collection, Db } from 'mongodb';
import {
  Wallet,
  WalletData,
  WalletTransaction,
  WalletTransactionData,
  WalletRepository,
  WalletTransactionRepository,
} from './wallet.domain';

interface WalletDoc {
  _id: string;
  ownerId: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

interface WalletTxDoc {
  _id: string;
  walletId: string;
  ownerId: string;
  type: string;
  amount: number;
  referenceId: string;
  reason: string;
  orderId?: string;
  createdAt: Date;
}

export class MongoWalletRepository implements WalletRepository {
  private col: Collection<WalletDoc>;

  constructor(db: Db) {
    this.col = db.collection<WalletDoc>('wallets');
  }

  async save(wallet: Wallet): Promise<Wallet> {
    const now = new Date();
    await this.col.updateOne(
      { _id: wallet.id },
      {
        $set: {
          ownerId: wallet.ownerId,
          balance: wallet.balance,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: wallet.createdAt },
      },
      { upsert: true }
    );
    return Wallet.reconstruct({ ...wallet.toJSON(), updatedAt: now });
  }

  async findById(id: string): Promise<Wallet | null> {
    const doc = await this.col.findOne({ _id: id });
    if (!doc) return null;
    return this.map(doc);
  }

  async findByOwnerId(ownerId: string): Promise<Wallet | null> {
    const doc = await this.col.findOne({ ownerId });
    if (!doc) return null;
    return this.map(doc);
  }

  async update(wallet: Wallet): Promise<Wallet> {
    return this.save(wallet);
  }

  async findAll(): Promise<Wallet[]> {
    const docs = await this.col.find({}).toArray();
    return docs.map(d => this.map(d));
  }

  private map(doc: WalletDoc): Wallet {
    return Wallet.reconstruct({
      id: doc._id,
      ownerId: doc.ownerId,
      balance: doc.balance,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    });
  }
}

export class MongoWalletTransactionRepository implements WalletTransactionRepository {
  private col: Collection<WalletTxDoc>;

  constructor(db: Db) {
    this.col = db.collection<WalletTxDoc>('wallet_transactions');
  }

  async save(tx: WalletTransaction): Promise<WalletTransaction> {
    const doc: WalletTxDoc = {
      _id: tx.id,
      walletId: tx.walletId,
      ownerId: tx.ownerId,
      type: tx.type,
      amount: tx.amount,
      referenceId: tx.referenceId,
      reason: tx.reason,
      orderId: tx.orderId,
      createdAt: tx.createdAt,
    };
    await this.col.updateOne({ _id: tx.id }, { $set: doc }, { upsert: true });
    return tx;
  }

  async findById(id: string): Promise<WalletTransaction | null> {
    const doc = await this.col.findOne({ _id: id });
    if (!doc) return null;
    return this.map(doc);
  }

  async findByWalletId(walletId: string): Promise<WalletTransaction[]> {
    const docs = await this.col.find({ walletId }).sort({ createdAt: -1 }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByReferenceId(referenceId: string): Promise<WalletTransaction | null> {
    const doc = await this.col.findOne({ referenceId });
    if (!doc) return null;
    return this.map(doc);
  }

  async findAll(): Promise<WalletTransaction[]> {
    const docs = await this.col.find({}).toArray();
    return docs.map(d => this.map(d));
  }

  private map(doc: WalletTxDoc): WalletTransaction {
    return WalletTransaction.reconstruct({
      id: doc._id,
      walletId: doc.walletId,
      ownerId: doc.ownerId,
      type: doc.type as any,
      amount: doc.amount,
      referenceId: doc.referenceId,
      reason: doc.reason,
      orderId: doc.orderId,
      createdAt: new Date(doc.createdAt),
    });
  }
}
