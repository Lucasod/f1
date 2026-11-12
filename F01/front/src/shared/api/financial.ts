import { apiClient } from './client';

export interface FinancialHistoryEntry {
  id: string;
  eventType: string;
  movementType: string;
  amount: number;
  currency: string;
  effectiveAt: string;
  recordedAt: string;
  relatedEntityId: string;
  relatedEntityType: 'payment' | 'transfer' | 'payout' | 'invoice';
  orderId?: string;
  vendorId: string;
}

export interface FinancialDashboard {
  grossSales: number;
  grossSalesLabel: string;
  netExpectedAmount: number;
  receivedInStripe: number;
  pendingDistribution: number;
  bankPayout: number;
  history: FinancialHistoryEntry[];
}

export class FinancialApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'FinancialApiException';
    this.status = status;
    this.code = code;
  }
}

export const financialApi = {
  async getVendorDashboard(
    periodStart?: Date,
    periodEnd?: Date
  ): Promise<FinancialDashboard> {
    const params = new URLSearchParams();
    if (periodStart) params.append('periodStart', periodStart.toISOString());
    if (periodEnd) params.append('periodEnd', periodEnd.toISOString());
    const query = params.toString();
    const url = `/api/v1/financial/vendor-dashboard${query ? `?${query}` : ''}`;

    const response = await apiClient.get(url);
    return response.json();
  },
};
