import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateReviewForm from './CreateReviewForm';
import { reviewApi } from '@/shared/api/review';
import React from 'react';

vi.mock('@/shared/api/review', () => ({
  reviewApi: {
    createReview: vi.fn(),
    addReviewImage: vi.fn(),
    listProductReviews: vi.fn(),
  },
  ReviewStatus: { PUBLISHED: 'published', HIDDEN: 'hidden', REJECTED: 'rejected' },
}));

const mockAuthState = {
  isAuthenticated: true,
  hasRole: (role: string) => role === 'CONSUMER',
};

vi.mock('@/app/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockAuthState,
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('CreateReviewForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.isAuthenticated = true;
    mockAuthState.hasRole = (role: string) => role === 'CONSUMER';
  });

  it('renders rating, order item, comment and submit button', () => {
    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });
    expect(screen.getByLabelText(/rating/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/order/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/comment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit review/i })).toBeInTheDocument();
  });

  it('shows login prompt when not authenticated', () => {
    mockAuthState.isAuthenticated = false;
    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });
    expect(screen.getByText(/log in/i)).toBeInTheDocument();
  });

  it('submits review successfully', async () => {
    vi.mocked(reviewApi.createReview).mockResolvedValueOnce({
      id: 'rev-1',
      productId: 'prod-1',
      consumerId: 'user-1',
      orderItemId: 'item-1',
      orderId: 'item-1',
      rating: 4,
      comment: 'Nice',
      images: [],
      status: 'published',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as any);

    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText(/order/i), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText(/rating/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/comment/i), { target: { value: 'Nice' } });
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() =>
      expect(reviewApi.createReview).toHaveBeenCalledWith({
        productId: 'prod-1',
        orderId: 'item-1',
        rating: 4,
        comment: 'Nice',
      })
    );
    await waitFor(() => expect(screen.getByText(/review submitted successfully/i)).toBeInTheDocument());
  });

  it('shows eligibility error on 403', async () => {
    const err = new Error('forbidden');
    (err as any).status = 403;
    vi.mocked(reviewApi.createReview).mockRejectedValueOnce(err);

    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText(/order/i), { target: { value: 'item-1' } });
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => expect(screen.getByText(/eligible/i)).toBeInTheDocument());
  });

  it('shows already reviewed error on 409', async () => {
    const err = new Error('conflict');
    (err as any).status = 409;
    vi.mocked(reviewApi.createReview).mockRejectedValueOnce(err);

    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText(/order/i), { target: { value: 'item-1' } });
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => expect(screen.getByText(/already been reviewed/i)).toBeInTheDocument());
  });

  it('shows login error on 401', async () => {
    const err = new Error('unauth');
    (err as any).status = 401;
    vi.mocked(reviewApi.createReview).mockRejectedValueOnce(err);

    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText(/order/i), { target: { value: 'item-1' } });
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => expect(screen.getByText(/please log in/i)).toBeInTheDocument());
  });

  it('shows server error on 5xx', async () => {
    const err = new Error('server');
    (err as any).status = 500;
    vi.mocked(reviewApi.createReview).mockRejectedValueOnce(err);

    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText(/order/i), { target: { value: 'item-1' } });
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => expect(screen.getByText(/server error/i)).toBeInTheDocument());
  });

  it('uploads image after review creation', async () => {
    vi.mocked(reviewApi.createReview).mockResolvedValueOnce({
      id: 'rev-1',
      productId: 'prod-1',
      consumerId: 'user-1',
      orderItemId: 'item-1',
      orderId: 'item-1',
      rating: 5,
      comment: null,
      images: [],
      status: 'published',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    } as any);
    vi.mocked(reviewApi.addReviewImage).mockResolvedValueOnce({
      review: {
        id: 'rev-1',
        productId: 'prod-1',
        consumerId: 'user-1',
        orderItemId: 'item-1',
        rating: 5,
        comment: null,
        images: ['reviews/prod-1/rev-1/img.png'],
        status: 'published',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    } as any);

    render(<CreateReviewForm productId="prod-1" />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByLabelText(/order/i), { target: { value: 'item-1' } });
    fireEvent.click(screen.getByRole('button', { name: /submit review/i }));

    await waitFor(() => expect(screen.getByLabelText(/add photo/i)).toBeInTheDocument());

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    const input = screen.getByLabelText(/add photo/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(reviewApi.addReviewImage).toHaveBeenCalledWith('rev-1', file));
  });
});
