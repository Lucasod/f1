import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReviewSection from './ReviewSection';
import { reviewApi } from '@/shared/api/review';
import React from 'react';

vi.mock('@/shared/api/review', () => ({
  reviewApi: {
    listProductReviews: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('ReviewSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    let resolvePromise: (value: unknown) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    vi.mocked(reviewApi.listProductReviews).mockReturnValue(promise as any);

    render(<ReviewSection productId="prod-1" />, { wrapper: createWrapper() });
    expect(screen.getByText(/loading reviews/i)).toBeInTheDocument();

    resolvePromise!({ items: [], total: 0, page: 1, limit: 10, averageRating: null });
  });

  it('shows error state with retry button', async () => {
    vi.mocked(reviewApi.listProductReviews).mockRejectedValueOnce(new Error('Network error'));

    render(<ReviewSection productId="prod-1" />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText(/failed to load reviews/i)).toBeInTheDocument());
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows empty state when no reviews', async () => {
    vi.mocked(reviewApi.listProductReviews).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      averageRating: null,
    } as any);

    render(<ReviewSection productId="prod-1" />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText(/no reviews yet/i)).toBeInTheDocument());
  });

  it('renders reviews with rating and comment', async () => {
    vi.mocked(reviewApi.listProductReviews).mockResolvedValueOnce({
      items: [
        {
          id: 'rev-1',
          productId: 'prod-1',
          consumerId: 'user-1',
          orderItemId: 'item-1',
          rating: 5,
          comment: 'Great product',
          images: [],
          status: 'published',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      averageRating: 5,
    } as any);

    render(<ReviewSection productId="prod-1" />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('5/5')).toBeInTheDocument());
    expect(screen.getByText('Great product')).toBeInTheDocument();
    expect(screen.getByText(/1 reviews/i)).toBeInTheDocument();
  });

  it('renders review images', async () => {
    vi.mocked(reviewApi.listProductReviews).mockResolvedValueOnce({
      items: [
        {
          id: 'rev-1',
          productId: 'prod-1',
          consumerId: 'user-1',
          orderItemId: 'item-1',
          rating: 4,
          comment: null,
          images: ['http://example.com/img.png'],
          status: 'published',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      averageRating: 4,
    } as any);

    render(<ReviewSection productId="prod-1" />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByAltText(/review image/i)).toBeInTheDocument());
  });
});
