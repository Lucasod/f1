import { apiClient } from './client';

export interface CartItem {
  productId: string;
  vendorId: string;
  quantity: number;
  unitPrice: number;
  addedAt: string;
}

export interface Cart {
  id: string;
  items: CartItem[];
  version: number;
  updatedAt: string;
}

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface CartQuantityUpdate {
  quantity: number;
}

export interface MergeGuestCartInput {
  guestCartId: string;
}

/**
 * Custom error class for cart API errors that preserves HTTP status and error code.
 * Allows callers to handle different error types (401, 403, 404, 5xx) appropriately.
 */
export class CartApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'CartApiException';
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new CartApiException(
      errorData.message || `API error: ${response.status}`,
      response.status,
      errorData.error
    );
  }
  return response.json();
}

export const cartApi = {
  /**
   * Get the current user's cart
   */
  async getCart(): Promise<{ cart: Cart }> {
    const response = await apiClient.get('/api/v1/cart');
    return handleResponse<{ cart: Cart }>(response);
  },

  /**
   * Add an item to the cart
   */
  async addItem(input: CartItemInput): Promise<{ cart: Cart }> {
    const response = await apiClient.post('/api/v1/cart/items', input);
    return handleResponse<{ cart: Cart }>(response);
  },

  /**
   * Update the quantity of an item in the cart
   */
  async updateItemQuantity(productId: string, input: CartQuantityUpdate): Promise<{ cart: Cart }> {
    const response = await apiClient.patch(`/api/v1/cart/items/${productId}`, input);
    return handleResponse<{ cart: Cart }>(response);
  },

  /**
   * Remove an item from the cart
   */
  async removeItem(productId: string): Promise<{ cart: Cart }> {
    const response = await apiClient.delete(`/api/v1/cart/items/${productId}`);
    return handleResponse<{ cart: Cart }>(response);
  },

  /**
   * Merge a guest cart into the current user's cart
   */
  async mergeGuestCart(input: MergeGuestCartInput): Promise<{ cart: Cart }> {
    const response = await apiClient.post('/api/v1/cart/merge-guest', input);
    return handleResponse<{ cart: Cart }>(response);
  },
};