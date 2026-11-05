import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { OrderReviewSection } from './OrderReviewSection';
import { reviewApi } from '@/shared/api/review';

vi.mock('@/shared/api/review', () => ({
  reviewApi: {
    createReview: vi.fn(),
    addReviewImage: vi.fn(),
    listProductReviews: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const deliveredOrder = {
  id: 'order-1',
  status: 'delivered',
  vendorGroups: [
    {
      id: 'ovg-1',
      orderId: 'order-1',
      vendorId: 'vendor-1',
      status: 'delivered',
      items: [{ id: 'item-1', productId: 'prod-1', productName: 'Product 1', vendorId: 'vendor-1', quantity: 1, unitPrice: 10, totalPrice: 10 }],
      subtotal: 10,
      commissionPct: 15,
      commissionAmount: 1.5,
      vendorNet: 8.5,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
};

describe('OrderReviewSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reviewApi.createReview).mockResolvedValue({
      id: 'rev-1',
      productId: 'prod-1',
      consumerId: 'user-1',
      orderId: 'order-1',
      rating: 5,
      comment: undefined,
      images: [],
      status: 'published',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as any);
  });

  it('shows Write Review button for delivered order', () => {
    render(<OrderReviewSection order={deliveredOrder as any} />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: /write review/i })).toBeInTheDocument();
  });

  it('does not render for non-delivered order', () => {
    const paid = { ...deliveredOrder, status: 'paid' };
    const { container } = render(<OrderReviewSection order={paid as any} />, { wrapper: createWrapper() });
    expect(container).toBeEmptyDOMElement();
  });

  it('submits review with orderId', async () => {
    render(<OrderReviewSection order={deliveredOrder as any} />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: /write review/i }));

    fireEvent.change(screen.getByLabelText(/rating/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/comment/i), { target: { value: 'Nice' } });
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() =>
      expect(reviewApi.createReview).toHaveBeenCalledWith({
        productId: 'prod-1',
        orderId: 'order-1',
        rating: 4,
        comment: 'Nice',
      })
    );
    await waitFor(() => expect(screen.getByText(/reviewed/i)).toBeInTheDocument());
  });

  it('respects canReview false', () => {
    const { container } = render(<OrderReviewSection order={deliveredOrder as any} canReview={false} />, { wrapper: createWrapper() });
    expect(container).toBeEmptyDOMElement();
  });
});
