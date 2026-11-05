import { apiClient } from './client';

export interface Address {
  id: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary: boolean;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export type OrderVendorGroupStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'failed_payment';

export interface OrderVendorGroup {
  id: string;
  orderId: string;
  vendorId: string;
  status: OrderVendorGroupStatus;
  items: OrderItem[];
  subtotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorNet: number;
  transferId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  personId: string;
  status: OrderStatus;
  vendorGroups: OrderVendorGroup[];
  shippingAddress: Address;
  totalAmount: number;
  financialStatus: string;
  createdAt: string;
  updatedAt: string;
  comment?: string;
  commentedAt?: string;
  commentedBy?: string;
}

export interface OrderListResponse {
  orders: Order[];
  total: number;
  page: number;
  limit: number;
}

export interface ConsumerOrderSummary {
  totalOrders: number;
  totalSpent: number;
  pendingOrders: number;
  deliveredOrders: number;
  recentOrders: Order[];
}

export interface OrderListParams {
  status?: OrderStatus;
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface OrderStatusUpdate {
  status: OrderVendorGroupStatus | OrderStatus;
}

export interface VendorOrderGroupsParams {
  status?: OrderVendorGroupStatus;
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface VendorOrderGroupsResponse {
  vendorGroups: OrderVendorGroup[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Custom error class for order API errors that preserves HTTP status and error code.
 * Allows callers to handle different error types (401, 403, 404, 5xx) appropriately.
 */
export class OrderApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OrderApiException';
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new OrderApiException(
      errorData.message || `API error: ${response.status}`,
      response.status,
      errorData.error
    );
  }
  return response.json();
}

function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  });
  return searchParams.toString();
}

export const orderApi = {
  /**
   * List orders for the current user
   */
  async list(params?: OrderListParams): Promise<OrderListResponse> {
    const query = buildQueryString(params || {});
    const response = await apiClient.get(`/api/v1/orders?${query}`);
    return handleResponse<OrderListResponse>(response);
  },

  async getConsumerSummary(): Promise<{ summary: ConsumerOrderSummary }> {
    const response = await apiClient.get('/api/v1/orders/summary');
    return handleResponse<{ summary: ConsumerOrderSummary }>(response);
  },

  /**
   * Get order details by ID
   */
  async getById(orderId: string): Promise<{ order: Order }> {
    const response = await apiClient.get(`/api/v1/orders/${orderId}`);
    return handleResponse<{ order: Order }>(response);
  },

  /**
   * Update vendor group status within an order
   */
  async updateVendorGroupStatus(
    orderId: string,
    ovgId: string,
    status: OrderVendorGroupStatus
  ): Promise<{ vendorGroup: OrderVendorGroup }> {
    const response = await apiClient.patch(
      `/api/v1/orders/${orderId}/vendor-groups/${ovgId}/status`,
      { status }
    );
    return handleResponse<{ vendorGroup: OrderVendorGroup }>(response);
  },

  /**
   * Update order status (ADMIN only)
   */
  async updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<{ order: Order }> {
    const response = await apiClient.patch(
      `/api/v1/orders/${orderId}/status`,
      { status }
    );
    return handleResponse<{ order: Order }>(response);
  },

  /**
   * Get vendor's order groups
   */
  async getVendorOrderGroups(
    params?: VendorOrderGroupsParams
  ): Promise<VendorOrderGroupsResponse> {
    const query = buildQueryString(params || {});
    const response = await apiClient.get(`/api/v1/vendor/orders?${query}`);
    return handleResponse<VendorOrderGroupsResponse>(response);
  },

  /**
   * Add a comment to a delivered order (consumer owner only)
   */
  async addOrderComment(orderId: string, comment: string): Promise<Order> {
    const response = await apiClient.post(`/api/v1/orders/${orderId}/comment`, { comment });
    const data = await handleResponse<{ order: Order }>(response);
    return data.order;
  },
};