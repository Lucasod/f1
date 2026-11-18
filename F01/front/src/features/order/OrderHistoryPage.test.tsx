import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { orderApi, Order, OrderListResponse } from '@/shared/api/order';
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
import { OrderHistoryPage } from './OrderHistoryPage';

const mockOrder1: Order = {
  id: 'order-1',
  personId: 'person-1',
  status: 'delivered',
  vendorGroups: [
    {
      id: 'ovg-1',
      orderId: 'order-1',
      vendorId: 'vendor-1',
      status: 'delivered',
      items: [
        { id: 'item-1', productId: 'prod-1', productName: 'Produto Teste 1', vendorId: 'vendor-1', quantity: 2, unitPrice: 29.99, totalPrice: 59.98 },
      ],
      subtotal: 59.98,
      commissionPct: 10,
      commissionAmount: 5.99,
      vendorNet: 53.99,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    },
  ],
  shippingAddress: {
    id: 'addr-1',
    street: 'Rua das Flores',
    number: '123',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    isPrimary: true,
  },
  totalAmount: 59.98,
  financialStatus: 'pending',
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T10:00:00Z',
};

const mockOrder2: Order = {
  id: 'order-2',
  personId: 'person-1',
  status: 'processing',
  vendorGroups: [
    {
      id: 'ovg-2',
      orderId: 'order-2',
      vendorId: 'vendor-2',
      status: 'preparing',
      items: [
        { id: 'item-2', productId: 'prod-2', productName: 'Produto Teste 2', vendorId: 'vendor-2', quantity: 1, unitPrice: 49.99, totalPrice: 49.99 },
      ],
      subtotal: 49.99,
      commissionPct: 10,
      commissionAmount: 4.99,
      vendorNet: 44.99,
      createdAt: '2024-01-20T14:30:00Z',
      updatedAt: '2024-01-20T14:30:00Z',
    },
    {
      id: 'ovg-3',
      orderId: 'order-2',
      vendorId: 'vendor-3',
      status: 'confirmed',
      items: [
        { id: 'item-3', productId: 'prod-3', productName: 'Produto Teste 3', vendorId: 'vendor-3', quantity: 3, unitPrice: 15.00, totalPrice: 45.00 },
      ],
      subtotal: 45.00,
      commissionPct: 10,
      commissionAmount: 4.50,
      vendorNet: 40.50,
      createdAt: '2024-01-20T14:30:00Z',
      updatedAt: '2024-01-20T14:30:00Z',
    },
  ],
  shippingAddress: {
    id: 'addr-2',
    street: 'Avenida Principal',
    number: '456',
    neighborhood: 'Jardins',
    city: 'Rio de Janeiro',
    state: 'RJ',
    isPrimary: false,
  },
  totalAmount: 94.99,
  financialStatus: 'pending',
  createdAt: '2024-01-20T14:30:00Z',
  updatedAt: '2024-01-20T14:30:00Z',
};

const mockOrder3: Order = {
  id: 'order-3',
  personId: 'person-1',
  status: 'cancelled',
  vendorGroups: [
    {
      id: 'ovg-4',
      orderId: 'order-3',
      vendorId: 'vendor-1',
      status: 'cancelled',
      items: [
        { id: 'item-4', productId: 'prod-4', productName: 'Produto Teste 4', vendorId: 'vendor-1', quantity: 1, unitPrice: 99.99, totalPrice: 99.99 },
      ],
      subtotal: 99.99,
      commissionPct: 10,
      commissionAmount: 9.99,
      vendorNet: 89.99,
      createdAt: '2024-01-10T09:00:00Z',
      updatedAt: '2024-01-10T09:00:00Z',
    },
  ],
  shippingAddress: {
    id: 'addr-3',
    street: 'Rua das Flores',
    number: '123',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    isPrimary: true,
  },
  totalAmount: 99.99,
  financialStatus: 'refunded',
  createdAt: '2024-01-10T09:00:00Z',
  updatedAt: '2024-01-10T09:00:00Z',
};

const mockOrdersListResponse: OrderListResponse = {
  orders: [mockOrder1, mockOrder2, mockOrder3],
  total: 3,
  page: 1,
  limit: 10,
};

const mockEmptyOrdersResponse: OrderListResponse = {
  orders: [],
  total: 0,
  page: 1,
  limit: 10,
};

const mockPaginatedOrdersResponsePage1: OrderListResponse = {
  orders: [mockOrder1, mockOrder2, mockOrder3],
  total: 25,
  page: 1,
  limit: 10,
};

const mockPaginatedOrdersResponsePage2: OrderListResponse = {
  orders: [mockOrder1, mockOrder2],
  total: 25,
  page: 2,
  limit: 10,
};

const mockFilteredEmptyResponse: OrderListResponse = {
  orders: [],
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
        <MemoryRouter initialEntries={['/orders']}>
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

describe('OrderHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementation to clear any mockResolvedValueOnce queue
    vi.mocked(orderApi.list).mockReset();
    vi.mocked(orderApi.list).mockResolvedValue(mockOrdersListResponse);
  });

  it('shows loading state initially', () => {
    renderWithNav(<OrderHistoryPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Loading orders/i)).toBeInTheDocument();
  });

  it('shows error state when fetch fails with retry button', async () => {
    vi.mocked(orderApi.list).mockRejectedValueOnce(new Error('Network error'));

    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.getByText(/Error loading order history/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('shows empty state when no orders', async () => {
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockEmptyOrdersResponse);

    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/No orders found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start shopping/i })).toBeInTheDocument();
  });

  it('shows empty state with filter when no orders match filter', async () => {
    // First render with orders so we can apply a filter
    // Set up both mocks upfront: initial load + filtered empty response
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockOrdersListResponse);
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockFilteredEmptyResponse);

    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Apply a filter - this will trigger a refetch with the second mock (empty response)
    const select = screen.getByLabelText(/Filter by status/i);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'delivered' } });
    });

    await waitFor(() => expect(orderApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered', page: 1 })));

    // Wait for the empty state to render with filter-specific message
    await waitFor(() => expect(screen.getByText(/Try adjusting the status filter to see more orders./i)).toBeInTheDocument());

    expect(screen.getByText(/No orders found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filter/i })).toBeInTheDocument();
  });

  it('displays orders list when data loads', async () => {
    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check header with total count
    expect(screen.getByText(/My Purchases/i)).toBeInTheDocument();
    expect(screen.getByText(/3 orders founds/i)).toBeInTheDocument();

    // Check order cards are displayed - use ORDER-1 which is unique
    expect(screen.getByText(/ORDER-1/i)).toBeInTheDocument();
    expect(screen.getByText(/ORDER-2/i)).toBeInTheDocument();
    expect(screen.getByText(/ORDER-3/i)).toBeInTheDocument();

    // Check dates are formatted (MM/DD/YYYY)
    expect(screen.getByText(/01\/15\/2024/i)).toBeInTheDocument();
    expect(screen.getByText(/01\/20\/2024/i)).toBeInTheDocument();
    expect(screen.getByText(/01\/10\/2024/i)).toBeInTheDocument();

    // Check totals
    expect(screen.getByText(/R\$59.98/i)).toBeInTheDocument();
    expect(screen.getByText(/R\$94.99/i)).toBeInTheDocument();
    expect(screen.getByText(/R\$99.99/i)).toBeInTheDocument();

    // Check vendor groups count - rendered as two separate <p> elements
    // Order 1 has 1 vendor group, Order 3 has 1 vendor group, Order 2 has 2 vendor groups
    // So we have two "1" elements and one "2" element
    const vendorCountOnes = screen.getAllByText('1', { selector: 'p.text-sm.font-medium.text-gray-900' });
    expect(vendorCountOnes).toHaveLength(2);
    expect(screen.getByText('2', { selector: 'p.text-sm.font-medium.text-gray-900' })).toBeInTheDocument();
    const vendorLabels = screen.getAllByText(/seller$/i);
    expect(vendorLabels).toHaveLength(2);
    expect(screen.getByText(/sellers$/i)).toBeInTheDocument();

    // Check View Details buttons
    expect(screen.getAllByRole('button', { name: 'View details' })).toHaveLength(3);
  });

  it('filters by status - Select change triggers refetch with page=1', async () => {
    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Initial call should be with no status filter, page 1
    expect(orderApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: undefined, page: 1, limit: 10 }));

    // Change status filter to 'delivered'
    const select = screen.getByLabelText(/Filter by status/i);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'delivered' } });
    });

    // Should reset page to 1 and call with status filter
    await waitFor(() => expect(orderApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered', page: 1, limit: 10 })));
  });

  it('pagination works - Next/Previous buttons and page indicator', async () => {
    // Mock page 1 response first
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockPaginatedOrdersResponsePage1);

    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check pagination is visible (totalPages = ceil(25/10) = 3)
    expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument();

    // Previous button should be disabled on page 1
    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();

    // Mock page 2 response
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockPaginatedOrdersResponsePage2);

    // Click Next
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    });

    // Should call API with page 2
    await waitFor(() => expect(orderApi.list).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));

    // Wait for the UI to update with new page data
    await waitFor(() => expect(screen.getByText(/Page 2 of 3/i)).toBeInTheDocument());

    // Previous button should be enabled now
    expect(screen.getByRole('button', { name: /Previous/i })).not.toBeDisabled();

    // Mock page 1 response again for going back
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockPaginatedOrdersResponsePage1);

    // Click Previous
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Previous/i }));
    });

    // Should call API with page 1
    await waitFor(() => expect(orderApi.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));

    // Page indicator should update back
    await waitFor(() => expect(screen.getByText(/Page 1 of 3/i)).toBeInTheDocument());
  });

  it('clicking order card navigates to /orders/:orderId', async () => {
    const { navigateMock } = renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // The order card is a div with role="button" and tabindex="0"
    // It has accessible name containing the order info
    const orderCard = screen.getByRole('button', { name: /Order ORDER-1/i });
    fireEvent.click(orderCard);

    // Should call navigate with /orders/order-1
    expect(navigateMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('status badge colors match CD-063 mapping', async () => {
    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check badge variants match the status mapping using CSS classes:
    // delivered -> success (green) -> bg-green-100 text-green-800
    // processing -> info (cyan) -> bg-cyan-100 text-cyan-800
    // cancelled -> error (red) -> bg-red-100 text-red-800

    // Find badges within order cards (not the select options)
    // Delivered order badge
    const order1Card = screen.getByRole('button', { name: /Order ORDER-1/i });
    const deliveredBadge = order1Card.querySelector('span[class*="bg-green-100"]');
    expect(deliveredBadge).toBeInTheDocument();

    // Processing order badge
    const order2Card = screen.getByRole('button', { name: /Order ORDER-2/i });
    const processingBadge = order2Card.querySelector('span[class*="bg-cyan-100"]');
    expect(processingBadge).toBeInTheDocument();

    // Cancelled order badge
    const order3Card = screen.getByRole('button', { name: /Order ORDER-3/i });
    const cancelledBadge = order3Card.querySelector('span[class*="bg-red-100"]');
    expect(cancelledBadge).toBeInTheDocument();
  });

  it('status badge labels use correct display labels', async () => {
    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check label mappings from getStatusConfig:
    // pending_payment -> PENDING_PAYMENT
    // paid -> PAID
    // processing -> PROCESSING
    // shipped -> SHIPPED
    // delivered -> DELIVERED
    // cancelled -> CANCELLED
    // failed_payment -> FAILED_PAYMENT

    // Find badges within order cards (not the select options)
    // The badge is the span with the status text inside the status column
    const order1Card = screen.getByRole('button', { name: /Order ORDER-1/i });
    const order2Card = screen.getByRole('button', { name: /Order ORDER-2/i });
    const order3Card = screen.getByRole('button', { name: /Order ORDER-3/i });

    // Check badge texts within each order card - find the badge span specifically
    const badge1 = order1Card.querySelector('span[class*="bg-green-100"]');
    const badge2 = order2Card.querySelector('span[class*="bg-cyan-100"]');
    const badge3 = order3Card.querySelector('span[class*="bg-red-100"]');

    expect(badge1).toHaveTextContent(/DELIVERED/i);
    expect(badge2).toHaveTextContent(/PROCESSING/i);
    expect(badge3).toHaveTextContent(/CANCELLED/i);
  });

  it('clear filter button works when filter is active', async () => {
    // First render with orders so filter is visible
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockOrdersListResponse);

    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Set up mock for filtered empty response BEFORE triggering filter change
    // so the refetch uses this mock
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockFilteredEmptyResponse);

    // Apply a filter first
    const select = screen.getByLabelText(/Filter by status/i);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'delivered' } });
    });

    await waitFor(() => expect(orderApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered', page: 1 })));

    // Wait for the empty state to render with clear filter button
    await waitFor(() => expect(screen.getByRole('button', { name: /Clear filter/i })).toBeInTheDocument());

    // Clear filter
    const clearButton = screen.getByRole('button', { name: /Clear filter/i });
    await act(async () => {
      fireEvent.click(clearButton);
    });

    // Should call API with no status filter and page 1
    await waitFor(() => expect(orderApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: undefined, page: 1 })));
  });

  it('start shopping button navigates to products when no orders and no filter', async () => {
    vi.mocked(orderApi.list).mockResolvedValueOnce(mockEmptyOrdersResponse);

    const { navigateMock } = renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const startShoppingButton = screen.getByRole('button', { name: /Start shopping/i });
    fireEvent.click(startShoppingButton);

    expect(navigateMock).toHaveBeenCalledWith('/products');
  });

  it('shows order with multiple vendor groups correctly', async () => {
    // mockOrder2 has 2 vendor groups
    // Use mockResolvedValue to ensure consistent response for this test
    vi.mocked(orderApi.list).mockResolvedValue(mockOrdersListResponse);

    renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Should show "2 sellers" for order-2
    // The text "2 sellers" is split across two <p> elements: "2" and "sellers"
    // So we check for the text in the order card
    const order2Card = screen.getByRole('button', { name: /Order ORDER-2/i });
    expect(order2Card).toHaveTextContent('2');
    expect(order2Card).toHaveTextContent('sellers');
  });

  it('View Details button stops propagation and navigates', async () => {
    const { navigateMock } = renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Click View Details button directly (should not trigger card click handler twice)
    const viewDetailsButton = screen.getAllByRole('button', { name: /View details/i })[0];
    fireEvent.click(viewDetailsButton);

    expect(navigateMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('handles keyboard navigation on order card (Enter key)', async () => {
    const { navigateMock } = renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const orderCard = screen.getByRole('button', { name: /Order ORDER-1/i });
    fireEvent.keyDown(orderCard, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalledWith('/orders/order-1');
  });

  it('handles keyboard navigation on order card (Space key)', async () => {
    const { navigateMock } = renderWithNav(<OrderHistoryPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const orderCard = screen.getByRole('button', { name: /Order ORDER-1/i });
    fireEvent.keyDown(orderCard, { key: ' ' });
    expect(navigateMock).toHaveBeenCalledWith('/orders/order-1');
  });
});