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
          totalPrice: item.totalPrice
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
      commentedBy: order.commentedBy
    };

    const isPaidTransition = order.status === OrderStatus.PAID;

    const filter = isPaidTransition
      ? { _id: orderId, status: OrderStatus.PENDING_PAYMENT }
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
          commentedBy: orderDoc.commentedBy
        },
        $setOnInsert: {
          createdAt: order.createdAt
        }
      },
      { upsert: !isPaidTransition }
    );

    if (isPaidTransition && result.modifiedCount === 0) {
      const existing = await this.ordersCollection.findOne({ _id: orderId });
      if (existing && existing.status === OrderStatus.PAID) {
        // idempotent success: already PAID, do not overwrite
        return Order.reconstruct({
          ...order.toJSON(),
          status: OrderStatus.PAID,
          updatedAt: existing.updatedAt
        } as any);
      }
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
          totalPrice: item.totalPrice
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
      commentedBy: doc.commentedBy
    };

    return Order.reconstruct(orderData);
  }
}