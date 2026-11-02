import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { orderApi } from '@/shared/api/order';
import { ConsumerDashboard } from './ConsumerDashboard';

const authState = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string; roles: Array<'CONSUMER'> } | null,
}));

vi.mock('@/shared/api/order', () => ({
  orderApi: {
    getConsumerSummary: vi.fn(),
  },
}));

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user, hasRole: () => false }),
}));

describe('ConsumerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not reuse another Consumer’s cached order summary after an identity change', async () => {
    authState.user = {
      id: 'consumer-1',
      name: 'Consumer One',
      email: 'one@example.com',
      roles: ['CONSUMER'],
    };
    vi.mocked(orderApi.getConsumerSummary).mockResolvedValueOnce({
      summary: {
        totalOrders: 12,
        totalSpent: 1234.56,
        pendingOrders: 2,
        deliveredOrders: 4,
        recentOrders: [],
      },
    });

    let resolveSecondSummary: ((value: { summary: {
      totalOrders: number;
      totalSpent: number;
      pendingOrders: number;
      deliveredOrders: number;
      recentOrders: [];
    } }) => void) | undefined;
    const pendingSecondSummary = new Promise<{ summary: {
      totalOrders: number;
      totalSpent: number;
      pendingOrders: number;
      deliveredOrders: number;
      recentOrders: [];
    } }>(resolve => {
      resolveSecondSummary = resolve;
    });
    vi.mocked(orderApi.getConsumerSummary).mockReturnValueOnce(pendingSecondSummary);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConsumerDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('12')).toBeInTheDocument();

    authState.user = {
      id: 'consumer-2',
      name: 'Consumer Two',
      email: 'two@example.com',
      roles: ['CONSUMER'],
    };
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConsumerDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(orderApi.getConsumerSummary).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveSecondSummary?.({
        summary: {
          totalOrders: 0,
          totalSpent: 0,
          pendingOrders: 0,
          deliveredOrders: 0,
          recentOrders: [],
        },
      });
      await pendingSecondSummary;
    });
    expect(await screen.findAllByText('0')).toHaveLength(3);
  });

  it('renders purchase metrics from the consumer summary API', async () => {
    authState.user = {
      id: 'consumer-1',
      name: 'Consumer One',
      email: 'one@example.com',
      roles: ['CONSUMER'],
    };
    vi.mocked(orderApi.getConsumerSummary).mockResolvedValueOnce({
      summary: {
        totalOrders: 12,
        totalSpent: 1234.56,
        pendingOrders: 2,
        deliveredOrders: 4,
        recentOrders: [],
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ConsumerDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/1\.234,56/)).toBeInTheDocument();
    expect(orderApi.getConsumerSummary).toHaveBeenCalledOnce();
  });
});
