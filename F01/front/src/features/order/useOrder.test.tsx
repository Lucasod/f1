import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/app/providers/authStore';
import { OrderListResponse, orderApi } from '@/shared/api/order';
import { useOrders } from './useOrder';

describe('useOrders cache isolation', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
    vi.restoreAllMocks();
  });

  it('does not expose a previous user’s cached orders when the authenticated identity changes', async () => {
    const adminOrders: OrderListResponse = {
      orders: [],
      total: 5,
      page: 1,
      limit: 10,
    };
    const consumerOrders: OrderListResponse = {
      orders: [],
      total: 0,
      page: 1,
      limit: 10,
    };

    useAuthStore.setState({
      user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com', roles: ['ADMIN'] },
      isAuthenticated: true,
    });

    let resolveConsumerOrders: ((response: OrderListResponse) => void) | undefined;
    const pendingConsumerOrders = new Promise<OrderListResponse>(resolve => {
      resolveConsumerOrders = resolve;
    });
    vi.spyOn(orderApi, 'list')
      .mockResolvedValueOnce(adminOrders)
      .mockReturnValueOnce(pendingConsumerOrders);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useOrders({ page: 1, limit: 10 }), { wrapper });

    await waitFor(() => expect(result.current.data?.total).toBe(5));

    act(() => {
      useAuthStore.setState({
        user: { id: 'consumer-1', name: 'Consumer', email: 'consumer@example.com', roles: ['CONSUMER'] },
        isAuthenticated: true,
      });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.data).toBeUndefined();

    await act(async () => {
      resolveConsumerOrders?.(consumerOrders);
      await pendingConsumerOrders;
    });

    await waitFor(() => expect(result.current.data?.total).toBe(0));
    expect(orderApi.list).toHaveBeenCalledTimes(2);
  });
});
