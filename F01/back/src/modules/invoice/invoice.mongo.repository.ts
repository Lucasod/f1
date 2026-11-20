import { Collection, Db, MongoServerError } from 'mongodb';
import { Invoice, InvoiceData, InvoiceStatus, InvoiceError, InvoiceRepository } from './invoice.domain';

interface InvoiceDoc {
  _id: string;
  orderId: string;
  vendorId: string;
  emissionAt: Date;
  pdfUrl: string;
  pdfPath: string;
  status: InvoiceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoInvoiceRepository implements InvoiceRepository {
  private readonly collection: Collection<InvoiceDoc>;

  constructor(db: Db) {
    this.collection = db.collection<InvoiceDoc>('invoices');
  }

  async save(invoice: Invoice): Promise<Invoice> {
    const invoiceId = invoice.id;
    const now = new Date();

    const setDoc: Record<string, any> = {
      orderId: invoice.orderId,
      vendorId: invoice.vendorId,
      emissionAt: invoice.emissionAt,
      pdfUrl: invoice.pdfUrl,
      pdfPath: invoice.pdfPath,
      status: invoice.status,
      updatedAt: now,
    };

    try {
      await this.collection.updateOne(
        { _id: invoiceId },
        {
          $set: setDoc,
          $setOnInsert: {
            createdAt: invoice.createdAt,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new Error(InvoiceError.INVOICE_ALREADY_EXISTS);
      }
      throw error;
    }

    return Invoice.reconstruct({
      ...invoice.toJSON(),
      updatedAt: now,
    } as any);
  }

  async findById(id: string): Promise<Invoice | null> {
    const document = await this.collection.findOne({ _id: id });
    if (!document) {
      return null;
    }
    return this.mapToInvoice(document);
  }

  async findByOrderId(orderId: string): Promise<Invoice | null> {
    const document = await this.collection.findOne({ orderId });
    if (!document) {
      return null;
    }
    return this.mapToInvoice(document);
  }

  async findAll(): Promise<Invoice[]> {
    const documents = await this.collection.find({}).sort({ createdAt: -1 }).toArray();
    return documents.map(document => this.mapToInvoice(document));
  }

  async update(invoice: Invoice): Promise<Invoice> {
    const now = new Date();
    const result = await this.collection.updateOne(
      { _id: invoice.id },
      {
        $set: {
          orderId: invoice.orderId,
          vendorId: invoice.vendorId,
          emissionAt: invoice.emissionAt,
          pdfUrl: invoice.pdfUrl,
          pdfPath: invoice.pdfPath,
          status: invoice.status,
          updatedAt: now,
        },
      },
    );
    if (result.matchedCount === 0) {
      throw new Error(InvoiceError.INVOICE_NOT_FOUND);
    }
    return Invoice.reconstruct({
      ...invoice.toJSON(),
      updatedAt: now,
    } as any);
  }

  private mapToInvoice(document: InvoiceDoc): Invoice {
    const invoiceData: InvoiceData = {
      id: document._id,
      orderId: document.orderId,
      vendorId: document.vendorId,
      emissionAt: new Date(document.emissionAt),
      pdfUrl: document.pdfUrl,
      pdfPath: document.pdfPath,
      status: document.status,
      createdAt: new Date(document.createdAt),
      updatedAt: new Date(document.updatedAt),
    };

    return Invoice.reconstruct(invoiceData);
  }
}
