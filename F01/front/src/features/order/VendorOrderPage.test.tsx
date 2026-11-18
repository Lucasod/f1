import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { orderApi, OrderVendorGroup, VendorOrderGroupsResponse } from '@/shared/api/order';
import { AuthProvider } from '@/app/providers/AuthProvider';
import React from 'react';

// Mock orderApi
vi.mock('@/shared/api/order', () => ({
  orderApi: {
    list: vi.fn(),
    getById: vi.fn(),
    updateVendorGroupStatus: vi.fn(),
    updateOrderStatus: vi.fn(),
    getVendorOrderGroups: vi.fn(),
  },
}));

// Mock react-router-dom useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Import after mocks are set up
import { VendorOrderPage } from './VendorOrderPage';

// Mock vendor group data
const mockVendorGroup1: OrderVendorGroup = {
  id: 'ovg-1',
  orderId: 'order-1',
  vendorId: 'vendor-1',
  status: 'pending',
  items: [
    { id: 'item-1', productId: 'prod-1', productName: 'Produto Teste 1', vendorId: 'vendor-1', quantity: 2, unitPrice: 29.99, totalPrice: 59.98 },
    { id: 'item-2', productId: 'prod-2', productName: 'Produto Teste 2', vendorId: 'vendor-1', quantity: 1, unitPrice: 15.00, totalPrice: 15.00 },
  ],
  subtotal: 74.98,
  commissionPct: 10,
  commissionAmount: 7.49,
  vendorNet: 67.49,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T10:00:00Z',
};

const mockVendorGroup2: OrderVendorGroup = {
  id: 'ovg-2',
  orderId: 'order-2',
  vendorId: 'vendor-1',
  status: 'preparing',
  items: [
    { id: 'item-3', productId: 'prod-3', productName: 'Produto Teste 3', vendorId: 'vendor-1', quantity: 3, unitPrice: 49.99, totalPrice: 149.97 },
  ],
  subtotal: 149.97,
  commissionPct: 12,
  commissionAmount: 17.99,
  vendorNet: 131.98,
  createdAt: '2024-01-20T14:30:00Z',
  updatedAt: '2024-01-20T14:30:00Z',
};

const mockVendorGroup3: OrderVendorGroup = {
  id: 'ovg-3',
  orderId: 'order-3',
  vendorId: 'vendor-1',
  status: 'delivered',
  items: [
    { id: 'item-4', productId: 'prod-4', productName: 'Produto Teste 4', vendorId: 'vendor-1', quantity: 1, unitPrice: 99.99, totalPrice: 99.99 },
  ],
  subtotal: 99.99,
  commissionPct: 10,
  commissionAmount: 9.99,
  vendorNet: 89.99,
  createdAt: '2024-01-10T09:00:00Z',
  updatedAt: '2024-01-10T09:00:00Z',
};

const mockVendorGroup4: OrderVendorGroup = {
  id: 'ovg-4',
  orderId: 'order-4',
  vendorId: 'vendor-1',
  status: 'confirmed',
  items: [
    { id: 'item-5', productId: 'prod-5', productName: 'Produto Teste 5', vendorId: 'vendor-1', quantity: 5, unitPrice: 19.99, totalPrice: 99.95 },
  ],
  subtotal: 99.95,
  commissionPct: 15,
  commissionAmount: 14.99,
  vendorNet: 84.96,
  createdAt: '2024-01-25T16:00:00Z',
  updatedAt: '2024-01-25T16:00:00Z',
};

const mockVendorGroup5: OrderVendorGroup = {
  id: 'ovg-5',
  orderId: 'order-5',
  vendorId: 'vendor-1',
  status: 'shipped',
  items: [
    { id: 'item-6', productId: 'prod-6', productName: 'Produto Teste 6', vendorId: 'vendor-1', quantity: 2, unitPrice: 39.99, totalPrice: 79.98 },
  ],
  subtotal: 79.98,
  commissionPct: 8,
  commissionAmount: 6.39,
  vendorNet: 73.59,
  createdAt: '2024-01-28T11:00:00Z',
  updatedAt: '2024-01-28T11:00:00Z',
};

const mockVendorGroupsResponse: VendorOrderGroupsResponse = {
  vendorGroups: [mockVendorGroup1, mockVendorGroup2, mockVendorGroup3],
  total: 3,
  page: 1,
  limit: 10,
};

const mockPaginatedVendorGroupsResponsePage1: VendorOrderGroupsResponse = {
  vendorGroups: [mockVendorGroup1, mockVendorGroup2, mockVendorGroup3, mockVendorGroup4, mockVendorGroup5],
  total: 25,
  page: 1,
  limit: 10,
};

const mockPaginatedVendorGroupsResponsePage2: VendorOrderGroupsResponse = {
  vendorGroups: [mockVendorGroup1, mockVendorGroup2],
  total: 25,
  page: 2,
  limit: 10,
};

const mockEmptyVendorGroupsResponse: VendorOrderGroupsResponse = {
  vendorGroups: [],
  total: 0,
  page: 1,
  limit: 10,
};

const mockFilteredEmptyResponse: VendorOrderGroupsResponse = {
  vendorGroups: [],
  total: 0,
  page: 1,
  limit: 10,
};

// Track navigation for testing
let navigateMock: ReturnType<typeof vi.fn>;

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  navigateMock = vi.fn();

  const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/vendor/orders']}>
          {children}
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );

  return TestWrapper;
};

const renderWithNav = (ui: React.ReactElement) => {
  navigateMock = vi.fn();
  const wrapper = createWrapper();
  const { container, ...utils } = render(ui, { wrapper });
  return { container, ...utils, navigateMock };
};

describe('VendorOrderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementation to clear any mockResolvedValueOnce queue
    vi.mocked(orderApi.getVendorOrderGroups).mockReset();
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValue(mockVendorGroupsResponse);
    vi.mocked(orderApi.updateVendorGroupStatus).mockResolvedValue({ order: {} as any });
  });

  it('shows loading state initially', () => {
    renderWithNav(<VendorOrderPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Loading vendor orders/i)).toBeInTheDocument();
  });

  it('shows error state when fetch fails with retry button', async () => {
    vi.mocked(orderApi.getVendorOrderGroups).mockRejectedValueOnce(new Error('Network error'));

    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.getByText(/Error loading orders/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('shows empty state when no vendor order groups', async () => {
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockEmptyVendorGroupsResponse);

    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/No order groups found/i)).toBeInTheDocument();
    expect(screen.getByText(/You don't have any order groups associated./i)).toBeInTheDocument();
  });

  it('shows empty state with filter when no groups match filter', async () => {
    // First render with groups so we can apply a filter
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockVendorGroupsResponse);
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockFilteredEmptyResponse);

    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Apply a filter - this will trigger a refetch with the second mock (empty response)
    const select = screen.getByLabelText(/Filter by status/i);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'pending' } });
    });

    await waitFor(() => expect(orderApi.getVendorOrderGroups).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', page: 1 })));

    // Wait for the empty state to render with filter-specific message
    await waitFor(() => expect(screen.getByText(/Try changing the status filter to see more order groups./i)).toBeInTheDocument());

    expect(screen.getByText(/No order groups found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filter/i })).toBeInTheDocument();
  });

  it('displays vendor order groups list when data loads', async () => {
    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check header with total count - component uses "grupo(s) de pedido(s) encontrado(s)"
    expect(screen.getByText(/Sales Orders/i)).toBeInTheDocument();
    expect(screen.getByText(/3 order groups founds/i)).toBeInTheDocument();

    // Check vendor group cards are displayed - check Order IDs
    expect(screen.getByText(/ORDER-1/i)).toBeInTheDocument();
    expect(screen.getByText(/ORDER-2/i)).toBeInTheDocument();
    expect(screen.getByText(/ORDER-3/i)).toBeInTheDocument();

    // Check vendor group IDs
    expect(screen.getByText(/OVG-1/i)).toBeInTheDocument();
    expect(screen.getByText(/OVG-2/i)).toBeInTheDocument();
    expect(screen.getByText(/OVG-3/i)).toBeInTheDocument();

    // Check dates are formatted
    expect(screen.getByText(/01\/15\/2024/i)).toBeInTheDocument();
    expect(screen.getByText(/01\/20\/2024/i)).toBeInTheDocument();
    expect(screen.getByText(/01\/10\/2024/i)).toBeInTheDocument();

    // Check items count - use specific selector for items count elements
    // ovg-1 has 2 items, ovg-2 and ovg-3 have 1 item each
    expect(screen.getByText('2', { selector: 'p.font-medium.text-gray-900' })).toBeInTheDocument();
    const itemCountOnes = screen.getAllByText('1', { selector: 'p.font-medium.text-gray-900' });
    expect(itemCountOnes).toHaveLength(2);

    // Check financial summary
    expect(screen.getByText(/R\$74\.98/i)).toBeInTheDocument(); // subtotal ovg-1
    expect(screen.getByText(/R\$149\.97/i)).toBeInTheDocument(); // subtotal ovg-2
    expect(screen.getByText(/R\$99\.99/i)).toBeInTheDocument(); // subtotal ovg-3
    expect(screen.getByText(/R\$7\.49/i)).toBeInTheDocument(); // commission amount ovg-1
    expect(screen.getByText(/R\$17\.99/i)).toBeInTheDocument(); // commission amount ovg-2
    expect(screen.getByText(/R\$9\.99/i)).toBeInTheDocument(); // commission amount ovg-3
    expect(screen.getByText(/R\$67\.49/i)).toBeInTheDocument(); // vendor net ovg-1
    expect(screen.getByText(/R\$131\.98/i)).toBeInTheDocument(); // vendor net ovg-2
    expect(screen.getByText(/R\$89\.99/i)).toBeInTheDocument(); // vendor net ovg-3

    // Check commission percentage - both ovg-1 and ovg-3 have 10%, ovg-2 has 12%
    const commission10 = screen.getAllByText(/Commission \(10%\)/i);
    expect(commission10).toHaveLength(2);
    expect(screen.getByText(/Commission \(12%\)/i)).toBeInTheDocument();

    // Check View Details buttons
    expect(screen.getAllByRole('button', { name: /View details/i })).toHaveLength(3);
  });

  it('filters by status - Select change triggers refetch with page=1', async () => {
    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Initial call should be with no status filter, page 1
    expect(orderApi.getVendorOrderGroups).toHaveBeenCalledWith(expect.objectContaining({ status: undefined, page: 1, limit: 10 }));

    // Change status filter to 'pending'
    const select = screen.getByLabelText(/Filter by status/i);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'pending' } });
    });

    // Should reset page to 1 and call with status filter
    await waitFor(() => expect(orderApi.getVendorOrderGroups).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', page: 1, limit: 10 })));
  });

  it('pagination works - Next/Previous buttons and page indicator', async () => {
    // Mock page 1 response first
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockPaginatedVendorGroupsResponsePage1);

    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check pagination is visible (totalPages = ceil(25/10) = 3)
    expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();

    // Previous button should be disabled on page 1
    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();

    // Mock page 2 response
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockPaginatedVendorGroupsResponsePage2);

    // Click Next
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    });

    // Should call API with page 2
    await waitFor(() => expect(orderApi.getVendorOrderGroups).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));

    // Wait for the UI to update with new page data
    await waitFor(() => expect(screen.getByText(/Page 2 of 3/i)).toBeInTheDocument());

    // Previous button should be enabled now
    expect(screen.getByRole('button', { name: /Previous/i })).not.toBeDisabled();

    // Mock page 1 response again for going back
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockPaginatedVendorGroupsResponsePage1);

    // Click Previous
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Previous/i }));
    });

    // Should call API with page 1
    await waitFor(() => expect(orderApi.getVendorOrderGroups).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));

    // Page indicator should update back
    await waitFor(() => expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument());
  });

  it('each group shows: Order ID, Vendor group ID, Status badge, Items count, Created date, Subtotal, Commission %, Commission amount, Vendor net', async () => {
    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check first vendor group card (ovg-1, status: pending)
    // Find the card by OVG-1 text and get its container (outer Card with rounded-xl)
    const ovg1Card = screen.getByText(/OVG-1/i).closest('[class*="rounded-xl"]') as HTMLElement;
    expect(ovg1Card).toBeInTheDocument();

    // Use within to scope queries to the specific card
    const { within } = await import('@testing-library/react');
    const ovg1 = within(ovg1Card!);

    // Order ID (truncated to 8 chars)
    ovg1.getByText(/ORDER-1/i);
    // Vendor Group ID
    ovg1.getByText(/OVG-1/i);
    // Status badge - pending should be warning (yellow)
    const pendingBadge = ovg1.getByText(/PENDING/i);
    expect(pendingBadge).toBeInTheDocument();
    // Items count - use getByText with selector for the specific element
    ovg1.getByText('2', { selector: 'p.font-medium.text-gray-900' }); // ovg-1 has 2 items
    // Created date
    ovg1.getByText(/01\/15\/2024/i);
    // Financial summary
    ovg1.getByText(/Subtotal/i);
    ovg1.getByText(/R\$74\.98/i);
    ovg1.getByText(/Commission \(10%\)/i);
    ovg1.getByText(/R\$7\.49/i);
    ovg1.getByText(/Vendor Net/i);
    ovg1.getByText(/R\$67\.49/i);
  });

  it('"Atualizar status" buttons appear for valid next statuses', async () => {
    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Use within to scope queries to specific vendor group cards
    const { within } = await import('@testing-library/react');
    
    // For 'pending' status (ovg-1), valid next statuses are 'confirmed' and 'cancelled'
    const ovg1Card = screen.getByText(/OVG-1/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg1 = within(ovg1Card!);
    ovg1.getByRole('button', { name: /CONFIRMED/i });
    ovg1.getByRole('button', { name: /CANCELLED/i });

    // For 'preparing' status (ovg-2), valid next statuses are 'shipped' and 'cancelled'
    const ovg2Card = screen.getByText(/OVG-2/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg2 = within(ovg2Card!);
    ovg2.getByRole('button', { name: /SHIPPED/i });
    ovg2.getByRole('button', { name: /CANCELLED/i });

    // For 'delivered' status (ovg-3), valid next status is 'returned'
    const ovg3Card = screen.getByText(/OVG-3/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg3 = within(ovg3Card!);
    ovg3.getByRole('button', { name: /RETURNED/i });
  });

  it('clicking "View details" navigates to /orders/:orderId', async () => {
    const { navigateMock } = renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Click Ver detalhes button for first vendor group (order-1)
    const viewDetailsButton = screen.getAllByRole('button', { name: /View details/i })[0];
    fireEvent.click(viewDetailsButton);

    // Should call navigate with /orders/order-1
    expect(navigateMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('status badge colors match CD-063 vendor group mapping', async () => {
    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Use within to scope queries to specific vendor group cards
    const { within } = await import('@testing-library/react');

    // Pending badge (ovg-1) - warning (yellow) -> bg-yellow-100 text-yellow-800
    const ovg1Card = screen.getByText(/OVG-1/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg1 = within(ovg1Card!);
    const pendingBadge = ovg1.getByText(/PENDING/i).closest('span[class*="bg-yellow-100"]') as HTMLElement;
    expect(pendingBadge).toBeInTheDocument();

    // Preparing badge (ovg-2) - info (cyan) -> bg-cyan-100 text-cyan-800
    const ovg2Card = screen.getByText(/OVG-2/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg2 = within(ovg2Card!);
    const preparingBadge = ovg2.getByText(/PREPARING/i).closest('span[class*="bg-cyan-100"]') as HTMLElement;
    expect(preparingBadge).toBeInTheDocument();

    // Delivered badge (ovg-3) - success (green) -> bg-green-100 text-green-800
    const ovg3Card = screen.getByText(/OVG-3/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg3 = within(ovg3Card!);
    const deliveredBadge = ovg3.getByText(/DELIVERED/i).closest('span[class*="bg-green-100"]') as HTMLElement;
    expect(deliveredBadge).toBeInTheDocument();
  });

  it('status badge labels use correct display labels per CD-063', async () => {
    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Use within to scope queries to specific vendor group cards (avoid select options)
    const { within } = await import('@testing-library/react');

    // Check label mappings from getVendorGroupStatusConfig:
    // pending -> PENDING
    // confirmed -> CONFIRMED
    // preparing -> PREPARING
    // shipped -> SHIPPED
    // delivered -> DELIVERED
    // cancelled -> CANCELLED
    // returned -> RETURNED

    const ovg1Card = screen.getByText(/OVG-1/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg1 = within(ovg1Card!);
    ovg1.getByText(/PENDING/i);

    const ovg2Card = screen.getByText(/OVG-2/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg2 = within(ovg2Card!);
    ovg2.getByText(/PREPARING/i);

    const ovg3Card = screen.getByText(/OVG-3/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg3 = within(ovg3Card!);
    ovg3.getByText(/DELIVERED/i);
  });

  it('clear filter button works when filter is active', async () => {
    // First render with groups so filter is visible
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockVendorGroupsResponse);

    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Set up mock for filtered empty response BEFORE triggering filter change
    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockFilteredEmptyResponse);

    // Apply a filter first
    const select = screen.getByLabelText(/Filter by status/i);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'pending' } });
    });

    await waitFor(() => expect(orderApi.getVendorOrderGroups).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', page: 1 })));

    // Wait for the empty state to render with clear filter button
    await waitFor(() => expect(screen.getByRole('button', { name: /Clear filter/i })).toBeInTheDocument());

    // Clear filter
    const clearButton = screen.getByRole('button', { name: /Clear filter/i });
    await act(async () => {
      fireEvent.click(clearButton);
    });

    // Should call API with no status filter and page 1
    await waitFor(() => expect(orderApi.getVendorOrderGroups).toHaveBeenCalledWith(expect.objectContaining({ status: undefined, page: 1 })));
  });

  it('update status mutation is called with correct params when clicking status button', async () => {
    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Scope to first vendor group card
    const { within } = await import('@testing-library/react');
    const ovg1Card = screen.getByText(/OVG-1/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg1 = within(ovg1Card!);

    // Click the CONFIRMED button for the first vendor group (pending -> confirmed)
    const confirmButton = ovg1.getByRole('button', { name: /CONFIRMED/i });
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    // Should call updateVendorGroupStatus with correct params
    await waitFor(() => expect(orderApi.updateVendorGroupStatus).toHaveBeenCalledWith(
      'order-1',
      'ovg-1',
      'confirmed'
    ));
  });

  it('shows correct next statuses for each vendor group status', async () => {
    // Create a response with all status types to test transition buttons
    const mockAllStatusesResponse: VendorOrderGroupsResponse = {
      vendorGroups: [
        { ...mockVendorGroup1, status: 'pending' },
        { ...mockVendorGroup2, status: 'confirmed' },
        { ...mockVendorGroup3, status: 'preparing' },
        { ...mockVendorGroup4, status: 'shipped' },
        { ...mockVendorGroup5, status: 'delivered' },
        { ...mockVendorGroup3, status: 'delivered', id: 'ovg-6' },
        { ...mockVendorGroup1, status: 'cancelled', id: 'ovg-7' },
        { ...mockVendorGroup1, status: 'returned', id: 'ovg-8' },
      ],
      total: 8,
      page: 1,
      limit: 10,
    };

    vi.mocked(orderApi.getVendorOrderGroups).mockResolvedValueOnce(mockAllStatusesResponse);

    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Use within to scope queries to specific vendor group cards
    const { within } = await import('@testing-library/react');

    // Pending (ovg-1): confirmed, cancelled
    const ovg1Card = screen.getByText(/OVG-1/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg1 = within(ovg1Card!);
    ovg1.getByRole('button', { name: /CONFIRMED/i });
    ovg1.getByRole('button', { name: /CANCELLED/i });

    // Confirmed (ovg-2): preparing, cancelled
    const ovg2Card = screen.getByText(/OVG-2/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg2 = within(ovg2Card!);
    ovg2.getByRole('button', { name: /PREPARING/i });
    ovg2.getByRole('button', { name: /CANCELLED/i });

    // Preparing (ovg-3): shipped, cancelled
    const ovg3Card = screen.getByText(/OVG-3/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg3 = within(ovg3Card!);
    ovg3.getByRole('button', { name: /SHIPPED/i });
    ovg3.getByRole('button', { name: /CANCELLED/i });

    // Shipped (ovg-4): delivered, cancelled, returned
    const ovg4Card = screen.getByText(/OVG-4/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg4 = within(ovg4Card!);
    ovg4.getByRole('button', { name: /DELIVERED/i });
    ovg4.getByRole('button', { name: /CANCELLED/i });
    ovg4.getByRole('button', { name: /RETURNED/i });

    // Delivered (ovg-5): returned
    const ovg5Card = screen.getByText(/OVG-5/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg5 = within(ovg5Card!);
    ovg5.getByRole('button', { name: /RETURNED/i });

    // Delivered (ovg-6): returned
    const ovg6Card = screen.getByText(/OVG-6/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg6 = within(ovg6Card!);
    ovg6.getByRole('button', { name: /RETURNED/i });

    // Cancelled (ovg-7): no next statuses (no buttons)
    // Refunded (ovg-8): no next statuses (no buttons)
    // We can't easily test "no buttons" but we verify the above are present
  });

  it('disabled state on status buttons when mutation is pending', async () => {
    // Create a mock that delays resolution to simulate pending state
    let resolveMutation: (value: { order: any }) => void;
    const mutationPromise = new Promise<{ order: any }>((resolve) => {
      resolveMutation = resolve;
    });
    vi.mocked(orderApi.updateVendorGroupStatus).mockImplementation(() => mutationPromise);

    renderWithNav(<VendorOrderPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Scope to first vendor group card
    const { within } = await import('@testing-library/react');
    const ovg1Card = screen.getByText(/OVG-1/i).closest('[class*="rounded-xl"]') as HTMLElement;
    const ovg1 = within(ovg1Card!);

    // Click a status button to trigger mutation
    const confirmButton = ovg1.getByRole('button', { name: /CONFIRMED/i });
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    // During mutation, buttons should be disabled - wait for the state to update
    await waitFor(() => {
      const confirmButtonDuringMutation = ovg1.getByRole('button', { name: /CONFIRMED/i });
      expect(confirmButtonDuringMutation).toBeDisabled();
    });

    // Resolve the mutation
    await act(async () => {
      resolveMutation!({ order: {} });
      await Promise.resolve();
    });

    // After mutation resolves, buttons should be enabled again - wait for state update
    await waitFor(() => {
      const confirmButtonAfterMutation = ovg1.getByRole('button', { name: /CONFIRMED/i });
      expect(confirmButtonAfterMutation).not.toBeDisabled();
    });
  });
});