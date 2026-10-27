import { useQuery } from '@tanstack/react-query';
import { productApi, ProductListResponse, ProductListParams } from '@/shared/api/product';

export interface ProductFilterParams {
  categoryId?: string | null;
  search?: string;
  sortBy?: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'stock_status';
  page?: number;
  limit?: number;
}

function buildQueryParams(filters: ProductFilterParams & { status: string; page: number; limit: number }): ProductListParams {
  const params: ProductListParams = {
    status: filters.status,
    page: filters.page,
    limit: filters.limit,
  };
  
  if (filters.categoryId) params.categoryId = filters.categoryId;
  if (filters.search) params.search = filters.search;
  if (filters.sortBy) params.sortBy = filters.sortBy;
  
  return params;
}

export function useProducts(filters: ProductFilterParams = {}) {
  const {
    categoryId,
    search,
    sortBy = 'newest',
    page = 1,
    limit = 20,
  } = filters;

  return useQuery<ProductListResponse, Error>({
    queryKey: ['products', { categoryId, search, sortBy, page, limit }],
    queryFn: () =>
      productApi.list(buildQueryParams({
        status: 'active',
        categoryId,
        search,
        sortBy,
        page,
        limit,
      })),
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: (previousData) => previousData,
  });
}