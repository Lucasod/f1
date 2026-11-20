import { apiClient } from './client';

export enum PayoutStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface Payout {
  id: string;
  vendorId: string;
  personId: string;
  amount: number;
  status: PayoutStatus;
  requestedAt: string;
  processedAt?: string;
  failureReason?: string;
  reference?: string;
  bankAccount?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePayoutInput {
  amount: number;
  bankAccount?: string;
  reference?: string;
}

export interface PayoutListResponse {
  payouts: Payout[];
}

export interface PayoutResponse {
  payout: Payout;
}

/**
 * Custom error class for payout API errors that preserves HTTP status and error code.
 */
export class PayoutApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PayoutApiException';
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new PayoutApiException(
      errorData.message || `API error: ${response.status}`,
      response.status,
      errorData.error
    );
  }
  return response.json();
}

export const payoutApi = {
  async list(): Promise<PayoutListResponse> {
    const response = await apiClient.get('/api/v1/payouts');
    return handleResponse<PayoutListResponse>(response);
  },

  async getById(id: string): Promise<PayoutResponse> {
    const response = await apiClient.get(`/api/v1/payouts/${id}`);
    return handleResponse<PayoutResponse>(response);
  },

  async create(input: CreatePayoutInput): Promise<PayoutResponse> {
    const response = await apiClient.post('/api/v1/payouts', input);
    return handleResponse<PayoutResponse>(response);
  },

  async cancel(id: string): Promise<PayoutResponse> {
    const response = await apiClient.patch(`/api/v1/payouts/${id}/cancel`, {});
    return handleResponse<PayoutResponse>(response);
  },
};
