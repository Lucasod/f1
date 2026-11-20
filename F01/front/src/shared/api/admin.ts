import { apiClient } from './client';

export interface AdminMetrics {
  orders: number;
  vendors: number;
  products: number;
}

export const adminApi = {
  async getMetrics(): Promise<AdminMetrics> {
    const response = await apiClient.get('/api/v1/admin/metrics');
    if (!response.ok) throw new Error('Unable to load registered totals');
    return response.json();
  },
};
