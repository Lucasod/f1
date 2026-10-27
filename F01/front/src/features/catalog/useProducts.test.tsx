import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { useProducts } from './useProducts';
import { productApi } from '@/shared/api/product';
import { ProductListResponse } from '@/shared/api/product';

vi.mock('@/shared/api/product', () => ({
  productApi: {
    list: vi.fn(),
  },
}));

const mockProductListResponse: ProductListResponse = {
  products: [
    {
      id: 'prod-1',
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
      name: 'Product 1',
      description: 'Description 1',
      price: 10.00,
      quantity: 5,
      status: 'active',
      images: ['products/vendor-1/prod-1/main.jpg'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'prod-2',
      vendorId: 'vendor-1',
      categoryId: 'cat-2',
      name: 'Product 2',
      description: 'Description 2',
      price: 20.00,
      quantity: 0,
      status: 'out_of_stock',
      images: [],
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
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

describe('useProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(productApi.list).mockResolvedValue(mockProductListResponse);
  });

  it('fetches products with default parameters', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(productApi.list).toHaveBeenCalledWith({
      status: 'active',
      page: 1,
      limit: 20,
      sortBy: 'newest',
    });
    expect(result.current.data).toEqual(mockProductListResponse);
  });

  it('fetches products with custom filters', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      ({ filters }) => useProducts(filters),
      { wrapper, initialProps: { filters: { categoryId: 'cat-1', page: 2 } } }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(productApi.list).toHaveBeenCalledWith({
      status: 'active',
      categoryId: 'cat-1',
      page: 2,
      limit: 20,
      sortBy: 'newest',
    });
  });

  it('includes search query in filters', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      ({ filters }) => useProducts(filters),
      { wrapper, initialProps: { filters: { search: 'laptop' } } }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(productApi.list).toHaveBeenCalledWith({
      status: 'active',
      search: 'laptop',
      page: 1,
      limit: 20,
      sortBy: 'newest',
    });
  });

  it('includes sort parameter in filters', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProducts({ sortBy: 'price_desc' }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(productApi.list).toHaveBeenCalledWith({
      status: 'active',
      sortBy: 'price_desc',
      page: 1,
      limit: 20,
    });
  });

  it('returns loading state initially', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProducts(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('returns error state when fetch fails', async () => {
    vi.mocked(productApi.list).mockRejectedValueOnce(new Error('Network error'));
    
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeDefined();
    expect(result.current.error?.message).toBe('Network error');
  });

  it('provides refetch function', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    
    vi.mocked(productApi.list).mockResolvedValueOnce({
      ...mockProductListResponse,
      products: [{ ...mockProductListResponse.products[0], name: 'Updated Product' }],
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(productApi.list).toHaveBeenCalledTimes(2);
  });

  it('caches results and returns cached data on subsequent calls', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProducts(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productApi.list).toHaveBeenCalledTimes(1);

    const { result: result2 } = renderHook(() => useProducts(), { wrapper });
    await waitFor(() => expect(result2.current.isSuccess).toBe(true));
    expect(productApi.list).toHaveBeenCalledTimes(1);
  });

  it('refetches when filters change', async () => {
    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ filters }) => useProducts(filters),
      { wrapper, initialProps: { filters: {} } }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productApi.list).toHaveBeenCalledTimes(1);

    rerender({ filters: { categoryId: 'cat-2' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productApi.list).toHaveBeenCalledTimes(2);
  });
});