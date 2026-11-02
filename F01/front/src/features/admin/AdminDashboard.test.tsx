import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Order, orderApi } from '@/shared/api/order';
import { Review, ReviewStatus, reviewApi } from '@/shared/api/review';
import { AdminDashboard } from './AdminDashboard';

vi.mock('@/shared/api/order', async importOriginal => {
  const original = await importOriginal<typeof import('@/shared/api/order')>();
  return {
    ...original,
    orderApi: {
      ...original.orderApi,
      list: vi.fn(),
    },
  };
});

vi.mock('@/shared/api/review', async importOriginal => {
  const original = await importOriginal<typeof import('@/shared/api/review')>();
  return {
    ...original,
    reviewApi: {
      ...original.reviewApi,
      listAdminReviews: vi.fn(),
      moderateReview: vi.fn(),
    },
  };
});

const mockListOrders = vi.mocked(orderApi.list);
const mockListAdminReviews = vi.mocked(reviewApi.listAdminReviews);
const mockModerateReview = vi.mocked(reviewApi.moderateReview);

const order: Order = {
  id: 'order-123',
  personId: 'consumer-123',
  status: 'paid',
  vendorGroups: [],
  shippingAddress: {
    id: 'address-123',
    street: 'Rua Exemplo',
    number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    isPrimary: true,
  },
  totalAmount: 125.5,
  financialStatus: 'paid',
  createdAt: '2026-10-28T10:00:00.000Z',
  updatedAt: '2026-10-28T10:00:00.000Z',
};


const review: Review = {
  id: 'review-123',
  productId: 'product-123',
  consumerId: 'consumer-123',
  orderItemId: 'item-123',
  rating: 4,
  comment: 'Great product',
  images: [],
  status: ReviewStatus.PUBLISHED,
  createdAt: '2026-10-28T10:00:00.000Z',
  updatedAt: '2026-10-28T10:00:00.000Z',
};

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AdminDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListOrders.mockResolvedValue({ orders: [], total: 0, page: 1, limit: 10 });
    mockListAdminReviews.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    mockModerateReview.mockResolvedValue({ review });
  });

  it('shows recent orders returned by the Admin order API', async () => {
    mockListOrders.mockResolvedValue({
      orders: [order],
      total: 1,
      page: 1,
      limit: 10,
    });

    renderDashboard();

    expect(await screen.findByText('order-123')).toBeInTheDocument();
    expect(screen.getByText('paid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view order order-123/i })).toHaveAttribute('href', '/orders/order-123');
  });

  it('shows an explicit empty state when there are no orders', async () => {
    mockListOrders.mockResolvedValue({
      orders: [],
      total: 0,
      page: 1,
      limit: 10,
    });

    renderDashboard();

    expect(await screen.findByText(/no marketplace orders yet/i)).toBeInTheDocument();
  });

  it('shows API errors and lets the Admin retry', async () => {
    mockListOrders
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce({ orders: [order], total: 1, page: 1, limit: 10 });

    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByText('order-123')).toBeInTheDocument();
  });

  it('shows reviews returned by the Admin review API', async () => {
    mockListAdminReviews.mockResolvedValue({
      items: [review],
      total: 1,
      page: 1,
      limit: 20,
    });

    renderDashboard();

    expect(await screen.findByText('Great product')).toBeInTheDocument();
    expect(screen.getByText(/4\/5/i)).toBeInTheDocument();
    expect(screen.getByText(/status: published/i)).toBeInTheDocument();
  });

  it('shows an explicit empty state when there are no reviews', async () => {
    mockListAdminReviews.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    renderDashboard();

    expect(await screen.findByText(/no reviews to moderate/i)).toBeInTheDocument();
  });

  it('shows review API errors and lets the Admin retry', async () => {
    mockListAdminReviews
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce({ items: [review], total: 1, page: 1, limit: 20 });

    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Great product')).toBeInTheDocument();
  });

  it('calls moderateReview with correct status when Publish/Hide/Reject clicked', async () => {
    mockListAdminReviews.mockResolvedValue({
      items: [review],
      total: 1,
      page: 1,
      limit: 20,
    });

    renderDashboard();

    await screen.findByText('Great product');

    fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    await waitFor(() => expect(mockModerateReview).toHaveBeenCalledWith(review.id, 'published'));

    fireEvent.click(screen.getByRole('button', { name: /hide/i }));
    await waitFor(() => expect(mockModerateReview).toHaveBeenCalledWith(review.id, 'hidden'));

    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    await waitFor(() => expect(mockModerateReview).toHaveBeenCalledWith(review.id, 'rejected'));
  });

  it('shows moderation error when moderateReview fails', async () => {
    mockListAdminReviews.mockResolvedValue({
      items: [review],
      total: 1,
      page: 1,
      limit: 20,
    });
    mockModerateReview.mockRejectedValue(new Error('Moderation failed'));

    renderDashboard();

    await screen.findByText('Great product');

    fireEvent.click(screen.getByRole('button', { name: /publish/i }));

    expect(await screen.findByText(/unable to moderate review/i)).toBeInTheDocument();
    expect(await screen.findByText(/moderation failed/i)).toBeInTheDocument();
  });

});
