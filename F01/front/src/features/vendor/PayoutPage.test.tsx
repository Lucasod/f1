import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useAuthStore } from '@/app/providers/authStore';
import { payoutApi, Payout, PayoutStatus } from '@/shared/api/payout';
import { PayoutPage } from './PayoutPage';

vi.mock('@/shared/api/payout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/payout')>();
  return {
    ...actual,
    payoutApi: {
      list: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      cancel: vi.fn(),
    },
  };
});

const mockList = vi.mocked(payoutApi.list);
const mockCreate = vi.mocked(payoutApi.create);
const mockCancel = vi.mocked(payoutApi.cancel);

const mockPayout: Payout = {
  id: 'payout-1',
  vendorId: 'vendor-1',
  personId: 'person-1',
  amount: 100,
  status: PayoutStatus.PENDING,
  requestedAt: '2024-01-15T10:00:00Z',
  bankAccount: 'ACC-123',
  reference: 'REF-1',
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T10:00:00Z',
};

const createWrapper = (queryClient?: QueryClient) => {
  const client = queryClient ?? new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return Wrapper;
};

describe('PayoutPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: { id: 'vendor-1', name: 'Vendor One', email: 'vendor@example.com', roles: ['VENDOR'] },
      accessToken: 'access',
      refreshToken: 'refresh',
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    mockList.mockResolvedValue({ payouts: [mockPayout] });
    mockCreate.mockResolvedValue({ payout: mockPayout });
    mockCancel.mockResolvedValue({ payout: { ...mockPayout, status: PayoutStatus.CANCELLED } });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isLoading: false, error: null });
  });

  it('renders payout list', async () => {
    render(<PayoutPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('payout-1')).toBeInTheDocument());
    expect(screen.getByText(/100,00/)).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows empty state', async () => {
    mockList.mockResolvedValueOnce({ payouts: [] });

    render(<PayoutPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText(/no payouts yet/i)).toBeInTheDocument());
  });

  it('shows error state with retry', async () => {
    mockList.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({ payouts: [mockPayout] });

    render(<PayoutPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument());
    const retryButton = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText('payout-1')).toBeInTheDocument());
  });

  it('request payout form submits correctly', async () => {
    mockList.mockResolvedValue({ payouts: [] });

    render(<PayoutPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const amountInput = screen.getByLabelText(/amount/i);
    const bankInput = screen.getByLabelText(/bank account/i);
    const refInput = screen.getByLabelText(/reference/i);

    fireEvent.change(amountInput, { target: { value: '250' } });
    fireEvent.change(bankInput, { target: { value: 'BANK-9' } });
    fireEvent.change(refInput, { target: { value: 'REF-9' } });

    const submitButton = screen.getByRole('button', { name: /request payout/i });
    fireEvent.click(submitButton);

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        amount: 250,
        bankAccount: 'BANK-9',
        reference: 'REF-9',
      })
    );
  });

  it('cancel button calls cancel API', async () => {
    render(<PayoutPage />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('payout-1')).toBeInTheDocument());

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('payout-1'));
  });

  it('AC2: uses identity-scoped payouts query key and not the old identity-free key', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    render(<PayoutPage />, { wrapper: createWrapper(queryClient) });

    await waitFor(() => expect(screen.getByText('payout-1')).toBeInTheDocument());

    expect(queryClient.getQueryData(['payouts', 'vendor-1'])).toEqual({ payouts: [mockPayout] });
    expect(queryClient.getQueryData(['payouts'])).toBeUndefined();
  });

  it('L-001: isolates payouts cache when authenticated identity switches', async () => {
    const payoutsA = { payouts: [{ ...mockPayout, id: 'payout-a', vendorId: 'vendor-a' }] };
    const payoutsB = { payouts: [{ ...mockPayout, id: 'payout-b', vendorId: 'vendor-b' }] };
    let resolvePayoutsB: ((response: { payouts: Payout[] }) => void) | undefined;
    const pendingPayoutsB = new Promise<{ payouts: Payout[] }>((resolve) => {
      resolvePayoutsB = resolve;
    });
    mockList.mockResolvedValueOnce(payoutsA).mockReturnValueOnce(pendingPayoutsB);

    useAuthStore.setState({
      user: { id: 'vendor-a', name: 'Vendor A', email: 'a@example.com', roles: ['VENDOR'] },
      accessToken: 'access',
      refreshToken: 'refresh',
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
    });
    render(<PayoutPage />, { wrapper: createWrapper(queryClient) });

    await waitFor(() => expect(screen.getByText('payout-a')).toBeInTheDocument());
    expect(queryClient.getQueryData(['payouts', 'vendor-a'])).toEqual(payoutsA);

    act(() => {
      useAuthStore.setState((state) => ({
        ...state,
        user: { id: 'vendor-b', name: 'Vendor B', email: 'b@example.com', roles: ['VENDOR'] },
      }));
    });

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryData(['payouts', 'vendor-a'])).toEqual(payoutsA);

    await act(async () => {
      resolvePayoutsB?.(payoutsB);
      await pendingPayoutsB;
    });

    await waitFor(() => expect(screen.getByText('payout-b')).toBeInTheDocument());
    expect(queryClient.getQueryData(['payouts', 'vendor-b'])).toEqual(payoutsB);
  });
});
