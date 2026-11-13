import { Collection, ClientSession, Db } from 'mongodb';
import {
  FinancialEventRecord,
  FinancialEventData,
  EventType,
  FinancialEventRepository,
} from './financial.event';

interface EventDoc {
  _id: string;
  eventId: string;
  eventType: string;
  eventSource: string;
  eventTimestamp: Date;
  orderId?: string;
  paymentId?: string;
  ovgId?: string;
  vendorId?: string;
  metadata?: Record<string, unknown>;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export class MongoFinancialEventRepository implements FinancialEventRepository {
  private col: Collection<EventDoc>;

  constructor(db: Db) {
    this.col = db.collection<EventDoc>('financial_events');
  }

  async save(event: FinancialEventRecord, session?: ClientSession): Promise<FinancialEventRecord> {
    const data = event.data;
    const doc: EventDoc = {
      _id: data.eventId,
      eventId: data.eventId,
      eventType: data.eventType,
      eventSource: data.eventSource,
      eventTimestamp: data.eventTimestamp,
      orderId: data.orderId,
      paymentId: data.paymentId,
      ovgId: data.ovgId,
      vendorId: data.vendorId,
      metadata: data.metadata,
      relatedEntityType: data.relatedEntityType,
      relatedEntityId: data.relatedEntityId,
    };
    await this.col.updateOne({ _id: data.eventId }, { $set: doc }, { upsert: true, session });
    return event;
  }

  async findById(eventId: string): Promise<FinancialEventRecord | null> {
    const doc = await this.col.findOne({ _id: eventId });
    if (!doc) return null;
    return this.map(doc);
  }

  async findByType(eventType: EventType): Promise<FinancialEventRecord[]> {
    const docs = await this.col.find({ eventType }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByOrderId(orderId: string): Promise<FinancialEventRecord[]> {
    const docs = await this.col.find({ orderId }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByVendorId(vendorId: string): Promise<FinancialEventRecord[]> {
    const docs = await this.col.find({ vendorId }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByEntity(entityType: 'payment' | 'transfer' | 'payout' | 'invoice', entityId: string): Promise<FinancialEventRecord[]> {
    const docs = await this.col
      .find({
        $or: [
          { relatedEntityType: entityType, relatedEntityId: entityId },
          { orderId: entityId },
          { paymentId: entityId },
        ],
      })
      .toArray();
    return docs.map(d => this.map(d));
  }

  async findAll(): Promise<FinancialEventRecord[]> {
    const docs = await this.col.find({}).toArray();
    return docs.map(d => this.map(d));
  }

  private map(doc: EventDoc): FinancialEventRecord {
    return FinancialEventRecord.fromExistingEvent({
      eventId: doc.eventId,
      eventType: doc.eventType as EventType,
      eventSource: doc.eventSource as 'internal' | 'external',
      eventTimestamp: new Date(doc.eventTimestamp),
      orderId: doc.orderId,
      paymentId: doc.paymentId,
      ovgId: doc.ovgId,
      vendorId: doc.vendorId,
      metadata: doc.metadata,
      relatedEntityType: doc.relatedEntityType as 'payment' | 'transfer' | 'payout' | 'invoice' | undefined,
      relatedEntityId: doc.relatedEntityId,
    });
  }
}
