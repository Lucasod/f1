import { Collection, Db } from 'mongodb';
import { Payout, PayoutData, PayoutStatus, PayoutRepository } from './payout.domain';

interface PayoutDoc {
  _id: string;
  vendorId: string;
  personId: string;
  amount: number;
  status: PayoutStatus;
  requestedAt: Date;
  processedAt?: Date;
  failureReason?: string;
  reference?: string;
  bankAccount?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoPayoutRepository implements PayoutRepository {
  private payoutsCollection: Collection<PayoutDoc>;

  constructor(db: Db) {
    this.payoutsCollection = db.collection<PayoutDoc>('payouts');
  }

  async save(payout: Payout): Promise<Payout> {
    const payoutId = payout.id;
    const now = new Date();

    const setDoc: Record<string, any> = {
      vendorId: payout.vendorId,
      personId: payout.personId,
      amount: payout.amount,
      status: payout.status,
      requestedAt: payout.requestedAt,
      processedAt: payout.processedAt,
      failureReason: payout.failureReason,
      reference: payout.reference,
      bankAccount: payout.bankAccount,
      updatedAt: now,
    };

    await this.payoutsCollection.updateOne(
      { _id: payoutId },
      {
        $set: setDoc,
        $setOnInsert: {
          createdAt: payout.createdAt,
        },
      },
      { upsert: true }
    );

    return Payout.reconstruct({
      ...payout.toJSON(),
      updatedAt: now,
    } as PayoutData);
  }

  async findById(id: string): Promise<Payout | null> {
    const payoutDoc = await this.payoutsCollection.findOne({ _id: id });

    if (!payoutDoc) {
      return null;
    }

    return this.mapToPayout(payoutDoc);
  }

  async findByVendorId(vendorId: string): Promise<Payout[]> {
    const payouts = await this.payoutsCollection
      .find({ vendorId })
      .sort({ createdAt: -1 })
      .toArray();

    return payouts.map(doc => this.mapToPayout(doc));
  }

  async findByPersonId(personId: string): Promise<Payout[]> {
    const payouts = await this.payoutsCollection
      .find({ personId })
      .sort({ createdAt: -1 })
      .toArray();

    return payouts.map(doc => this.mapToPayout(doc));
  }

  async findAll(): Promise<Payout[]> {
    const payouts = await this.payoutsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return payouts.map(doc => this.mapToPayout(doc));
  }

  async update(payout: Payout): Promise<Payout> {
    return this.save(payout);
  }

  private mapToPayout(doc: PayoutDoc): Payout {
    const payoutData: PayoutData = {
      id: doc._id,
      vendorId: doc.vendorId,
      personId: doc.personId,
      amount: doc.amount,
      status: doc.status,
      requestedAt: new Date(doc.requestedAt),
      processedAt: doc.processedAt ? new Date(doc.processedAt) : undefined,
      failureReason: doc.failureReason,
      reference: doc.reference,
      bankAccount: doc.bankAccount,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    };

    return Payout.reconstruct(payoutData);
  }
}
