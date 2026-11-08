import { Db, Collection } from 'mongodb';
import { 
  Payment, 
  PaymentData, 
  PaymentStatus, 
  PaymentRepository, 
  OrderError 
} from './order.domain';

interface PaymentDoc {
  _id: string;
  orderId: string;
  personId: string;
  amount: number;
  status: PaymentStatus;
  provider?: string;
  providerTransactionId?: string;
  authorizedAt?: Date;
  capturedAt?: Date;
  failedAt?: Date;
  refundedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  checkoutUrl?: string;
  attemptId?: string;
  acceptedHash?: string;
  acceptedSnapshot?: string;
}

export class MongoPaymentRepository implements PaymentRepository {
  private paymentsCollection: Collection<PaymentDoc>;

  constructor(db: Db) {
    this.paymentsCollection = db.collection<PaymentDoc>('payments');
  }

  async save(payment: Payment): Promise<Payment> {
    const paymentId = payment.id;
    const now = new Date();

    const paymentDoc: PaymentDoc = {
      _id: paymentId,
      orderId: payment.orderId,
      personId: payment.personId,
      amount: payment.amount,
      status: payment.status,
      provider: payment.provider,
      providerTransactionId: payment.providerTransactionId,
      authorizedAt: payment.authorizedAt,
      capturedAt: payment.capturedAt,
      failedAt: payment.failedAt,
      refundedAt: payment.refundedAt,
      createdAt: payment.createdAt,
      updatedAt: now,
      checkoutUrl: payment.checkoutUrl
    };

    const setDoc: Record<string, any> = {
      orderId: paymentDoc.orderId,
      personId: paymentDoc.personId,
      amount: paymentDoc.amount,
      status: paymentDoc.status,
      provider: paymentDoc.provider,
      authorizedAt: paymentDoc.authorizedAt,
      capturedAt: paymentDoc.capturedAt,
      failedAt: paymentDoc.failedAt,
      refundedAt: paymentDoc.refundedAt,
      updatedAt: now
    };

    if (paymentDoc.providerTransactionId !== undefined) {
      setDoc.providerTransactionId = paymentDoc.providerTransactionId;
    }
    if (paymentDoc.checkoutUrl !== undefined) {
      setDoc.checkoutUrl = paymentDoc.checkoutUrl;
    }

    await this.paymentsCollection.updateOne(
      { _id: paymentId },
      {
        $set: setDoc,
        $setOnInsert: {
          createdAt: payment.createdAt
        }
      },
      { upsert: true }
    );

    return Payment.reconstruct({
      ...payment.toJSON(),
      updatedAt: now
    } as any);
  }

  async insertForAttempt(paymentData: { attemptId: string; orderId: string; personId: string; amount: number }): Promise<Payment> {
    const attemptId = paymentData.attemptId;
    const fixedId = `attempt:${attemptId}`;

    // Check if a payment with this attemptId already exists
    const existing = await this.paymentsCollection.findOne({ _id: fixedId });
    if (existing) {
      return Payment.reconstruct({
        ...existing,
        updatedAt: new Date()
      } as any);
    }

    // Create the payment with the fixed ID based on attemptId
    const now = new Date();
    const paymentId = fixedId;

    const paymentDoc: PaymentDoc = {
      _id: fixedId,
      orderId: paymentData.orderId,
      personId: paymentData.personId,
      amount: paymentData.amount,
      status: PaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      attemptId: attemptId,
      acceptedHash: undefined,
      acceptedSnapshot: undefined
    };

    try {
      await this.paymentsCollection.insertOne(paymentDoc);
    } catch (error: any) {
      // If duplicate key, read existing and return it (idempotent)
      if (error.code === 11000) {
        const dup = await this.paymentsCollection.findOne({ _id: fixedId });
        if (dup) {
          return Payment.reconstruct({
            ...dup,
            updatedAt: new Date()
          } as any);
        }
      }
      throw error;
    }

    return Payment.reconstruct({
      id: fixedId,
      orderId: paymentData.orderId,
      personId: paymentData.personId,
      amount: paymentData.amount,
      status: PaymentStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      attemptId: attemptId,
      acceptedHash: undefined,
      acceptedSnapshot: undefined
    } as any);
  }

  async findById(id: string): Promise<Payment | null> {
    const paymentDoc = await this.paymentsCollection.findOne({ _id: id });

    if (!paymentDoc) {
      return null;
    }

    return this.mapToPayment(paymentDoc);
  }

  async findByOrderId(orderId: string): Promise<Payment[]> {
    const payments = await this.paymentsCollection
      .find({ orderId })
      .sort({ createdAt: -1 })
      .toArray();

    return payments.map(doc => this.mapToPayment(doc));
  }

  async findByPersonId(personId: string): Promise<Payment[]> {
    const payments = await this.paymentsCollection
      .find({ personId })
      .sort({ createdAt: -1 })
      .toArray();

    return payments.map(doc => this.mapToPayment(doc));
  }

  async update(payment: Payment): Promise<Payment> {
    // Reuse save logic which handles upserts
    return this.save(payment);
  }

  async delete(id: string): Promise<void> {
    await this.paymentsCollection.deleteOne({ _id: id });
  }

  private mapToPayment(doc: PaymentDoc): Payment {
    const paymentData: PaymentData = {
      id: doc._id,
      orderId: doc.orderId,
      personId: doc.personId,
      amount: doc.amount,
      status: doc.status,
      provider: doc.provider,
      providerTransactionId: doc.providerTransactionId,
      authorizedAt: doc.authorizedAt,
      capturedAt: doc.capturedAt,
      failedAt: doc.failedAt,
      refundedAt: doc.refundedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      checkoutUrl: doc.checkoutUrl
    };

    return Payment.reconstruct(paymentData);
  }
}