import { apiClient } from './client';
import type { Order } from './order';

export interface CheckoutPreviewItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface CheckoutPreviewVendorGroup {
  id: string;
  vendorName: string;
  subtotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorNet: number;
  items: CheckoutPreviewItem[];
}

export interface CheckoutPreviewResponse {
  vendorGroups: CheckoutPreviewVendorGroup[];
  totalAmount: number;
}

export interface CheckoutInput {
  shippingAddressId: string;
  couponCodes?: string[];
}

export interface CheckoutResponse {
  order: Order;
  clientSecret: string;
}

/**
 * Custom error class for checkout API errors that preserves HTTP status and error code.
 * Allows callers to handle different error types (401, 403, 404, 5xx) appropriately.
 */
export class CheckoutApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'CheckoutApiException';
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new CheckoutApiException(
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
      if (Array.isArray(value)) {
        value.forEach(v => searchParams.append(key, String(v)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });
  return searchParams.toString();
}

export const checkoutApi = {
  /**
   * Preview checkout totals with optional coupon codes
   */
  async preview(couponCodes?: string[]): Promise<CheckoutPreviewResponse> {
    const query = buildQueryString({ couponCodes });
    const response = await apiClient.get(`/api/v1/checkout/preview?${query}`);
    return handleResponse<CheckoutPreviewResponse>(response);
  },

  /**
   * Create order from cart with shipping address and optional coupon codes
   */
  async checkout(input: CheckoutInput): Promise<CheckoutResponse> {
    const response = await apiClient.post('/api/v1/checkout', input);
    return handleResponse<CheckoutResponse>(response);
  },
};