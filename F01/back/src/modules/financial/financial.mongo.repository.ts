import { Collection, ClientSession, Db } from 'mongodb';
import { FinancialAllocation, FinancialAllocationData, FinancialAllocationRepository } from './financial.domain';

interface Doc {
  _id: string;
  orderId: string;
  vendorId: string;
  type: string;
  gross: number;
  fees: number;
  adjustments: number;
  net: number;
  referenceId: string;
  createdAt: Date;
}

export class MongoFinancialAllocationRepository implements FinancialAllocationRepository {
  private col: Collection<Doc>;

  constructor(db: Db) {
    this.col = db.collection<Doc>('financial_allocations');
  }

  async save(allocation: FinancialAllocation, session?: ClientSession): Promise<FinancialAllocation> {
    const doc: Doc = {
      _id: allocation.id,
      orderId: allocation.orderId,
      vendorId: allocation.vendorId,
      type: allocation.type,
      gross: allocation.gross,
      fees: allocation.fees,
      adjustments: allocation.adjustments,
      net: allocation.net,
      referenceId: allocation.referenceId,
      createdAt: allocation.createdAt,
    };
    await this.col.updateOne({ _id: allocation.id }, { $set: doc }, { upsert: true, session });
    return allocation;
  }

  async findById(id: string): Promise<FinancialAllocation | null> {
    const doc = await this.col.findOne({ _id: id });
    if (!doc) return null;
    return this.map(doc);
  }

  async findByOrderId(orderId: string): Promise<FinancialAllocation[]> {
    const docs = await this.col.find({ orderId }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByVendorId(vendorId: string): Promise<FinancialAllocation[]> {
    const docs = await this.col.find({ vendorId }).toArray();
    return docs.map(d => this.map(d));
  }

  async findByReferenceId(referenceId: string): Promise<FinancialAllocation | null> {
    const doc = await this.col.findOne({ referenceId });
    if (!doc) return null;
    return this.map(doc);
  }

  async findAll(): Promise<FinancialAllocation[]> {
    const docs = await this.col.find({}).toArray();
    return docs.map(d => this.map(d));
  }

  private map(doc: Doc): FinancialAllocation {
    return FinancialAllocation.reconstruct({
      id: doc._id,
      orderId: doc.orderId,
      vendorId: doc.vendorId,
      type: doc.type as any,
      gross: doc.gross,
      fees: doc.fees,
      adjustments: doc.adjustments,
      net: doc.net,
      referenceId: doc.referenceId,
      createdAt: new Date(doc.createdAt),
    });
  }
}
