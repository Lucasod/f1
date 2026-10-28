import { apiClient } from './client';

export interface Vendor {
  id: string;
  personId: string;
  storeName: string;
  slug: string;
  status: 'active' | 'suspended' | 'pending';
  createdAt: string;
  updatedAt: string;
}

export interface VendorOnboardInput {
  storeName: string;
  slug: string;
}

export interface VendorApiError extends Error {
  status: number;
  code?: string;
}

/**
 * Custom error class for vendor API errors that preserves HTTP status and error code.
 * Allows callers to handle different error types (401, 403, 404, 5xx) appropriately.
 */
export class VendorApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'VendorApiException';
    this.status = status;
    this.code = code;
  }
}

export const vendorApi = {
  async getMe(): Promise<{ vendor: Vendor }> {
    const response = await apiClient.get('/api/v1/vendor/me');
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new VendorApiException(
        errorData.message || `API error: ${response.status}`,
        response.status,
        errorData.error
      );
    }
    
    return response.json();
  },

  async onboard(input: VendorOnboardInput): Promise<{ vendor: Vendor }> {
    const response = await apiClient.post('/api/v1/vendor/onboard', input);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new VendorApiException(
        errorData.message || `API error: ${response.status}`,
        response.status,
        errorData.error
      );
    }
    
    return response.json();
  },
};