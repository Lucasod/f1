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

export const vendorApi = {
  async getMe(): Promise<{ vendor: Vendor }> {
    const response = await apiClient.get('/api/v1/vendor/me');
    return response.json();
  },

  async onboard(input: VendorOnboardInput): Promise<{ vendor: Vendor }> {
    const response = await apiClient.post('/api/v1/vendor/onboard', input);
    return response.json();
  },
};