import { Collection, Db } from 'mongodb';
import {
  FinancialMovementRecord,
  FinancialMovementData,
  MovementType,
  FinancialMovementRepository,
} from './financial.movement';

interface MovementDoc {
  _id: string;
  movementId: string;
  movementType: string;
  amount: number;
  currency: string;
  relatedEntityType: string;
  relatedEntityId: string;
  orderId?: string;
  paymentId?: string;
  ovgId?: string;
  vendorId?: string;
  effectiveAt: Date;
  recordedAt: Date;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

type RelatedEntityType = 'payment' | 'transfer' | 'payout' | 'invoice';

export class MongoFinancialMovementRepository implements FinancialMovementRepository {
  private col: Collection<MovementDoc>;

  constructor(db: Db) {
    this.col = db.collection<MovementDoc>('financial_movements');
  }

  async save(movement: FinancialMovementRecord, session?: unknown): Promise<FinancialMovementRecord> {
    const data = movement.data;
    const doc: MovementDoc = {
      _id: data.movementId,
      movementId: data.movementId,
      movementType: data.movementType,
      amount: data.amount,
      currency: data.currency,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId: data.relatedEntityId,
      orderId: data.orderId,
      paymentId: data.paymentId,
      ovgId: data.ovgId,
      vendorId: data.vendorId,
      effectiveAt: data.effectiveAt,
      recordedAt: data.recordedAt,
      idempotencyKey: data.idempotencyKey,
      metadata: data.metadata,
    };
    await this.col.updateOne({ _id: data.movementId }, { $set: doc }, { upsert: true, session });
    return movement;
  }

  async findById(movementId: string): Promise<FinancialMovementRecord | null> {
    const doc = await this.col.findOne({ _id: movementId });
    if (!doc) return null;
    return this.map(doc);
  }

  async findByOrderId(orderId: string): Promise<FinancialMovementRecord[]> {
    const docs = await this.col.find({ orderId }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByVendorId(vendorId: string): Promise<FinancialMovementRecord[]> {
    const docs = await this.col.find({ vendorId }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByMovementType(movementType: MovementType): Promise<FinancialMovementRecord[]> {
    const docs = await this.col.find({ movementType }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByEntity(entityType: RelatedEntityType, entityId: string): Promise<FinancialMovementRecord[]> {
    const docs = await this.col.find({ relatedEntityType: entityType, relatedEntityId: entityId }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByPeriod(start: Date, end: Date): Promise<FinancialMovementRecord[]> {
    const docs = await this.col
      .find({ effectiveAt: { $gte: start, $lte: end } })
      .toArray();
    return docs.map(d => this.map(d));
  }

  async findAll(): Promise<FinancialMovementRecord[]> {
    const docs = await this.col.find({}).toArray();
    return docs.map(d => this.map(d));
  }

  private map(doc: MovementDoc): FinancialMovementRecord {
    return FinancialMovementRecord.fromExistingMovement({
      movementId: doc.movementId,
      movementType: doc.movementType as MovementType,
      amount: doc.amount,
      currency: doc.currency,
      relatedEntityType: doc.relatedEntityType as RelatedEntityType,
      relatedEntityId: doc.relatedEntityId,
      orderId: doc.orderId,
      paymentId: doc.paymentId,
      ovgId: doc.ovgId,
      vendorId: doc.vendorId,
      effectiveAt: new Date(doc.effectiveAt),
      recordedAt: new Date(doc.recordedAt),
      idempotencyKey: doc.idempotencyKey,
      metadata: doc.metadata,
    });
  }
}
