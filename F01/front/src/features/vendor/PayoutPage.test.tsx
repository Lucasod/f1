import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
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

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
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
    mockList.mockResolvedValue({ payouts: [mockPayout] });
    mockCreate.mockResolvedValue({ payout: mockPayout });
    mockCancel.mockResolvedValue({ payout: { ...mockPayout, status: PayoutStatus.CANCELLED } });
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
});
