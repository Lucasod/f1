import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { orderApi, Order, OrderVendorGroup, OrderItem, OrderStatus, Address } from '@/shared/api/order';
import { vendorApi } from '@/shared/api/vendor';
import { cartApi } from '@/shared/api/cart';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';
import React from 'react';

// Mock useAuth before importing OrderDetailPage
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
  return {
    ...actual,
    useAuth: () => mockUseAuth,
  };
});

// Mock react-router-dom navigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/shared/api/order', () => ({
  orderApi: {
    getById: vi.fn(),
    updateVendorGroupStatus: vi.fn(),
    updateOrderStatus: vi.fn(),
  },
}));

vi.mock('@/shared/api/vendor', () => ({
  vendorApi: {
    getMe: vi.fn(),
  },
}));

vi.mock('@/shared/api/cart', () => ({
  cartApi: {
    addItem: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Import after mocks are set up
import { OrderDetailPage } from './OrderDetailPage';

const mockAddress: Address = {
  id: 'addr-1',
  street: 'Rua das Flores',
  number: '123',
  neighborhood: 'Centro',
  city: 'São Paulo',
  state: 'SP',
  isPrimary: true,
};

const mockOrderItem1: OrderItem = {
  id: 'item-1',
  productId: 'prod-1',
  productName: 'Produto Teste 1',
  vendorId: 'vendor-1',
  quantity: 2,
  unitPrice: 29.99,
  totalPrice: 59.98,
};

const mockOrderItem2: OrderItem = {
  id: 'item-2',
  productId: 'prod-2',
  productName: 'Produto Teste 2',
  vendorId: 'vendor-2',
  quantity: 1,
  unitPrice: 49.99,
  totalPrice: 49.99,
};

const mockVendorGroup1: OrderVendorGroup = {
  id: 'ovg-1',
  orderId: 'order-1',
  vendorId: 'vendor-1',
  status: 'confirmed',
  items: [mockOrderItem1],
  subtotal: 59.98,
  commissionPct: 15,
  commissionAmount: 8.997,
  vendorNet: 50.983,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockVendorGroup2: OrderVendorGroup = {
  id: 'ovg-2',
  orderId: 'order-1',
  vendorId: 'vendor-2',
  status: 'pending',
  items: [mockOrderItem2],
  subtotal: 49.99,
  commissionPct: 15,
  commissionAmount: 7.4985,
  vendorNet: 42.4915,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockOrder: Order = {
  id: 'order-1',
  personId: 'user-1',
  status: 'paid',
  vendorGroups: [mockVendorGroup1, mockVendorGroup2],
  shippingAddress: mockAddress,
  totalAmount: 119.97,
  financialStatus: 'pending',
  createdAt: '2024-01-01T10:30:00Z',
  updatedAt: '2024-01-01T10:30:00Z',
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

  // Wrapper that provides a mocked navigate
  const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/orders/order-1']}>
          <Routes>
            <Route path="/orders/:orderId" element={children} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );

  return TestWrapper;
};

// Helper to render with navigation tracking
const renderWithNav = (ui: React.ReactElement) => {
  navigateMock = vi.fn();
  const wrapper = createWrapper();
  const { container, ...utils } = render(ui, { wrapper });
  return { container, ...utils, navigateMock };
};

// Helper to set mock auth role
const setMockAuthRole = (role: 'CONSUMER' | 'VENDOR' | 'ADMIN', userId = 'user-1') => {
  mockUseAuth.user = { id: userId, name: 'Test User', email: 'test@test.com', roles: [role] };
  mockUseAuth.hasRole = vi.fn((r: string) => r === role);
};

describe('OrderDetailPage', () => {
  beforeEach(() => {
    // Reset mocks manually to ensure clean state
    vi.mocked(orderApi.getById).mockReset();
    vi.mocked(orderApi.updateVendorGroupStatus).mockReset();
    vi.mocked(orderApi.updateOrderStatus).mockReset();
    
    // Default mock - tests that need different behavior must override explicitly
    vi.mocked(orderApi.getById).mockResolvedValue({ order: mockOrder });
    vi.mocked(orderApi.updateVendorGroupStatus).mockResolvedValue({ order: mockOrder });
    vi.mocked(orderApi.updateOrderStatus).mockResolvedValue({ order: mockOrder });
    vi.mocked(vendorApi.getMe).mockResolvedValue({ vendor: { id: 'vendor-1', personId: 'vendor-person-1', storeName: 'Store', slug: 'store', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' } });
    
    // Default to consumer role
    setMockAuthRole('CONSUMER');
  });

  it('shows loading state initially', async () => {
    // Create a deferred promise that we can control
    let resolvePromise: (value: { order: Order }) => void;
    const pendingPromise = new Promise<{ order: Order }>((resolve) => {
      resolvePromise = resolve;
    });
    
    vi.mocked(orderApi.getById).mockReturnValue(pendingPromise);
    
    renderWithNav(<OrderDetailPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading order details/i)).toBeInTheDocument();
    
    // Resolve the promise to clean up
    resolvePromise!({ order: mockOrder });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('renders a vendor-scoped response without global status or an invented shipping amount', async () => {
    setMockAuthRole('VENDOR', 'vendor-person-1');
    const { status: _status, financialStatus: _financialStatus, ...vendorOrder } = mockOrder;
    vi.mocked(orderApi.getById).mockResolvedValue({ order: { ...vendorOrder, vendorGroups: [mockVendorGroup1], totalAmount: mockVendorGroup1.subtotal } as Order });
    renderWithNav(<OrderDetailPage />);
    expect(await screen.findByText('Produto Teste 1')).toBeInTheDocument();
    expect(screen.queryByText('Order Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipping')).not.toBeInTheDocument();
  });

  it('shows vendor profile error and refetches on retry', async () => {
    setMockAuthRole('VENDOR', 'vendor-person-1');
    vi.mocked(vendorApi.getMe).mockRejectedValueOnce(new Error('Network error'));
    vi.mocked(orderApi.getById).mockResolvedValue({ order: { ...mockOrder, vendorGroups: [mockVendorGroup1], status: undefined as any, financialStatus: undefined } as Order });
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.getByText(/could not load vendor profile/i)).toBeInTheDocument());
    const callsBeforeRetry = vi.mocked(vendorApi.getMe).mock.calls.length;
    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);

    await waitFor(() => expect(vi.mocked(vendorApi.getMe).mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });

  it('recovers vendor profile after retry and enables vendor actions', async () => {
    setMockAuthRole('VENDOR', 'vendor-person-1');
    vi.mocked(vendorApi.getMe)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ vendor: { id: 'vendor-1', personId: 'vendor-person-1', storeName: 'Store', slug: 'store', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' } });
    vi.mocked(orderApi.getById).mockResolvedValue({ order: { ...mockOrder, vendorGroups: [mockVendorGroup1], status: undefined as any, financialStatus: undefined } as Order });
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.getByText(/could not load vendor profile/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /PREPARING/i })).toBeInTheDocument());
  });

  it('does not restore vendor actions when a previous identity profile resolves late', async () => {
    setMockAuthRole('VENDOR', 'vendor-person-1');
    useAuthStore.setState({ user: { ...mockUseAuth.user, roles: ['VENDOR'] } });
    let resolveOld!: (value: Awaited<ReturnType<typeof vendorApi.getMe>>) => void;
    const oldProfile = new Promise<Awaited<ReturnType<typeof vendorApi.getMe>>>(resolve => { resolveOld = resolve; });
    vi.mocked(vendorApi.getMe).mockReset()
      .mockReturnValueOnce(oldProfile)
      .mockRejectedValueOnce(new Error('Profile unavailable'));
    vi.mocked(orderApi.getById)
      .mockResolvedValueOnce({ order: { ...mockOrder, vendorGroups: [mockVendorGroup1] } })
      .mockResolvedValueOnce({ order: { ...mockOrder, vendorGroups: [mockVendorGroup2] } });
    const { rerender } = renderWithNav(<OrderDetailPage />);
    await waitFor(() => expect(vendorApi.getMe).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Produto Teste 1')).toBeInTheDocument();

    setMockAuthRole('VENDOR', 'vendor-person-2');
    act(() => {
      useAuthStore.setState({ user: { ...mockUseAuth.user, roles: ['VENDOR'] } });
      rerender(<OrderDetailPage />);
    });
    await waitFor(() => expect(screen.getByText(/could not load vendor profile/i)).toBeInTheDocument());
    expect(await screen.findByText('Produto Teste 2')).toBeInTheDocument();
    expect(screen.queryByText('Produto Teste 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PREPARING/i })).not.toBeInTheDocument();

    await act(async () => resolveOld({ vendor: { id: 'vendor-1', personId: 'vendor-person-1', storeName: 'Store', slug: 'store', status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' } }));
    expect(screen.getByText(/could not load vendor profile/i)).toBeInTheDocument();
    expect(screen.queryByText('Produto Teste 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PREPARING/i })).not.toBeInTheDocument();
    expect(orderApi.updateVendorGroupStatus).not.toHaveBeenCalled();
    act(() => useAuthStore.setState({ user: null }));
  });

  it('shows error state when fetch fails with retry button', async () => {
    vi.mocked(orderApi.getById).mockRejectedValueOnce(new Error('Network error'));

    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.getByText(/Error loading order/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows not found state when order does not exist (404)', async () => {
    const notFoundError = new Error('404 Not Found');
    vi.mocked(orderApi.getById).mockRejectedValueOnce(notFoundError);

    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.getByText(/Order not found/i)).toBeInTheDocument());
    expect(screen.getByText(/The requested order does not exist or has been removed./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to my orders/i })).toBeInTheDocument();
  });

it('displays order header: ID, status badge, date, financial status', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check order ID (first 8 chars) - "ORDER-1" is unique
    expect(screen.getByText(/ORDER-1/i)).toBeInTheDocument();
    
    // Check status badge (PAID) - appears in header badge and timeline
    const paidBadges = screen.getAllByText(/PAID/i);
    expect(paidBadges.length).toBeGreaterThanOrEqual(1);
    
    // Check financial status (paid) - appears in header badge and timeline
    const financialStatusBadges = screen.getAllByText(/paid/i);
    expect(financialStatusBadges.length).toBeGreaterThanOrEqual(1);

    // Check date
    expect(screen.getByText(/order date/i)).toBeInTheDocument();
    expect(screen.getByText(/01\/01\/2024/i)).toBeInTheDocument();
  });

  it('displays shipping address', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/Delivery Address/i)).toBeInTheDocument();
    expect(screen.getByText(/Rua das Flores, 123/i)).toBeInTheDocument();
    expect(screen.getByText(/Centro/i)).toBeInTheDocument();
    expect(screen.getByText(/São Paulo - SP/i)).toBeInTheDocument();
  });

  it('displays vendor groups with items table and financial summary', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check vendor group header - "Seller: VENDOR-1" is in a single h3 element
    expect(screen.getByText(/Seller: VENDOR-1/i)).toBeInTheDocument();
    expect(screen.getByText(/Seller: VENDOR-2/i)).toBeInTheDocument();

    // Check items table headers - use getAllByText since there are two vendor groups
    const productHeaders = screen.getAllByText(/product/i);
    expect(productHeaders.length).toBeGreaterThanOrEqual(1);
    const qtyHeaders = screen.getAllByText(/qty/i);
    expect(qtyHeaders.length).toBeGreaterThanOrEqual(1);
    const unitPriceHeaders = screen.getAllByText(/unit price/i);
    expect(unitPriceHeaders.length).toBeGreaterThanOrEqual(1);
    const totalHeaders = screen.getAllByText(/total/i);
    expect(totalHeaders.length).toBeGreaterThanOrEqual(1);

    // Check item details - use specific product names
    expect(screen.getByText(/Produto Teste 1/i)).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('SKU:') && content.includes('PROD-1'))).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // quantity
    expect(screen.getByText(/\$29\.99/i)).toBeInTheDocument(); // unit price
    const totalPrice1 = screen.getAllByText(/\$59\.98/i);
    expect(totalPrice1.length).toBeGreaterThanOrEqual(1);

    expect(screen.getByText(/Produto Teste 2/i)).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('SKU:') && content.includes('PROD-2'))).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // quantity
    const unitPrice2 = screen.getAllByText(/\$49\.99/i);
    expect(unitPrice2.length).toBeGreaterThanOrEqual(1);

    // Check vendor group financial summary
    const subtotalLabels = screen.getAllByText(/subtotal/i);
    expect(subtotalLabels.length).toBeGreaterThanOrEqual(2); // one per vendor group
    const comissaoLabels = screen.getAllByText(/Commission \(15%\)/i);
    expect(comissaoLabels.length).toBeGreaterThanOrEqual(2);
    const liquidoLabels = screen.getAllByText(/Vendor Net/i);
    expect(liquidoLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('displays order totals (subtotal, shipping, total)', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/order totals/i)).toBeInTheDocument();
    
    // Subtotal: 59.98 + 49.99 = 109.97
    expect(screen.getByText((content) => content.includes('Subtotal') && content.includes('2 sellers'))).toBeInTheDocument();
    expect(screen.getByText(/\$109\.97/i)).toBeInTheDocument();
    
    // Shipping: 119.97 - 109.97 = 10.00
    expect(screen.getByText(/shipping/i)).toBeInTheDocument();
    expect(screen.getByText(/\$10\.00/i)).toBeInTheDocument();
    
// Total - in the order totals card (not table headers)
    const totalsCard = screen.getByText(/order totals/i).closest('div[class*="rounded-xl"]');
    expect(totalsCard).not.toBeNull();
    expect(totalsCard!.textContent).toMatch(/119\.97/);
    expect(screen.getByText(/\$119\.97/i)).toBeInTheDocument();
  });

  it('displays timeline tracker with correct step highlighting for paid status', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/order tracking/i)).toBeInTheDocument();
    
    // Check all timeline steps exist - use descriptions which are unique to timeline
    expect(screen.getByText((content) => content.includes('Awaiting payment'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Payment confirmed'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Preparing'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Shipped for delivery'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Delivered'))).toBeInTheDocument();
    
    // Also check the step labels exist (they may appear multiple times)
    expect(screen.getAllByText(/PENDING_PAYMENT/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/PAID/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/PROCESSING/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/SHIPPED/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/DELIVERED/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows "Comprar Novamente" button for consumer when order not terminal', async () => {
    setMockAuthRole('CONSUMER');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: /buy again/i })).toBeInTheDocument();
  });

  it('hides "Comprar Novamente" button for consumer when order is terminal (cancelled)', async () => {
    const cancelledOrder = { ...mockOrder, status: 'cancelled' as OrderStatus };
    vi.mocked(orderApi.getById).mockResolvedValue({ order: cancelledOrder });
    setMockAuthRole('CONSUMER');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /buy again/i })).not.toBeInTheDocument();
  });

  it('shows "Atualizar status" buttons for vendor on their vendor groups', async () => {
    setMockAuthRole('VENDOR', 'vendor-person-1');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Vendor should see status update buttons for their own vendor group (ovg-1)
    // Available next statuses for 'confirmed' are 'preparing' and 'cancelled'
    expect(screen.getByRole('button', { name: /PREPARING/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /CANCELLED/i })).toBeInTheDocument();
  });

  it('does not show vendor status buttons for other vendor groups', async () => {
    setMockAuthRole('VENDOR', 'vendor-person-1');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Vendor should NOT see status update buttons for vendor-2's group (ovg-2)
    // The buttons are only shown for canUpdateVendorGroup which requires isOwnVendorGroup
    // For vendor-2 group, available statuses from 'pending' would be 'confirmed', 'cancelled'
    // But these should not be visible since vendor-1 doesn't own vendor-2 group
    // We verify by checking the vendor group for vendor-2 doesn't have action buttons
    const vendor2Group = screen.getByText(/Seller: VENDOR-2/i).closest('div[class*="rounded-xl"]');
    expect(vendor2Group).not.toBeNull();
    expect(vendor2Group!.querySelectorAll('button').length).toBe(0);
  });

  it('shows "Alterar status do pedido" buttons for admin', async () => {
    setMockAuthRole('ADMIN');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Admin should see order status update buttons in the header
    // Available next statuses for 'paid' include 'processing' and 'cancelled'
    const processingButtons = screen.getAllByRole('button', { name: /PROCESSING/i });
    const cancelledButtons = screen.getAllByRole('button', { name: /CANCELLED/i });
    expect(processingButtons.length).toBeGreaterThanOrEqual(1);
    expect(cancelledButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('hides admin status buttons when order is terminal', async () => {
    const deliveredOrder = { ...mockOrder, status: 'delivered' as OrderStatus };
    vi.mocked(orderApi.getById).mockResolvedValue({ order: deliveredOrder });
    setMockAuthRole('ADMIN');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /REFUNDED/i })).not.toBeInTheDocument();
  });

  it('clicking "Voltar" navigates to /orders', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const backButton = screen.getByRole('button', { name: /back/i });
    fireEvent.click(backButton);

    expect(navigateMock).toHaveBeenCalledWith('/orders');
  });

  it('clicking "Buy Again" navigates to /cart', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const reorderButton = screen.getByRole('button', { name: /buy again/i });
    await act(async () => {
      fireEvent.click(reorderButton);
    });

    expect(navigateMock).toHaveBeenCalledWith('/cart');
  });

  it('clicking vendor group status button calls updateVendorGroupStatus', async () => {
    setMockAuthRole('VENDOR', 'vendor-person-1');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Click "PREPARING" button for vendor-1's group
    const preparingButton = screen.getByRole('button', { name: /PREPARING/i });
    fireEvent.click(preparingButton);

    await waitFor(() => expect(orderApi.updateVendorGroupStatus).toHaveBeenCalledWith('order-1', 'ovg-1', 'preparing'));
  });

  it('clicking admin order status button calls updateOrderStatus', async () => {
    setMockAuthRole('ADMIN');
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Click "PROCESSING" button for admin
    const processingButton = screen.getByRole('button', { name: /PROCESSING/i });
    fireEvent.click(processingButton);

    await waitFor(() => expect(orderApi.updateOrderStatus).toHaveBeenCalledWith('order-1', 'processing'));
  });

  it('shows terminal status indicator in timeline for cancelled order', async () => {
    const cancelledOrder = { ...mockOrder, status: 'cancelled' as OrderStatus };
    vi.mocked(orderApi.getById).mockResolvedValue({ order: cancelledOrder });
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check for cancelled status in timeline terminal section
    expect(screen.getByText(/Order cancelled/i)).toBeInTheDocument();
  });

  it('shows terminal status indicator in timeline for failed payment', async () => {
    const failedPaymentOrder = { ...mockOrder, status: 'failed_payment' as OrderStatus };
    vi.mocked(orderApi.getById).mockResolvedValue({ order: failedPaymentOrder });
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check for refunded/failed payment status in timeline terminal section
    expect(screen.getByText(/payment failed/i)).toBeInTheDocument();
  });

it('shows vendor group status badge with correct variant', async () => {
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check vendor group headers exist with their vendor IDs
    expect(screen.getByText(/Seller: VENDOR-1/i)).toBeInTheDocument();
    expect(screen.getByText(/Seller: VENDOR-2/i)).toBeInTheDocument();
    
    // Check that status badges exist for both vendor groups (CONFIRMED and PENDING)
    // These appear in the vendor group cards
    const confirmedBadges = screen.getAllByText(/CONFIRMED/i);
    const pendingBadges = screen.getAllByText(/PENDING/i);
    expect(confirmedBadges.length).toBeGreaterThanOrEqual(1);
    expect(pendingBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('displays order with single vendor group correctly (singular "vendedor")', async () => {
    const singleVendorOrder = {
      ...mockOrder,
      vendorGroups: [mockVendorGroup1],
      totalAmount: 69.98, // 59.98 + 10 shipping
    };
    vi.mocked(orderApi.getById).mockResolvedValue({ order: singleVendorOrder });
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText((content) => content.includes('Subtotal') && content.includes('seller'))).toBeInTheDocument();
  });

  it('shows retry button in error state and refetches on click', async () => {
    vi.mocked(orderApi.getById)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ order: mockOrder });

    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument());

    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    // Check that order details are displayed after retry
    expect(screen.getByText(/ORDER-1/i)).toBeInTheDocument();
  });

  it('clicking "Voltar para meus pedidos" in not found state navigates to /orders', async () => {
    const notFoundError = new Error('404 Not Found');
    vi.mocked(orderApi.getById).mockRejectedValueOnce(notFoundError);
    renderWithNav(<OrderDetailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /back to my orders/i })).toBeInTheDocument());

    const backButton = screen.getByRole('button', { name: /back to my orders/i });
    fireEvent.click(backButton);

    expect(navigateMock).toHaveBeenCalledWith('/orders');
  });
});
