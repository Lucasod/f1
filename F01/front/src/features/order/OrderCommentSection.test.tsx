import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Order } from '@/shared/api/order';
import React from 'react';

const { mockUseAuth } = vi.hoisted(() => ({
  mockUseAuth: {
    user: { id: 'user-1', name: 'Test User', email: 'test@test.com', roles: ['CONSUMER'] },
    isAuthenticated: true,
    isLoading: false,
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshAccessToken: vi.fn(),
    hasRole: vi.fn((role: string) => role === 'CONSUMER'),
    clearError: vi.fn(),
    initializeAuth: vi.fn(),
  },
}));

vi.mock('@/app/providers/AuthProvider', async () => {
  const actual = await vi.importActual('@/app/providers/AuthProvider');
  return { ...actual, useAuth: () => mockUseAuth };
});

vi.mock('@/shared/api/order', () => ({
  orderApi: {
    getById: vi.fn(),
    updateVendorGroupStatus: vi.fn(),
    updateOrderStatus: vi.fn(),
    addOrderComment: vi.fn(),
  },
}));

import { OrderCommentSection } from './OrderCommentSection';
import { orderApi } from '@/shared/api/order';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const deliveredOrder: Order = {
  id: 'order-1',
  personId: 'user-1',
  status: 'delivered',
  vendorGroups: [],
  shippingAddress: { id: 'a', street: 's', number: '1', neighborhood: 'n', city: 'c', state: 'SP', isPrimary: true },
  totalAmount: 10,
  financialStatus: 'paid',
  createdAt: '2024-01-01T10:30:00Z',
  updatedAt: '2024-01-01T10:30:00Z',
};

describe('OrderCommentSection', () => {
  beforeEach(() => {
    vi.mocked(orderApi.addOrderComment).mockReset();
  });

  it('renders comment form when order is delivered and no comment exists', async () => {
    render(<OrderCommentSection order={deliveredOrder} />, { wrapper: createWrapper() });
    expect(screen.getByTestId('order-comment-form')).toBeInTheDocument();
    expect(screen.getByTestId('order-comment-textarea')).toBeInTheDocument();
    expect(screen.getByTestId('order-comment-submit')).toBeInTheDocument();
  });

  it('does not render when order is not delivered', () => {
    const paidOrder = { ...deliveredOrder, status: 'paid' as Order['status'] };
    const { container } = render(<OrderCommentSection order={paidOrder} />, { wrapper: createWrapper() });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows existing comment as read-only', () => {
    const commented = { ...deliveredOrder, comment: 'Great order', commentedAt: '2024-01-02T10:00:00Z' };
    render(<OrderCommentSection order={commented} />, { wrapper: createWrapper() });
    expect(screen.getByTestId('order-comment-display')).toBeInTheDocument();
    expect(screen.getByText('Great order')).toBeInTheDocument();
    expect(screen.queryByTestId('order-comment-form')).not.toBeInTheDocument();
  });

  it('submits comment successfully', async () => {
    vi.mocked(orderApi.addOrderComment).mockResolvedValue({ ...deliveredOrder, comment: 'Nice!', commentedAt: '2024-01-02T10:00:00Z' });
    render(<OrderCommentSection order={deliveredOrder} />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByTestId('order-comment-textarea'), { target: { value: 'Nice!' } });
    fireEvent.click(screen.getByTestId('order-comment-submit'));

    await waitFor(() => expect(orderApi.addOrderComment).toHaveBeenCalledWith('order-1', 'Nice!'));
    await waitFor(() => expect(screen.getByText('Nice!')).toBeInTheDocument());
  });

  it('shows error on 409 (already commented)', async () => {
    const err: any = new Error('Comment already exists');
    err.status = 409;
    vi.mocked(orderApi.addOrderComment).mockRejectedValue(err);
    render(<OrderCommentSection order={deliveredOrder} />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByTestId('order-comment-textarea'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('order-comment-submit'));

    await waitFor(() => expect(screen.getByText(/already commented/i)).toBeInTheDocument());
  });

  it('shows error on 422 (not delivered)', async () => {
    const err: any = new Error('Order not delivered');
    err.status = 422;
    vi.mocked(orderApi.addOrderComment).mockRejectedValue(err);
    render(<OrderCommentSection order={deliveredOrder} />, { wrapper: createWrapper() });

    fireEvent.change(screen.getByTestId('order-comment-textarea'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByTestId('order-comment-submit'));

    await waitFor(() => expect(screen.getByText(/not delivered/i)).toBeInTheDocument());
  });
});
