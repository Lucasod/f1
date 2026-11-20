import { Db, Collection } from 'mongodb';
import { 
  Transfer, 
  TransferData, 
  TransferStatus 
} from './transfer.domain';

interface TransferDoc {
  _id: string;
  orderId: string;
  orderVendorGroupId: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  providerTransactionId?: string;
  stripeTransferId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoTransferRepository {
  private transfersCollection: Collection<TransferDoc>;

  constructor(db: Db) {
    this.transfersCollection = db.collection<TransferDoc>('transfers');
  }

  async save(transfer: Transfer): Promise<Transfer> {
    const now = new Date();
    const transferId = transfer.id;

    const transferDoc: TransferDoc = {
      _id: transferId,
      orderId: transfer.orderId,
      orderVendorGroupId: transfer.orderVendorGroupId,
      amount: transfer.amount,
      currency: transfer.currency,
      status: transfer.status,
      providerTransactionId: transfer.providerTransactionId,
      stripeTransferId: transfer.stripeTransferId,
      createdAt: transfer.createdAt,
      updatedAt: now
    };

    const setDoc: Record<string, any> = {
      orderId: transferDoc.orderId,
      orderVendorGroupId: transferDoc.orderVendorGroupId,
      amount: transferDoc.amount,
      currency: transferDoc.currency,
      status: transferDoc.status,
      updatedAt: now
    };

    if (transferDoc.providerTransactionId !== undefined) {
      setDoc.providerTransactionId = transferDoc.providerTransactionId;
    }

    if (transferDoc.stripeTransferId !== undefined) {
      setDoc.stripeTransferId = transferDoc.stripeTransferId;
    }

    await this.transfersCollection.updateOne(
      { _id: transferId },
      {
        $set: setDoc,
        $setOnInsert: {
          createdAt: transfer.createdAt
        }
      },
      { upsert: true }
    );

    return Transfer.reconstruct({
      ...transfer.toJSON(),
      updatedAt: now
    } as any);
  }

  async findByStripeTransferId(stripeTransferId: string): Promise<Transfer | null> {
    const transferDoc = await this.transfersCollection.findOne({ stripeTransferId });

    if (!transferDoc) {
      return null;
    }

    return this.mapTransfer(transferDoc);
  }

  async findByOrderId(orderId: string): Promise<Transfer[]> {
    const transfers = await this.transfersCollection
      .find({ orderId })
      .sort({ createdAt: -1 })
      .toArray();

    return transfers.map(doc => this.mapTransfer(doc));
  }

  async findByOrderVendorGroupId(orderVendorGroupId: string): Promise<Transfer[]> {
    const transfers = await this.transfersCollection
      .find({ orderVendorGroupId })
      .sort({ createdAt: -1 })
      .toArray();

    return transfers.map(doc => this.mapTransfer(doc));
  }

  async findByProviderTransactionId(providerTransactionId: string): Promise<Transfer | null> {
    const transferDoc = await this.transfersCollection.findOne({ providerTransactionId });

    if (!transferDoc) {
      return null;
    }

    return this.mapTransfer(transferDoc);
  }

  async findById(transferId: string): Promise<Transfer | null> {
    const transferDoc = await this.transfersCollection.findOne({ _id: transferId });

    if (!transferDoc) {
      return null;
    }

    return this.mapTransfer(transferDoc);
  }

  async update(id: string, updateData: Partial<TransferData>): Promise<Transfer | null> {
    const now = new Date();
    const result = await this.transfersCollection.updateOne(
      { _id: id },
      { 
        $set: { ...updateData, updatedAt: now } 
      }
    );

    if (result.matchedCount === 0) return null;

    return this.findById(id);
  }

  async findLastByOrderVendorGroupId(orderVendorGroupId: string): Promise<Transfer | null> {
    const transfer = await this.transfersCollection
      .findOne({ orderVendorGroupId }, { sort: { createdAt: -1 } });

    if (!transfer) {
      return null;
    }

    return this.mapTransfer(transfer);
  }

  private mapTransfer(doc: TransferDoc): Transfer {
    return Transfer.reconstruct({ ...doc, id: doc._id });
  }

  clear(): void {
    this.transfersCollection.deleteMany({});
  }
}