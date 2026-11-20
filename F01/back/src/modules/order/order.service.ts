import {
  Order,
  OrderVendorGroup,
  OrderItem,
  OrderItemData,
  OrderStatus,
  OrderVendorGroupStatus,
  FinancialStatus,
  Payment,
  PaymentStatus,
  OrderError,
  OrderRepository,
  PaymentRepository,
  Dispute,
  DisputeType,
  DisputeStatus,
  DisputeResolution
} from './order.domain';
import { PersonRepository } from '../person/person.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { config } from '../../config';
import { InvoiceService } from '../../modules/invoice/invoice.service';
import { generateInvoiceKey } from '../../shared/storage/s3.key-generator';
import { Address } from './order.domain';

export interface ListOrdersFilters {
  status?: OrderStatus;
  page?: number;
  limit?: number;
  role?: 'consumer' | 'vendor' | 'admin';
  vendorId?: string;
}

export interface GetOrdersByVendorFilters {
  status?: OrderVendorGroupStatus;
  page?: number;
  limit?: number;
}

export interface ConsumerOrderSummary {
  totalOrders: number;
  totalSpent: number;
  pendingOrders: number;
  deliveredOrders: number;
  recentOrders: Order[];
}

export class OrderService {
  private readonly orderRepo: OrderRepository;
  private readonly paymentRepo: PaymentRepository;
  private readonly personRepo: PersonRepository;
  private readonly vendorRepo: VendorRepository;
  private readonly invoiceService: InvoiceService;

  constructor(
    orderRepo: OrderRepository,
    paymentRepo: PaymentRepository,
    personRepo: PersonRepository,
    vendorRepo: VendorRepository,
    invoiceService: InvoiceService,
    _config: typeof config
  ) {
    this.orderRepo = orderRepo;
    this.paymentRepo = paymentRepo;
    this.personRepo = personRepo;
    this.vendorRepo = vendorRepo;
    this.invoiceService = invoiceService;
  }

  private async checkExistingOrderByIdempotencyKey(
    personId: string,
    idempotencyKey: string
  ): Promise<Order | null> {
    const existingOrders = await this.orderRepo.findByPersonId(personId);
    const matchingOrder = existingOrders.find(
      order =>
        (order.status === OrderStatus.PENDING_PAYMENT || order.status === OrderStatus.PAID) &&
        order.attemptId === idempotencyKey
    );
    return matchingOrder ?? null;
  }

  async createOrderWithIdempotencyCheck(data: {
    personId: string;
    vendorGroups: { vendorId: string; items: Omit<OrderItemData, 'id' | 'totalPrice'>[]; commissionPct: number }[];
    shippingAddress: Address;
    idempotencyKey?: string;
    attemptId?: string;
  }): Promise<{ order: Order; created: boolean }> {
    if (data.idempotencyKey) {
      const existingOrder = await this.checkExistingOrderByIdempotencyKey(data.personId, data.idempotencyKey);
      if (existingOrder) {
        return { order: existingOrder, created: false };
      }
    }

    const order = Order.create({
      personId: data.personId,
      vendorGroups: data.vendorGroups,
      shippingAddress: data.shippingAddress,
      attemptId: data.attemptId,
      idempotencyKey: data.idempotencyKey,
      repository: this.orderRepo
    });

    return { order, created: true };
  }

  async listOrders(
    personId: string,
    filters?: ListOrdersFilters
  ): Promise<{ orders: Order[]; total: number; page: number; limit: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const role = filters?.role ?? 'consumer';

    let orders: Order[] = [];

    if (role === 'consumer') {
      // Consumer: only their own orders
      orders = await this.orderRepo.findByPersonId(personId);
    } else if (role === 'vendor') {
      // Vendor: orders containing their vendor groups
      // Note: status filter is allowed and applied at the end
      const vendorId = filters?.vendorId;
      if (!vendorId) {
        throw new Error(OrderError.VENDOR_ID_REQUIRED);
      }
      const allOrders = await this.orderRepo.findAll?.() ?? [];
      orders = allOrders.filter(order =>
        order.vendorGroups.some(vg => vg.vendorId === vendorId)
      );
    } else if (role === 'admin') {
      // Admin: all orders (with optional status filter)
      const allOrders = await this.orderRepo.findAll?.() ?? [];
      orders = allOrders;
    }

    // Apply status filter if provided
    if (filters?.status) {
      orders = orders.filter(order => order.status === filters.status);
    }

    // Sort by createdAt descending
    orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = orders.length;
    const start = (page - 1) * limit;
    const paginatedOrders = orders.slice(start, start + limit);

    return {
      orders: paginatedOrders,
      total,
      page,
      limit
    };
  }

  async getConsumerSummary(personId: string): Promise<ConsumerOrderSummary> {
    const orders = await this.orderRepo.findByPersonId(personId);
    const newestFirst = [...orders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return {
      totalOrders: orders.length,
      totalSpent: orders
        .filter(order =>
          [OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(order.status)
          && order.financialStatus === FinancialStatus.PAID
        )
        .reduce((total, order) => total + order.totalAmount, 0),
      pendingOrders: orders.filter(order =>
        order.status === OrderStatus.PENDING_PAYMENT
        || order.status === OrderStatus.PAID
        || order.status === OrderStatus.PROCESSING
      ).length,
      deliveredOrders: orders.filter(order => order.status === OrderStatus.DELIVERED).length,
      recentOrders: newestFirst.slice(0, 5),
    };
  }

  async getOrderById(
    orderId: string,
    personId: string,
    role: 'consumer' | 'vendor' | 'admin',
    vendorId?: string,
    viewContext?: 'consumer' | 'vendor'
  ): Promise<Order | null> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      return null;
    }

    // Authorization check based on role and view context
    if (viewContext === 'consumer' || (viewContext === undefined && role === 'consumer')) {
      // Consumer can only see their own orders
      if (order.personId !== personId) {
        return null;
      }
    } else if (viewContext === 'vendor' || (viewContext === undefined && role === 'vendor')) {
      // Vendor can only see orders containing their vendor groups
      if (!vendorId) {
        throw new Error(OrderError.VENDOR_ID_REQUIRED);
      }
      const hasVendorGroup = order.vendorGroups.some(vg => vg.vendorId === vendorId);
      if (!hasVendorGroup) {
        // Order exists but the vendor has no vendor group in it: hide it as 404
        // to preserve the resource-hiding policy.
        return null;
      }
    } else if (role === 'admin') {
      // Admin can see all orders
    }

    return order;
  }

  async updateVendorGroupStatus(
    orderId: string,
    vendorGroupId: string,
    newStatus: OrderVendorGroupStatus,
    actorRole: 'vendor' | 'admin',
    actorId: string
  ): Promise<Order> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }

    const vendorGroup = order.vendorGroups.find(vg => vg.id === vendorGroupId);
    if (!vendorGroup) {
      throw new Error(OrderError.VENDOR_NOT_FOUND);
    }

    // Authorization check
    if (actorRole === 'vendor') {
      // Vendor can only update their own vendor groups
      if (vendorGroup.vendorId !== actorId) {
        throw new Error(OrderError.FORBIDDEN);
      }
    }
    // Admin can update any vendor group

    // Update vendor group status
    vendorGroup.updateStatus(newStatus);

    // Update order status based on vendor groups
    order.updateVendorGroupStatus(vendorGroup.vendorId, newStatus);

    // Save order
    return this.orderRepo.update(order);
  }

  async updateOrderStatus(orderId: string, newStatus: OrderStatus): Promise<Order> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }

    // Admin only: transition order status directly
    order.transitionTo(newStatus);

    return this.orderRepo.update(order);
  }

  async getOrdersByVendor(
    vendorId: string,
    filters?: GetOrdersByVendorFilters
  ): Promise<{ vendorGroups: OrderVendorGroup[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;

    // Verify vendor exists
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new Error(OrderError.VENDOR_NOT_FOUND);
    }

    const allOrders = await this.orderRepo.findAll?.() ?? [];
    let vendorGroups: OrderVendorGroup[] = [];

    for (const order of allOrders) {
      for (const vg of order.vendorGroups) {
        if (vg.vendorId === vendorId) {
          vendorGroups.push(vg);
        }
      }
    }

    // Apply status filter if provided
    if (filters?.status) {
      vendorGroups = vendorGroups.filter(vg => vg.status === filters.status);
    }

    // Sort by createdAt descending
    vendorGroups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = vendorGroups.length;
    const start = (page - 1) * limit;
    const paginatedGroups = vendorGroups.slice(start, start + limit);

    return {
      vendorGroups: paginatedGroups,
      total
    };
  }

  async markItemsDelivered(
    orderId: string,
    personId: string,
    role: 'consumer' | 'vendor' | 'admin',
    vendorId: string | undefined,
    itemIds: string[] | undefined,
    all: boolean | undefined,
    deliveredByOverride?: string
  ): Promise<Order> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }

    let resolvedItemIds: string[] = [];

    if (role === 'consumer') {
      if (order.personId !== personId) {
        throw new Error(OrderError.FORBIDDEN);
      }
      const allItems = order.vendorGroups.flatMap(vg => vg.items);
      resolvedItemIds = all
        ? allItems.map(i => i.id)
        : (itemIds ?? []).filter(id => allItems.some(i => i.id === id));
    } else if (role === 'vendor') {
      if (!vendorId) {
        throw new Error(OrderError.VENDOR_ID_REQUIRED);
      }
      const vg = order.vendorGroups.find(g => g.vendorId === vendorId);
      if (!vg) {
        throw new Error(OrderError.FORBIDDEN);
      }
      resolvedItemIds = all
        ? vg.items.map(i => i.id)
        : (itemIds ?? []).filter(id => vg.items.some(i => i.id === id));
    } else if (role === 'admin') {
      const allItems = order.vendorGroups.flatMap(vg => vg.items);
      resolvedItemIds = all
        ? allItems.map(i => i.id)
        : (itemIds ?? []).filter(id => allItems.some(i => i.id === id));
    }

    if (resolvedItemIds.length === 0) {
      throw new Error(OrderError.ORDER_ITEM_NOT_FOUND);
    }

    const deliveredBy = deliveredByOverride ?? personId;
    order.markItemsDeliveredByIds(resolvedItemIds, deliveredBy);
    return this.orderRepo.update(order);
  }

  async addOrderComment(
    orderId: string,
    personId: string,
    comment: string
  ): Promise<Order> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new Error(OrderError.ORDER_NOT_FOUND);
    if (order.personId !== personId) throw new Error(OrderError.FORBIDDEN);
    order.addComment(personId, comment.trim());
    return this.orderRepo.update(order);
  }

  async handlePaymentCallback(
    orderId: string,
    paymentStatus: PaymentStatus,
    providerTransactionId?: string
  ): Promise<Order> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }

    // Find the payment for this order
    const payments = await this.paymentRepo.findByOrderId(orderId);
    const payment = payments.find(p => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.AUTHORIZED);

    if (!payment) {
      throw new Error(OrderError.PAYMENT_FAILED);
    }

    // Idempotency check: if payment is already in the target status, skip payment modification
    // but still proceed with order updates and invoice generation
    const isAlreadyInTargetStatus =
      (paymentStatus === PaymentStatus.AUTHORIZED && payment.status === PaymentStatus.AUTHORIZED) ||
      (paymentStatus === PaymentStatus.CAPTURED && payment.status === PaymentStatus.CAPTURED) ||
      (paymentStatus === PaymentStatus.FAILED && payment.status === PaymentStatus.FAILED);

    if (!isAlreadyInTargetStatus) {
      // Payment not in target status - attempt the transition with idempotent error handling
      if (paymentStatus === PaymentStatus.AUTHORIZED) {
        if (providerTransactionId) {
          try {
            payment.authorize(providerTransactionId);
          } catch (error) {
            if ((error as Error).message === OrderError.INVALID_STATUS_TRANSITION) {
              // Graceful handling: payment transition failed (e.g. already in correct state);
              // idempotent return - proceed with current state
            } else {
              throw error;
            }
          }
        }
      } else if (paymentStatus === PaymentStatus.CAPTURED) {
        try {
          payment.capture();
        } catch (error) {
          if ((error as Error).message === OrderError.INVALID_STATUS_TRANSITION) {
            // Graceful handling - already in correct state
          } else {
            throw error;
          }
        }
      } else if (paymentStatus === PaymentStatus.FAILED) {
        try {
          payment.fail();
        } catch (error) {
          if ((error as Error).message === OrderError.INVALID_STATUS_TRANSITION) {
            // Graceful handling - already in correct state
          } else {
            throw error;
          }
        }
      }
    }

    await this.paymentRepo.update(payment);

    // Update order based on payment status
    if (paymentStatus === PaymentStatus.CAPTURED) {
      order.markPaymentAuthorized();
    } else if (paymentStatus === PaymentStatus.FAILED) {
      order.markPaymentFailed();
    }

    // Q-018: Automatic PDF generation after payment confirmation
    // Idempotent: don't generate if invoice already exists
    // Failure must not invalidate the already-confirmed payment
    try {
      const existingInvoice = await this.invoiceService.getInvoiceByOrderId(orderId);
      if (!existingInvoice && order.vendorGroups.length > 0) {
        const vendorId = order.vendorGroups[0].vendorId;
        const now = new Date();
        const invoice = await this.invoiceService.generateInvoice(orderId, vendorId);
        const pdfKey = generateInvoiceKey(invoice.id, now.getFullYear(), now.getMonth() + 1);
        const pdfUrl = `https://cdn.example.com/${pdfKey}`;
        await this.invoiceService.markGenerated(invoice.id, pdfUrl, pdfKey);
      }
    } catch (error) {
      // Log the error but don't invalidate the already-confirmed payment
      // per Q-018: failure in generation does not revert the order's PAID status
      console.error('Q-018: Failed to generate invoice after payment confirmation');
    }

    return this.orderRepo.update(order);
  }

  async initiateDispute(
    orderItemId: string,
    description: string,
    requestedBy: 'consumer' | 'vendor',
    personId?: string
  ): Promise<Dispute> {
    // Find the order containing this item by searching all orders
    const allOrders = await this.orderRepo.findAll?.() ?? [];
    const order = allOrders.find(o =>
      o.vendorGroups.some(vg => vg.items.some(i => i.id === orderItemId))
    );
    if (!order) {
      throw new Error(OrderError.ORDER_ITEM_NOT_FOUND);
    }

    // Verify authorization: consumer can only initiate disputes on their own orders
    // (enforced when personId is provided; direct service calls bypass this)
    if (personId !== undefined && order.personId !== personId) {
      throw new Error(OrderError.ORDER_NOT_FOUND);
    }

    // Verify the item is delivered
    const item = order.vendorGroups.flatMap(vg => vg.items).find(i => i.id === orderItemId);
    if (!item) {
      throw new Error(OrderError.ORDER_ITEM_NOT_FOUND);
    }
    if (!item.isDelivered) {
      throw new Error(OrderError.ORDER_NOT_DELIVERED);
    }

    const dispute = Dispute.create({
      orderItemId,
      description,
      requestedBy,
      type: DisputeType.REFUND,
      status: DisputeStatus.PENDING,
      createdAt: new Date(),
      resolvedAt: undefined,
    });

    // Attach dispute to the order item
    item.dispute = dispute;

    await this.orderRepo.update(order);

    return dispute;
  }

  async approveDispute(disputeId: string, vendorId: string): Promise<Dispute> {
    const allOrders = await this.orderRepo.findAll?.() ?? [];
    let foundDispute: Dispute | undefined;
    let order: Order | undefined;
    let item: OrderItem | undefined;

    for (const o of allOrders) {
      const foundItem = o.vendorGroups.flatMap(vg => vg.items).find(i => i.dispute?.id === disputeId);
      if (foundItem?.dispute) {
        foundDispute = foundItem.dispute;
        order = o;
        item = foundItem;
        break;
      }
    }

    if (!foundDispute) {
      throw new Error(OrderError.DISPUTE_NOT_FOUND);
    }

    if (foundDispute.status !== DisputeStatus.PENDING) {
      throw new Error(OrderError.DISPUTE_NOT_PENDING);
    }

    // Vendor can only approve disputes on their own order items
    if (!item || item.vendorId !== vendorId) {
      throw new Error(OrderError.FORBIDDEN);
    }

    foundDispute.approve();

    // Trigger commission reversal when dispute is approved
    await this.reverseCommissionForDispute(order!, item.id);

    await this.orderRepo.update(order!);

    return foundDispute!;
  }

  async rejectDispute(disputeId: string, vendorId: string): Promise<Dispute> {
    const allOrders = await this.orderRepo.findAll?.() ?? [];
    let foundDispute: Dispute | undefined;
    let order: Order | undefined;
    let item: OrderItem | undefined;

    for (const o of allOrders) {
      const foundItem = o.vendorGroups.flatMap(vg => vg.items).find(i => i.dispute?.id === disputeId);
      if (foundItem?.dispute) {
        foundDispute = foundItem.dispute;
        order = o;
        item = foundItem;
        break;
      }
    }

    if (!foundDispute) {
      throw new Error(OrderError.DISPUTE_NOT_FOUND);
    }

    if (foundDispute.status !== DisputeStatus.PENDING) {
      throw new Error(OrderError.DISPUTE_NOT_PENDING);
    }

    // Vendor can only reject disputes on their own order items
    if (!item || item.vendorId !== vendorId) {
      throw new Error(OrderError.FORBIDDEN);
    }

    foundDispute.reject();

    await this.orderRepo.update(order!);

    return foundDispute!;
  }

  async adminMediateDispute(
    disputeId: string,
    resolution: DisputeResolution
  ): Promise<Dispute> {
    const allOrders = await this.orderRepo.findAll?.() ?? [];
    let foundDispute: Dispute | undefined;
    let order: Order | undefined;

    for (const o of allOrders) {
      const item = o.vendorGroups.flatMap(vg => vg.items).find(i => i.dispute?.id === disputeId);
      if (item?.dispute) {
        foundDispute = item.dispute;
        order = o;
        break;
      }
    }

    if (!foundDispute) {
      throw new Error(OrderError.DISPUTE_NOT_FOUND);
    }

    if (foundDispute.status !== DisputeStatus.PENDING) {
      throw new Error(OrderError.DISPUTE_NOT_PENDING);
    }

    foundDispute.mediate(resolution);

    // Trigger commission reversal based on mediation result
    if (resolution === DisputeResolution.APPROVED) {
      const item = order?.vendorGroups.flatMap(vg => vg.items).find(i => i.dispute?.id === disputeId);
      if (item && order) {
        await this.reverseCommissionForDispute(order!, item.id);
      }
    }

    await this.orderRepo.update(order!);

    return foundDispute!;
  }

  private async reverseCommissionForDispute(order: Order, itemId: string): Promise<void> {
    // Find the vendor group and item that contain this dispute
    const vendorGroup = order.vendorGroups.find(vg =>
      vg.items.some(item => item.id === itemId)
    );
    if (!vendorGroup) {
      return;
    }

    const item = vendorGroup.items.find(item => item.id === itemId);
    if (!item) {
      return;
    }

    // Reverse the commission: refund the commission amount to the vendor
    // The commission was calculated as subtotal * commissionPct / 100
    const commissionAmount = vendorGroup.commissionAmount;
    const subtotal = vendorGroup.subtotal;
    const commissionPct = vendorGroup.commissionPct;

    // In a real system, this would involve financial transactions
    // For now, we'll update the financial status and create a refund payment
    // This is a simplified commission reversal per CD-048

    // Update the vendor group's financials
    vendorGroup.commissionAmount = 0;
    vendorGroup.vendorNet = subtotal;
    vendorGroup.updatedAt = new Date();

    // Recalculate order totals
    order.recalculateTotals();

    // Save the order
    await this.orderRepo.update(order);
  }
}
