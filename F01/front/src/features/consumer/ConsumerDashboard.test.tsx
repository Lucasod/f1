import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { orderApi } from '@/shared/api/order';
import { ConsumerDashboard } from './ConsumerDashboard';

vi.mock('@/shared/api/order', () => ({
  orderApi: {
    getConsumerSummary: vi.fn(),
  },
}));

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({ hasRole: () => false }),
}));

describe('ConsumerDashboard', () => {
  it('renders purchase metrics from the consumer summary API', async () => {
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
