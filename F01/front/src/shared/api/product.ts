import { apiClient } from './client';

export interface Product {
  id: string;
  vendorId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  status: 'active' | 'inactive' | 'out_of_stock' | 'discontinued';
  images: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  products: Product[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductListParams {
  catalog?: boolean;
  status?: string;
  vendorId?: string;
  categoryId?: string;
  search?: string;
  sortBy?: string;
  page?: number;
  limit?: number;
}

export interface CreateProductInput {
  categoryId: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  images?: string[];
  status?: Product['status'];
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  price?: number;
  quantity?: number;
  categoryId?: string;
  images?: string[];
  status?: Product['status'];
}

export interface UploadImageResponse {
  image?: { key: string; url: string };
  images?: Array<{ key: string; url: string }>;
  error?: string;
}

export const productApi = {
  async list(filters?: ProductListParams): Promise<ProductListResponse> {
    const params = new URLSearchParams();
    if (filters?.catalog) params.append('catalog', 'true');
    if (filters?.status) params.append('status', filters.status);
    if (filters?.vendorId) params.append('vendorId', filters.vendorId);
    if (filters?.categoryId) params.append('categoryId', filters.categoryId);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.sortBy) params.append('sortBy', filters.sortBy);
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());
    
    const response = await apiClient.get(`/api/v1/products?${params.toString()}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'LIST_FAILED');
    }
    return response.json();
  },

  async getById(productId: string): Promise<{ product: Product }> {
    const response = await apiClient.get(`/api/v1/products/${productId}`);
    return response.json();
  },

  async getMyProducts(): Promise<{ products: Product[] }> {
    const response = await apiClient.get('/api/v1/products/vendor/me');
    return response.json();
  },

  async create(input: CreateProductInput): Promise<{ product: Product }> {
    const response = await apiClient.post('/api/v1/products', input);
    return response.json();
  },

  async update(productId: string, input: UpdateProductInput): Promise<{ product: Product }> {
    const response = await apiClient.patch(`/api/v1/products/${productId}`, input);
    return response.json();
  },

  async delete(productId: string): Promise<void> {
    const response = await apiClient.delete(`/api/v1/products/${productId}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'DELETE_FAILED');
    }
  },

  async uploadImage(productId: string, file: File): Promise<{ image: { key: string; url: string } }> {
    const formData = new FormData();
    formData.append('image', file);
    
    const response = await fetch(`/api/v1/products/${productId}/images`, {
      method: 'POST',
      headers: apiClient.getAuthHeaders(),
      body: formData,
    });
    
    const data: UploadImageResponse = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'UPLOAD_FAILED');
    }
    // Backward compatibility: return single image format
    return { image: data.image || data.images?.[0]! };
  },

  async uploadImages(productId: string, files: File[]): Promise<{ images: Array<{ key: string; url: string }> }> {
    const formData = new FormData();
    files.forEach(file => formData.append('images', file));
    
    const response = await fetch(`/api/v1/products/${productId}/images`, {
      method: 'POST',
      headers: apiClient.getAuthHeaders(),
      body: formData,
    });
    
    const data: UploadImageResponse = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'UPLOAD_FAILED');
    }
    return { images: data.images || (data.image ? [data.image] : []) };
  },

  async deleteImage(productId: string, imageKey: string): Promise<void> {
    const response = await apiClient.delete(`/api/v1/products/${productId}/images/${imageKey}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'DELETE_IMAGE_FAILED');
    }
  },
};
