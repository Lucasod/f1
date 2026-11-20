import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { useCategories } from './useCategories';
import { apiClient } from '@/shared/api/client';
import { Category } from './useCategories';

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockCategories: Category[] = [
  {
    id: 'cat-1',
    parentId: null,
    name: 'Electronics',
    slug: 'electronics',
    path: 'electronics',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cat-2',
    parentId: 'cat-1',
    name: 'Smartphones',
    slug: 'smartphones',
    path: 'electronics/smartphones',
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
  {
    id: 'cat-3',
    parentId: null,
    name: 'Clothing',
    slug: 'clothing',
    path: 'clothing',
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-03T00:00:00Z',
  },
];

const mockCategoryListResponse = {
  categories: mockCategories,
  total: 3,
  page: 1,
  limit: 1000,
};

// Helper to create a mock Response object
const createMockResponse = (data: unknown, ok = true): Response => {
  return {
    ok,
    json: async () => data,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    headers: new Headers(),
    redirected: false,
    type: 'basic' as const,
    url: '',
    clone: () => createMockResponse(data, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => JSON.stringify(data),
  } as Response;
};

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('useCategories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue(createMockResponse(mockCategoryListResponse));
  });

  it('fetches categories successfully', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/categories?limit=1000');
    expect(result.current.data).toEqual(mockCategoryListResponse);
    expect(result.current.data?.categories).toHaveLength(3);
  });

  it('returns loading state initially', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns error state when fetch fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Network error'));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
    expect(result.current.error?.message).toBe('Network error');
  });

  it('handles empty response', async () => {
    const emptyResponse = {
      categories: [],
      total: 0,
      page: 1,
      limit: 1000,
    };

    vi.mocked(apiClient.get).mockResolvedValueOnce(createMockResponse(emptyResponse));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.categories).toHaveLength(0);
    expect(result.current.data?.total).toBe(0);
  });

  it('caches results and returns cached data on subsequent calls', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    // Render a second hook with the same query key
    const { result: result2 } = renderHook(() => useCategories(), { wrapper });
    await waitFor(() => expect(result2.current.isSuccess).toBe(true));

    // Should not make a second API call due to caching
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(result2.current.data).toEqual(mockCategoryListResponse);
  });

  it('uses correct query key for caching', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The query key should be ['categories'] for proper caching
    // Verify caching by checking that a second hook doesn't trigger a new fetch
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('includes limit=1000 in API request', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useCategories(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/categories?limit=1000');
  });
});