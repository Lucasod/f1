import {
  Order,
  OrderVendorGroup,
  OrderItem,
  OrderStatus,
  OrderVendorGroupStatus,
  FinancialStatus,
  Payment,
  PaymentStatus,
  OrderError,
  OrderRepository,
  PaymentRepository
} from './order.domain';
import { PersonRepository } from '../person/person.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { config } from '../../config';

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

  constructor(
    orderRepo: OrderRepository,
    paymentRepo: PaymentRepository,
    personRepo: PersonRepository,
    vendorRepo: VendorRepository,
    _config: typeof config
  ) {
    this.orderRepo = orderRepo;
    this.paymentRepo = paymentRepo;
    this.personRepo = personRepo;
    this.vendorRepo = vendorRepo;
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
    vendorId?: string
  ): Promise<Order | null> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      return null;
    }

    // Authorization check based on role
    if (role === 'consumer') {
      // Consumer can only see their own orders
      if (order.personId !== personId) {
        return null;
      }
    } else if (role === 'vendor') {
      // Vendor can only see orders containing their vendor groups
      if (!vendorId) {
        throw new Error(OrderError.VENDOR_ID_REQUIRED);
      }
      const hasVendorGroup = order.vendorGroups.some(vg => vg.vendorId === vendorId);
      if (!hasVendorGroup) {
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

    // Update payment status
    if (paymentStatus === PaymentStatus.AUTHORIZED) {
      if (providerTransactionId) {
        payment.authorize(providerTransactionId);
      }
    } else if (paymentStatus === PaymentStatus.CAPTURED) {
      payment.capture();
    } else if (paymentStatus === PaymentStatus.FAILED) {
      payment.fail();
    }

    await this.paymentRepo.update(payment);

    // Update order based on payment status
    if (paymentStatus === PaymentStatus.CAPTURED) {
      order.markPaymentAuthorized();
    } else if (paymentStatus === PaymentStatus.FAILED) {
      order.markPaymentFailed();
    }

    return this.orderRepo.update(order);
  }
}