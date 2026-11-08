import { Db, Collection } from 'mongodb';
import { 
  Order, 
  OrderData, 
  OrderStatus, 
  OrderVendorGroupStatus, 
  FinancialStatus,
  OrderRepository, 
  OrderError 
} from './order.domain';

interface OrderDoc {
  _id: string;
  personId: string;
  status: OrderStatus;
  vendorGroups: OrderVendorGroupDoc[];
  shippingAddress: AddressDoc;
  totalAmount: number;
  financialStatus: FinancialStatus;
  createdAt: Date;
  updatedAt: Date;
  comment?: string;
  commentedAt?: Date;
  commentedBy?: string;
  attemptId?: string;
  acceptedHash?: string;
}

interface OrderVendorGroupDoc {
  id: string;
  orderId: string;
  vendorId: string;
  status: OrderVendorGroupStatus;
  items: OrderItemDoc[];
  subtotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorNet: number;
  transferId?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OrderItemDoc {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  deliveredAt?: Date;
  deliveredBy?: string;
}

interface AddressDoc {
  id: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary: boolean;
}

export class MongoOrderRepository implements OrderRepository {
  private ordersCollection: Collection<OrderDoc>;

  constructor(db: Db) {
    this.ordersCollection = db.collection<OrderDoc>('orders');
  }

  async save(order: Order): Promise<Order> {
    const orderId = order.id;
    const now = new Date();

    const orderDoc: OrderDoc = {
      _id: orderId,
      personId: order.personId,
      status: order.status,
      vendorGroups: order.vendorGroups.map(vg => ({
        id: vg.id,
        orderId: vg.orderId,
        vendorId: vg.vendorId,
        status: vg.status,
        items: vg.items.map(item => ({
          id: item.id,
          productId: item.productId,
          productName: item.productName,
          vendorId: item.vendorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          deliveredAt: item.deliveredAt,
          deliveredBy: item.deliveredBy
        })),
        subtotal: vg.subtotal,
        commissionPct: vg.commissionPct,
        commissionAmount: vg.commissionAmount,
        vendorNet: vg.vendorNet,
        transferId: vg.transferId,
        createdAt: vg.createdAt,
        updatedAt: vg.updatedAt
      })),
      shippingAddress: {
        id: order.shippingAddress.id,
        street: order.shippingAddress.street,
        number: order.shippingAddress.number,
        neighborhood: order.shippingAddress.neighborhood,
        city: order.shippingAddress.city,
        state: order.shippingAddress.state,
        isPrimary: order.shippingAddress.isPrimary
      },
      totalAmount: order.totalAmount,
      financialStatus: order.financialStatus,
      createdAt: order.createdAt,
      updatedAt: now,
      comment: order.comment,
      commentedAt: order.commentedAt,
      commentedBy: order.commentedBy,
      attemptId: order.attemptId,
      acceptedHash: order.acceptedHash
    };

    const isPaidTransition = order.status === OrderStatus.PAID;
    const isPendingWrite = order.status === OrderStatus.PENDING_PAYMENT;

    const filter = isPaidTransition
      ? { _id: orderId, status: OrderStatus.PENDING_PAYMENT }
      : isPendingWrite
        ? { _id: orderId, status: { $nin: [OrderStatus.PROCESSING, OrderStatus.CANCELLED] } }
      : { _id: orderId };

    const result = await this.ordersCollection.updateOne(
      filter,
      {
        $set: {
          personId: orderDoc.personId,
          status: orderDoc.status,
          vendorGroups: orderDoc.vendorGroups,
          shippingAddress: orderDoc.shippingAddress,
          totalAmount: orderDoc.totalAmount,
          financialStatus: orderDoc.financialStatus,
          updatedAt: now,
          comment: orderDoc.comment,
          commentedAt: orderDoc.commentedAt,
          commentedBy: orderDoc.commentedBy,
          attemptId: orderDoc.attemptId,
          acceptedHash: orderDoc.acceptedHash
        },
        $setOnInsert: {
          createdAt: order.createdAt
        }
      },
      { upsert: !isPaidTransition && !isPendingWrite }
    );

    if (isPendingWrite && result.matchedCount === 0) {
      const existing = await this.ordersCollection.findOne({ _id: orderId });
      if (existing) {
        throw new Error(OrderError.INVALID_STATUS_TRANSITION);
      }
      try {
        await this.ordersCollection.insertOne(orderDoc);
      } catch (error) {
        // A concurrent insert must never turn the conditional write into an upsert.
        if ((error as { code?: number }).code === 11000 &&
            await this.ordersCollection.findOne({ _id: orderId })) {
          throw new Error(OrderError.INVALID_STATUS_TRANSITION);
        }
        throw error;
      }
    }

    if (isPaidTransition && result.matchedCount === 0) {
      // The stored PAID status does not prove that the caller's other changes
      // were persisted. Let callers resolve a rejected transition explicitly.
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }

    return Order.reconstruct({
      ...order.toJSON(),
      updatedAt: now
    } as any);
  }

  async findById(id: string): Promise<Order | null> {
    const orderDoc = await this.ordersCollection.findOne({ _id: id });

    if (!orderDoc) {
      return null;
    }

    return this.mapToOrder(orderDoc);
  }

  async findByPersonId(personId: string): Promise<Order[]> {
    const orders = await this.ordersCollection
      .find({ personId })
      .sort({ createdAt: -1 })
      .toArray();

    return orders.map(doc => this.mapToOrder(doc));
  }

  async findByStatus(status: OrderStatus): Promise<Order[]> {
    const orders = await this.ordersCollection
      .find({ status })
      .sort({ createdAt: -1 })
      .toArray();

    return orders.map(doc => this.mapToOrder(doc));
  }

  async findAll(): Promise<Order[]> {
    const orders = await this.ordersCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return orders.map(doc => this.mapToOrder(doc));
  }

  async findByCommentedBy(personId: string): Promise<Order[]> {
    const orders = await this.ordersCollection
      .find({ commentedBy: personId })
      .sort({ createdAt: -1 })
      .toArray();

    return orders.map(doc => this.mapToOrder(doc));
  }

  async update(order: Order): Promise<Order> {
    // Reuse save logic which handles upserts
    return this.save(order);
  }

  async delete(id: string): Promise<void> {
    await this.ordersCollection.deleteOne({ _id: id });
  }

  async insertForAttempt(insertData: { attemptId: string; personId: string; vendorGroups: any; shippingAddress: any; totalAmount: number; financialStatus: FinancialStatus }): Promise<Order> {
    const attemptId = insertData.attemptId;
    const personId = insertData.personId;
    const vendorGroups = insertData.vendorGroups;
    const shippingAddress = insertData.shippingAddress;
    const totalAmount = insertData.totalAmount;
    const financialStatus = insertData.financialStatus;

    const fixedId = `attempt:${attemptId}`;

    // Check if already exists → return existing (idempotent)
    const existing = await this.ordersCollection.findOne({ _id: fixedId });
    if (existing) {
      return Order.reconstruct({
        ...existing,
        updatedAt: new Date()
      } as any);
    }

    // Create the order with the fixed ID based on attemptId
    const now = new Date();

    const orderDoc: OrderDoc = {
      _id: fixedId,
      personId,
      status: OrderStatus.PENDING_PAYMENT,
      vendorGroups,
      shippingAddress,
      totalAmount,
      financialStatus,
      createdAt: now,
      updatedAt: now,
      attemptId,
      acceptedHash: undefined
    };

    try {
      await this.ordersCollection.insertOne(orderDoc);
    } catch (error: any) {
      // If duplicate key, read existing and return it (idempotent)
      if (error.code === 11000) {
        const dup = await this.ordersCollection.findOne({ _id: fixedId });
        if (dup) {
          return Order.reconstruct({
            ...dup,
            updatedAt: new Date()
          } as any);
        }
      }
      throw error;
    }

    return Order.reconstruct({
      id: fixedId,
      personId,
      status: OrderStatus.PENDING_PAYMENT,
      vendorGroups,
      shippingAddress,
      totalAmount,
      financialStatus,
      createdAt: now,
      updatedAt: now,
      attemptId,
      acceptedHash: undefined
    } as any);
  }

  private mapToOrder(doc: OrderDoc): Order {
    const orderData: OrderData = {
      id: doc._id,
      personId: doc.personId,
      status: doc.status,
      vendorGroups: doc.vendorGroups.map(vg => ({
        id: vg.id,
        orderId: vg.orderId,
        vendorId: vg.vendorId,
        status: vg.status,
        items: vg.items.map(item => ({
          id: item.id,
          productId: item.productId,
          productName: item.productName,
          vendorId: item.vendorId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          deliveredAt: item.deliveredAt,
          deliveredBy: item.deliveredBy
        })),
        subtotal: vg.subtotal,
        commissionPct: vg.commissionPct,
        commissionAmount: vg.commissionAmount,
        vendorNet: vg.vendorNet,
        transferId: vg.transferId,
        createdAt: vg.createdAt,
        updatedAt: vg.updatedAt
      })),
      shippingAddress: {
        id: doc.shippingAddress.id,
        street: doc.shippingAddress.street,
        number: doc.shippingAddress.number,
        neighborhood: doc.shippingAddress.neighborhood,
        city: doc.shippingAddress.city,
        state: doc.shippingAddress.state,
        isPrimary: doc.shippingAddress.isPrimary
      },
      totalAmount: doc.totalAmount,
      financialStatus: doc.financialStatus,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      comment: doc.comment,
      commentedAt: doc.commentedAt,
      commentedBy: doc.commentedBy,
      attemptId: doc.attemptId,
      acceptedHash: doc.acceptedHash
    };

    return Order.reconstruct(orderData);
  }
}
