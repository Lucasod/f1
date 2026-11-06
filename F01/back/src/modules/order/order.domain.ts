export enum OrderStatus {
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  FAILED_PAYMENT = 'failed_payment'
}

export const VALID_ORDER_STATUSES: OrderStatus[] = Object.values(OrderStatus);

export enum OrderVendorGroupStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PREPARING = 'preparing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  RETURNED = 'returned'
}

export const VALID_VENDOR_GROUP_STATUSES: OrderVendorGroupStatus[] = Object.values(OrderVendorGroupStatus);

export enum PaymentStatus {
  PENDING = 'pending',
  AUTHORIZED = 'authorized',
  CAPTURED = 'captured',
  FAILED = 'failed',
  REFUNDED = 'refunded'
}

export const VALID_PAYMENT_STATUSES: PaymentStatus[] = Object.values(PaymentStatus);

export enum FinancialStatus {
  PENDING = 'pending',
  FULLY_REFUNDED = 'fully_refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  PAID = 'paid'
}

export const VALID_FINANCIAL_STATUSES: FinancialStatus[] = Object.values(FinancialStatus);

export enum OrderError {
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_ITEM_NOT_FOUND = 'ORDER_ITEM_NOT_FOUND',
  CART_EMPTY = 'CART_EMPTY',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  INVALID_SHIPPING_ADDRESS = 'INVALID_SHIPPING_ADDRESS',
  INVALID_COUPON = 'INVALID_COUPON',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  STOCK_ROLLBACK_FAILED = 'STOCK_ROLLBACK_FAILED',
  PERSON_ID_REQUIRED = 'PERSON_ID_REQUIRED',
  VENDOR_ID_REQUIRED = 'VENDOR_ID_REQUIRED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_QUANTITY = 'INVALID_QUANTITY',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_COMMISSION_PCT = 'INVALID_COMMISSION_PCT',
  ORDER_COMMENT_ALREADY_EXISTS = 'ORDER_COMMENT_ALREADY_EXISTS',
  ORDER_NOT_DELIVERED = 'ORDER_NOT_DELIVERED',
  INVALID_COMMENT = 'INVALID_COMMENT'
}

export interface Address {
  id: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary: boolean;
}

export interface OrderItemData {
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

export interface OrderVendorGroupData {
  id: string;
  orderId: string;
  vendorId: string;
  status: OrderVendorGroupStatus;
  items: OrderItemData[];
  subtotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorNet: number;
  transferId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderData {
  id: string;
  personId: string;
  status: OrderStatus;
  vendorGroups: OrderVendorGroupData[];
  shippingAddress: Address;
  totalAmount: number;
  financialStatus: FinancialStatus;
  createdAt: Date;
  updatedAt: Date;
  comment?: string;
  commentedAt?: Date;
  commentedBy?: string;
}

export interface PaymentData {
  id: string;
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
  eventId?: string;
  originalEventId?: string;
  eventType?: string;
  eventSource?: string;
  eventTimestamp?: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const VALID_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.FAILED_PAYMENT, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED, OrderStatus.FAILED_PAYMENT],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [OrderStatus.CANCELLED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.FAILED_PAYMENT]: [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED]
};

const VALID_VENDOR_GROUP_TRANSITIONS: Record<OrderVendorGroupStatus, OrderVendorGroupStatus[]> = {
  [OrderVendorGroupStatus.PENDING]: [OrderVendorGroupStatus.CONFIRMED, OrderVendorGroupStatus.CANCELLED],
  [OrderVendorGroupStatus.CONFIRMED]: [OrderVendorGroupStatus.PREPARING, OrderVendorGroupStatus.CANCELLED],
  [OrderVendorGroupStatus.PREPARING]: [OrderVendorGroupStatus.SHIPPED, OrderVendorGroupStatus.CANCELLED],
  [OrderVendorGroupStatus.SHIPPED]: [OrderVendorGroupStatus.DELIVERED, OrderVendorGroupStatus.CANCELLED, OrderVendorGroupStatus.RETURNED],
  [OrderVendorGroupStatus.DELIVERED]: [OrderVendorGroupStatus.RETURNED],
  [OrderVendorGroupStatus.CANCELLED]: [],
  [OrderVendorGroupStatus.RETURNED]: []
};

export class OrderItem {
  public readonly id: string;
  public readonly productId: string;
  public readonly productName: string;
  public readonly vendorId: string;
  public readonly quantity: number;
  public readonly unitPrice: number;
  public readonly totalPrice: number;
  public deliveredAt?: Date;
  public deliveredBy?: string;

  private constructor(data: OrderItemData) {
    this.id = data.id;
    this.productId = data.productId;
    this.productName = data.productName;
    this.vendorId = data.vendorId;
    this.quantity = data.quantity;
    this.unitPrice = data.unitPrice;
    this.totalPrice = data.totalPrice;
    this.deliveredAt = data.deliveredAt ? new Date(data.deliveredAt) : undefined;
    this.deliveredBy = data.deliveredBy;
  }

  static create(data: Omit<OrderItemData, 'id' | 'totalPrice'>): OrderItem {
    if (!data.productId || data.productId.trim().length === 0) {
      throw new Error(OrderError.PRODUCT_NOT_FOUND);
    }
    if (!data.productName || data.productName.trim().length === 0) {
      throw new Error(OrderError.PRODUCT_NOT_FOUND);
    }
    if (!data.vendorId || data.vendorId.trim().length === 0) {
      throw new Error(OrderError.VENDOR_NOT_FOUND);
    }
    if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
      throw new Error(OrderError.INVALID_QUANTITY);
    }
    if (!Number.isFinite(data.unitPrice) || data.unitPrice < 0) {
      throw new Error(OrderError.INVALID_AMOUNT);
    }

    return new OrderItem({
      ...data,
      id: generateId(),
      totalPrice: data.unitPrice * data.quantity
    });
  }

  static reconstruct(data: OrderItemData): OrderItem {
    return new OrderItem(data);
  }

  toJSON(): OrderItemData {
    return {
      id: this.id,
      productId: this.productId,
      productName: this.productName,
      vendorId: this.vendorId,
      quantity: this.quantity,
      unitPrice: this.unitPrice,
      totalPrice: this.totalPrice,
      deliveredAt: this.deliveredAt,
      deliveredBy: this.deliveredBy
    };
  }

  markDelivered(deliveredBy: string): void {
    if (typeof deliveredBy !== 'string' || deliveredBy.trim().length === 0) {
      throw new Error(OrderError.VENDOR_ID_REQUIRED);
    }
    this.deliveredAt = new Date();
    this.deliveredBy = deliveredBy.trim();
  }

  get isDelivered(): boolean {
    return this.deliveredAt !== undefined;
  }
}

export class OrderVendorGroup {
  public readonly id: string;
  public readonly orderId: string;
  public readonly vendorId: string;
  public status: OrderVendorGroupStatus;
  public items: OrderItem[];
  public subtotal: number;
  public commissionPct: number;
  public commissionAmount: number;
  public vendorNet: number;
  public transferId?: string;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: OrderVendorGroupData) {
    this.id = data.id;
    this.orderId = data.orderId;
    this.vendorId = data.vendorId;
    this.status = data.status;
    this.items = data.items.map(item => OrderItem.reconstruct(item));
    this.subtotal = data.subtotal;
    this.commissionPct = data.commissionPct;
    this.commissionAmount = data.commissionAmount;
    this.vendorNet = data.vendorNet;
    this.transferId = data.transferId;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(data: {
    orderId: string;
    vendorId: string;
    items: Omit<OrderItemData, 'id' | 'totalPrice'>[];
    commissionPct: number;
  }): OrderVendorGroup {
    if (!data.orderId || data.orderId.trim().length === 0) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }
    if (!data.vendorId || data.vendorId.trim().length === 0) {
      throw new Error(OrderError.VENDOR_NOT_FOUND);
    }
    if (!data.items || data.items.length === 0) {
      throw new Error(OrderError.CART_EMPTY);
    }
    if (typeof data.commissionPct !== 'number' || data.commissionPct < 0 || data.commissionPct > 100) {
      throw new Error(OrderError.INVALID_COMMISSION_PCT);
    }

    const orderItems = data.items.map(item => OrderItem.create(item));
    const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const commissionAmount = subtotal * (data.commissionPct / 100);
    const vendorNet = subtotal - commissionAmount;
    const now = new Date();

    return new OrderVendorGroup({
      id: generateId(),
      orderId: data.orderId,
      vendorId: data.vendorId,
      status: OrderVendorGroupStatus.PENDING,
      items: orderItems,
      subtotal,
      commissionPct: data.commissionPct,
      commissionAmount,
      vendorNet,
      createdAt: now,
      updatedAt: now
    });
  }

  static reconstruct(data: OrderVendorGroupData): OrderVendorGroup {
    return new OrderVendorGroup(data);
  }

  addItem(itemData: Omit<OrderItemData, 'id' | 'totalPrice'>): void {
    if (this.status !== OrderVendorGroupStatus.PENDING && this.status !== OrderVendorGroupStatus.CONFIRMED) {
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }

    const item = OrderItem.create(itemData);
    this.items.push(item);
    this.recalculateTotals();
    this.updatedAt = new Date();
  }

  updateStatus(newStatus: OrderVendorGroupStatus): void {
    if (this.status === newStatus) {
      // Ensure item-level delivery metadata is present when already delivered
      if (newStatus === OrderVendorGroupStatus.DELIVERED) {
        for (const item of this.items) {
          if (!item.isDelivered) {
            item.markDelivered(this.vendorId);
          }
        }
      }
      return;
    }

    const allowedTransitions = VALID_VENDOR_GROUP_TRANSITIONS[this.status];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }

    this.status = newStatus;
    if (newStatus === OrderVendorGroupStatus.DELIVERED) {
      for (const item of this.items) {
        if (!item.isDelivered) {
          item.markDelivered(this.vendorId);
        }
      }
    }
    this.updatedAt = new Date();
  }

  calculateTotals(): { subtotal: number; commissionAmount: number; vendorNet: number } {
    const subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const commissionAmount = subtotal * (this.commissionPct / 100);
    const vendorNet = subtotal - commissionAmount;
    return { subtotal, commissionAmount, vendorNet };
  }

  recalculateTotals(): void {
    const totals = this.calculateTotals();
    this.subtotal = totals.subtotal;
    this.commissionAmount = totals.commissionAmount;
    this.vendorNet = totals.vendorNet;
  }

  setTransferId(transferId: string): void {
    this.transferId = transferId;
    this.updatedAt = new Date();
  }

  get isCompleted(): boolean {
    return this.status === OrderVendorGroupStatus.DELIVERED || this.status === OrderVendorGroupStatus.CANCELLED || this.status === OrderVendorGroupStatus.RETURNED;
  }

  toJSON(): OrderVendorGroupData {
    return {
      id: this.id,
      orderId: this.orderId,
      vendorId: this.vendorId,
      status: this.status,
      items: this.items.map(item => item.toJSON()),
      subtotal: this.subtotal,
      commissionPct: this.commissionPct,
      commissionAmount: this.commissionAmount,
      vendorNet: this.vendorNet,
      transferId: this.transferId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

export class Order {
  public readonly id: string;
  public readonly personId: string;
  public status: OrderStatus;
  public vendorGroups: OrderVendorGroup[];
  public shippingAddress: Address;
  public totalAmount: number;
  public financialStatus: FinancialStatus;
  public readonly createdAt: Date;
  public updatedAt: Date;
  public comment?: string;
  public commentedAt?: Date;
  public commentedBy?: string;

  private constructor(data: OrderData) {
    this.id = data.id;
    this.personId = data.personId;
    this.status = data.status;
    this.vendorGroups = data.vendorGroups.map(vg => OrderVendorGroup.reconstruct(vg));
    this.shippingAddress = { ...data.shippingAddress };
    this.totalAmount = data.totalAmount;
    this.financialStatus = data.financialStatus;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.comment = data.comment;
    this.commentedAt = data.commentedAt;
    this.commentedBy = data.commentedBy;
  }

  static create(data: {
    personId: string;
    vendorGroups: { vendorId: string; items: Omit<OrderItemData, 'id' | 'totalPrice'>[]; commissionPct: number }[];
    shippingAddress: Address;
  }): Order {
    if (!data.personId || data.personId.trim().length === 0) {
      throw new Error(OrderError.PERSON_ID_REQUIRED);
    }
    if (!data.vendorGroups || data.vendorGroups.length === 0) {
      throw new Error(OrderError.CART_EMPTY);
    }
    if (!data.shippingAddress) {
      throw new Error(OrderError.INVALID_SHIPPING_ADDRESS);
    }

    const now = new Date();
    const orderId = generateId();

    const vendorGroupInstances = data.vendorGroups.map(vg => 
      OrderVendorGroup.create({
        orderId,
        vendorId: vg.vendorId,
        items: vg.items,
        commissionPct: vg.commissionPct
      })
    );

    const totalAmount = vendorGroupInstances.reduce((sum, vg) => sum + vg.subtotal, 0);

    return new Order({
      id: orderId,
      personId: data.personId,
      status: OrderStatus.PENDING_PAYMENT,
      vendorGroups: vendorGroupInstances,
      shippingAddress: { ...data.shippingAddress },
      totalAmount,
      financialStatus: FinancialStatus.PENDING,
      createdAt: now,
      updatedAt: now
    });
  }

  static reconstruct(data: OrderData): Order {
    return new Order(data);
  }

  getVendorGroup(vendorId: string): OrderVendorGroup | undefined {
    return this.vendorGroups.find(vg => vg.vendorId === vendorId);
  }

  updateVendorGroupStatus(vendorId: string, status: OrderVendorGroupStatus): void {
    const vendorGroup = this.getVendorGroup(vendorId);
    if (!vendorGroup) {
      throw new Error(OrderError.VENDOR_NOT_FOUND);
    }
    vendorGroup.updateStatus(status);
    this.updateOrderStatusFromVendorGroups();
    this.updatedAt = new Date();
  }

  markItemsDeliveredByIds(itemIds: string[], deliveredBy: string): void {
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      throw new Error(OrderError.ORDER_ITEM_NOT_FOUND);
    }
    const idSet = new Set(itemIds);
    let changed = false;
    for (const vendorGroup of this.vendorGroups) {
      for (const item of vendorGroup.items) {
        if (idSet.has(item.id) && !item.isDelivered) {
          item.markDelivered(deliveredBy);
          changed = true;
        }
      }
    }
    if (!changed) {
      throw new Error(OrderError.ORDER_ITEM_NOT_FOUND);
    }
    // Update vendor group status if all items delivered
    for (const vendorGroup of this.vendorGroups) {
      if (vendorGroup.items.length > 0 && vendorGroup.items.every(i => i.isDelivered)) {
        try {
          vendorGroup.updateStatus(OrderVendorGroupStatus.DELIVERED);
        } catch {
          // ignore invalid transition
        }
      }
    }
    this.updateOrderStatusFromVendorGroups();
    this.updatedAt = new Date();
  }

  private updateOrderStatusFromVendorGroups(): void {
    if (this.vendorGroups.length === 0) {
      return;
    }

    const statuses = this.vendorGroups.map(vg => vg.status);
    
    if (statuses.every(s => s === OrderVendorGroupStatus.DELIVERED)) {
      this.transitionTo(OrderStatus.DELIVERED);
    } else if (statuses.some(s => s === OrderVendorGroupStatus.SHIPPED) && 
               statuses.every(s => s === OrderVendorGroupStatus.SHIPPED || s === OrderVendorGroupStatus.DELIVERED)) {
      this.transitionTo(OrderStatus.SHIPPED);
    } else if (statuses.some(s => s === OrderVendorGroupStatus.PREPARING || s === OrderVendorGroupStatus.SHIPPED || s === OrderVendorGroupStatus.DELIVERED)) {
      this.transitionTo(OrderStatus.PROCESSING);
    } else if (statuses.every(s => s === OrderVendorGroupStatus.CANCELLED)) {
      this.transitionTo(OrderStatus.CANCELLED);
    }
  }

  transitionTo(newStatus: OrderStatus): void {
    if (this.status === newStatus) {
      return;
    }

    const allowedTransitions = VALID_STATUS_TRANSITIONS[this.status];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }

    this.status = newStatus;
    this.updatedAt = new Date();

    if (newStatus === OrderStatus.PAID) {
      this.financialStatus = FinancialStatus.PAID;
    } else if (newStatus === OrderStatus.CANCELLED && this.financialStatus === FinancialStatus.PAID) {
      this.financialStatus = FinancialStatus.FULLY_REFUNDED;
    }
  }

  canTransitionTo(status: OrderStatus): boolean {
    const allowedTransitions = VALID_STATUS_TRANSITIONS[this.status];
    return allowedTransitions.includes(status);
  }

  calculateTotals(): { totalAmount: number } {
    const totalAmount = this.vendorGroups.reduce((sum, vg) => sum + vg.subtotal, 0);
    return { totalAmount };
  }

  recalculateTotals(): void {
    this.vendorGroups.forEach(vg => vg.recalculateTotals());
    const totals = this.calculateTotals();
    this.totalAmount = totals.totalAmount;
    this.updatedAt = new Date();
  }

  updateShippingAddress(address: Address): void {
    this.shippingAddress = { ...address };
    this.updatedAt = new Date();
  }

  markPaymentFailed(): void {
    this.transitionTo(OrderStatus.FAILED_PAYMENT);
  }

  markPaymentAuthorized(): void {
    if (this.status === OrderStatus.PENDING_PAYMENT) {
      this.transitionTo(OrderStatus.PAID);
    }
  }

  refund(full: boolean = true): void {
    if (full) {
      this.financialStatus = FinancialStatus.FULLY_REFUNDED;
    } else {
      this.financialStatus = FinancialStatus.PARTIALLY_REFUNDED;
    }
    this.updatedAt = new Date();
  }

  addComment(personId: string, text: string): void {
    if (this.status !== OrderStatus.DELIVERED) {
      throw new Error(OrderError.ORDER_NOT_DELIVERED);
    }
    if (personId !== this.personId) {
      throw new Error(OrderError.FORBIDDEN);
    }
    if (this.comment !== undefined) {
      throw new Error(OrderError.ORDER_COMMENT_ALREADY_EXISTS);
    }
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > 1000) {
      throw new Error(OrderError.INVALID_COMMENT);
    }
    this.comment = text;
    this.commentedAt = new Date();
    this.commentedBy = personId;
    this.updatedAt = new Date();
  }

  getVendorGroupsWithoutTransfer(): OrderVendorGroup[] {
    return this.vendorGroups.filter(vg => !vg.transferId);
  }

  toJSON(): OrderData {
    return {
      id: this.id,
      personId: this.personId,
      status: this.status,
      vendorGroups: this.vendorGroups.map(vg => vg.toJSON()),
      shippingAddress: { ...this.shippingAddress },
      totalAmount: this.totalAmount,
      financialStatus: this.financialStatus,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      comment: this.comment,
      commentedAt: this.commentedAt,
      commentedBy: this.commentedBy
    };
  }
}

export class Payment {
  public readonly id: string;
  public readonly orderId: string;
  public readonly personId: string;
  public readonly amount: number;
  public status: PaymentStatus;
  public provider?: string;
  public providerTransactionId?: string;
  public authorizedAt?: Date;
  public capturedAt?: Date;
  public failedAt?: Date;
  public refundedAt?: Date;
  public readonly createdAt: Date;
  public updatedAt: Date;
  public readonly eventId?: string;
  public readonly originalEventId?: string;
  public readonly eventType?: string;
  public readonly eventSource?: string;
  public readonly eventTimestamp?: Date;

  private constructor(data: PaymentData) {
    this.id = data.id;
    this.orderId = data.orderId;
    this.personId = data.personId;
    this.amount = data.amount;
    this.status = data.status;
    this.provider = data.provider;
    this.providerTransactionId = data.providerTransactionId;
    this.authorizedAt = data.authorizedAt;
    this.capturedAt = data.capturedAt;
    this.failedAt = data.failedAt;
    this.refundedAt = data.refundedAt;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
    this.eventId = data.eventId;
    this.originalEventId = data.originalEventId;
    this.eventType = data.eventType;
    this.eventSource = data.eventSource;
    this.eventTimestamp = data.eventTimestamp;
  }

  static create(data: {
    orderId: string;
    personId: string;
    amount: number;
    provider?: string;
  }): Payment {
    if (!data.orderId || data.orderId.trim().length === 0) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }
    if (!data.personId || data.personId.trim().length === 0) {
      throw new Error(OrderError.PERSON_ID_REQUIRED);
    }
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error(OrderError.INVALID_AMOUNT);
    }

    const now = new Date();
    const eventId = generateId();

    return new Payment({
      id: generateId(),
      orderId: data.orderId,
      personId: data.personId,
      amount: data.amount,
      status: PaymentStatus.PENDING,
      provider: data.provider,
      createdAt: now,
      updatedAt: now,
      eventId: eventId,
      originalEventId: undefined,
      eventType: undefined,
      eventSource: "internal",
      eventTimestamp: now
    });
  }

  static reconstruct(data: PaymentData): Payment {
    return new Payment(data);
  }

  authorize(providerTransactionId: string): Payment {
    if (this.status !== PaymentStatus.PENDING) {
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }
    const now = new Date();
    this.status = PaymentStatus.AUTHORIZED;
    this.providerTransactionId = providerTransactionId;
    this.authorizedAt = now;
    this.updatedAt = now;
    return this;
  }

  capture(): Payment {
    if (this.status !== PaymentStatus.AUTHORIZED) {
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }
    const now = new Date();
    this.status = PaymentStatus.CAPTURED;
    this.capturedAt = now;
    this.updatedAt = now;
    return this;
  }

  fail(): Payment {
    if (this.status === PaymentStatus.CAPTURED || this.status === PaymentStatus.REFUNDED) {
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }
    const now = new Date();
    this.status = PaymentStatus.FAILED;
    this.failedAt = now;
    this.updatedAt = now;
    return this;
  }

  refund(): Payment {
    if (this.status !== PaymentStatus.CAPTURED) {
      throw new Error(OrderError.INVALID_STATUS_TRANSITION);
    }
    const now = new Date();
    this.status = PaymentStatus.REFUNDED;
    this.refundedAt = now;
    this.updatedAt = now;
    return this;
  }

  setProvider(provider: string): void {
    this.provider = provider;
    this.updatedAt = new Date();
  }

  toJSON(): PaymentData {
    return {
      id: this.id,
      orderId: this.orderId,
      personId: this.personId,
      amount: this.amount,
      status: this.status,
      provider: this.provider,
      providerTransactionId: this.providerTransactionId,
      authorizedAt: this.authorizedAt,
      capturedAt: this.capturedAt,
      failedAt: this.failedAt,
      refundedAt: this.refundedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      eventId: this.eventId,
      originalEventId: this.originalEventId,
      eventType: this.eventType,
      eventSource: this.eventSource,
      eventTimestamp: this.eventTimestamp
    };
  }
}

export interface OrderRepository {
  save(order: Order): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  findByPersonId(personId: string): Promise<Order[]>;
  findByStatus(status: OrderStatus): Promise<Order[]>;
  findAll(): Promise<Order[]>;
  findByCommentedBy?(personId: string): Promise<Order[]>;
  update(order: Order): Promise<Order>;
  delete(id: string): Promise<void>;
}

export class InMemoryOrderRepository implements OrderRepository {
  private orders: Map<string, Order> = new Map();
  private personIndex: Map<string, Set<string>> = new Map();
  private statusIndex: Map<OrderStatus, Set<string>> = new Map();

  async save(order: Order): Promise<Order> {
    this.orders.set(order.id, order);

    const personOrders = this.personIndex.get(order.personId) || new Set();
    personOrders.add(order.id);
    this.personIndex.set(order.personId, personOrders);

    const statusOrders = this.statusIndex.get(order.status) || new Set();
    statusOrders.add(order.id);
    this.statusIndex.set(order.status, statusOrders);

    return order;
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.get(id) || null;
  }

  async findByPersonId(personId: string): Promise<Order[]> {
    const orderIds = this.personIndex.get(personId) || new Set();
    const orders: Order[] = [];
    for (const id of orderIds) {
      const order = this.orders.get(id);
      if (order) orders.push(order);
    }
    return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findByStatus(status: OrderStatus): Promise<Order[]> {
    const orderIds = this.statusIndex.get(status) || new Set();
    const orders: Order[] = [];
    for (const id of orderIds) {
      const order = this.orders.get(id);
      if (order) orders.push(order);
    }
    return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findAll(): Promise<Order[]> {
    const orders: Order[] = [];
    for (const order of this.orders.values()) {
      orders.push(order);
    }
    return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findByCommentedBy(personId: string): Promise<Order[]> {
    const orders: Order[] = [];
    for (const order of this.orders.values()) {
      if (order.commentedBy === personId) orders.push(order);
    }
    return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async update(order: Order): Promise<Order> {
    const existing = this.orders.get(order.id);
    if (!existing) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }
    if (order.status === OrderStatus.PAID) {
      if (existing.status !== OrderStatus.PAID && existing.status !== OrderStatus.PENDING_PAYMENT) {
        throw new Error(OrderError.INVALID_STATUS_TRANSITION);
      }
    }
      const oldStatusOrders = this.statusIndex.get(existing.status);
      if (oldStatusOrders) {
        oldStatusOrders.delete(order.id);
      }
      const newStatusOrders = this.statusIndex.get(order.status) || new Set();
      newStatusOrders.add(order.id);
      this.statusIndex.set(order.status, newStatusOrders);

    if (existing.personId !== order.personId) {
      const oldPersonOrders = this.personIndex.get(existing.personId);
      if (oldPersonOrders) {
        oldPersonOrders.delete(order.id);
      }
      const newPersonOrders = this.personIndex.get(order.personId) || new Set();
      newPersonOrders.add(order.id);
      this.personIndex.set(order.personId, newPersonOrders);
    }

    this.orders.set(order.id, order);
    return order;
  }

  async delete(id: string): Promise<void> {
    const order = this.orders.get(id);
    if (order) {
      const personOrders = this.personIndex.get(order.personId);
      if (personOrders) {
        personOrders.delete(id);
      }
      const statusOrders = this.statusIndex.get(order.status);
      if (statusOrders) {
        statusOrders.delete(id);
      }
      this.orders.delete(id);
    }
  }

  clear(): void {
    this.orders.clear();
    this.personIndex.clear();
    this.statusIndex.clear();
  }
}

export interface PaymentRepository {
  save(payment: Payment): Promise<Payment>;
  findById(id: string): Promise<Payment | null>;
  findByOrderId(orderId: string): Promise<Payment[]>;
  findByPersonId(personId: string): Promise<Payment[]>;
  update(payment: Payment): Promise<Payment>;
  delete(id: string): Promise<void>;
}

export class InMemoryPaymentRepository implements PaymentRepository {
  private payments: Map<string, Payment> = new Map();
  private orderIndex: Map<string, Set<string>> = new Map();
  private personIndex: Map<string, Set<string>> = new Map();

  async save(payment: Payment): Promise<Payment> {
    this.payments.set(payment.id, payment);

    const orderPayments = this.orderIndex.get(payment.orderId) || new Set();
    orderPayments.add(payment.id);
    this.orderIndex.set(payment.orderId, orderPayments);

    const personPayments = this.personIndex.get(payment.personId) || new Set();
    personPayments.add(payment.id);
    this.personIndex.set(payment.personId, personPayments);

    return payment;
  }

  async findById(id: string): Promise<Payment | null> {
    return this.payments.get(id) || null;
  }

  async findByOrderId(orderId: string): Promise<Payment[]> {
    const paymentIds = this.orderIndex.get(orderId) || new Set();
    const payments: Payment[] = [];
    for (const id of paymentIds) {
      const payment = this.payments.get(id);
      if (payment) payments.push(payment);
    }
    return payments.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async findByOriginalEventId(originalEventId: string): Promise<Payment[]> {
    const payments: Payment[] = [];
    for (const payment of this.payments.values()) {
      if (payment.originalEventId === originalEventId) {
        payments.push(payment);
      }
    }
    return payments.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async findByPersonId(personId: string): Promise<Payment[]> {
    const paymentIds = this.personIndex.get(personId) || new Set();
    const payments: Payment[] = [];
    for (const id of paymentIds) {
      const payment = this.payments.get(id);
      if (payment) payments.push(payment);
    }
    return payments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async update(payment: Payment): Promise<Payment> {
    const existing = this.payments.get(payment.id);
    if (!existing) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }
    this.payments.set(payment.id, payment);
    return payment;
  }

  async delete(id: string): Promise<void> {
    const payment = this.payments.get(id);
    if (payment) {
      const orderPayments = this.orderIndex.get(payment.orderId);
      if (orderPayments) {
        orderPayments.delete(id);
      }
      const personPayments = this.personIndex.get(payment.personId);
      if (personPayments) {
        personPayments.delete(id);
      }
      this.payments.delete(id);
    }
  }

  clear(): void {
    this.payments.clear();
    this.orderIndex.clear();
    this.personIndex.clear();
  }
}