import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

interface CategoryListResponse {
  categories: Category[];
  total: number;
  page: number;
  limit: number;
}

export function useCategories() {
  return useQuery<CategoryListResponse, Error>({
    queryKey: ['categories'],
    queryFn: async () => {
      // Using limit=1000 to fetch all categories in a single request.
      // Assumption: category count will not exceed 1000 in the foreseeable future.
      // If this assumption is violated, pagination should be implemented.
      const response = await apiClient.get('/api/v1/categories?limit=1000');
      if (!response.ok) {
        throw new Error(`Failed to fetch categories: ${response.status} ${response.statusText}`);
      }
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}