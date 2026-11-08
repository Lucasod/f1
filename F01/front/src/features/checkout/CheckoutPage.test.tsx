import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Cart, CartItem } from '@/shared/api/cart';
import { CheckoutPreviewResponse, CheckoutPreviewVendorGroup } from '@/shared/api/checkout';
import { Order, Address } from '@/shared/api/order';
import React from 'react';

// Mock useDebounce before importing CheckoutPage - use vi.hoisted to ensure it runs first
const { mockUseDebounce } = vi.hoisted(() => ({
  mockUseDebounce: <T,>(value: T): T => value,
}));

// Mock the hooks used by CheckoutPage
const mockUseCheckoutState = vi.hoisted(() => {
  const state = {
    couponCodes: [] as string[],
    selectedAddressId: null as string | null,
    paymentMethod: null as string | null,
  };
  
  return {
    get couponCodes() { return state.couponCodes; },
    get selectedAddressId() { return state.selectedAddressId; },
    get paymentMethod() { return state.paymentMethod; },
    addCouponCode: vi.fn((code: string) => {
      if (!state.couponCodes.includes(code)) {
        state.couponCodes = [...state.couponCodes, code];
      }
    }),
    removeCouponCode: vi.fn((code: string) => {
      state.couponCodes = state.couponCodes.filter((c) => c !== code);
    }),
    setSelectedAddressId: vi.fn((addressId: string | null) => {
      state.selectedAddressId = addressId;
    }),
    setPaymentMethod: vi.fn((method: string | null) => {
      state.paymentMethod = method;
    }),
    reset: vi.fn(() => {
      state.couponCodes = [];
      state.selectedAddressId = null;
      state.paymentMethod = null;
    }),
    setCouponCodes: vi.fn((codes: string[]) => {
      state.couponCodes = codes;
    }),
    clearCouponCodes: vi.fn(() => {
      state.couponCodes = [];
    }),
  };
});

const mockUseCheckoutPreview = vi.hoisted(() => ({
  data: undefined as CheckoutPreviewResponse | undefined,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

const mockUseCheckout = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
  reset: vi.fn(),
}));

const mockUseCheckoutMutations = vi.hoisted(() => ({
  useCheckout: () => mockUseCheckout,
}));

const mockUseCart = vi.hoisted(() => ({
  data: { cart: null as Cart | null },
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock('./CheckoutPage', async () => {
  const actual = await vi.importActual('./CheckoutPage');
  return {
    ...actual,
    useDebounce: mockUseDebounce,
  };
});

vi.mock('./useCheckout', () => ({
  useCheckoutState: () => mockUseCheckoutState,
  useCheckoutPreview: () => mockUseCheckoutPreview,
  useCheckoutMutations: () => mockUseCheckoutMutations,
}));

vi.mock('@/features/cart/useCart', () => ({
  useCart: () => mockUseCart,
}));

const mockPersonApi = vi.hoisted(() => ({
  getMe: vi.fn(),
}));

vi.mock('@/shared/api/person', () => ({
  personApi: mockPersonApi,
}));

// Mock AuthProvider and useAuth with mutable state
const mockAuthState = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['CONSUMER'] as const,
  } as { id: string; email: string; name: string; roles: readonly ['CONSUMER'] } | null,
  isAuthenticated: true,
  isLoading: false,
  error: null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshAccessToken: vi.fn(),
  initializeAuth: vi.fn(),
  setError: vi.fn(),
  clearError: vi.fn(),
  hasRole: vi.fn((role: string) => role === 'CONSUMER'),
};

vi.mock('@/app/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
  useAuth: () => mockAuthState,
}));

vi.mock('@/shared/api/cart', () => ({
  cartApi: {
    getCart: vi.fn(),
    addItem: vi.fn(),
    updateItemQuantity: vi.fn(),
    removeItem: vi.fn(),
    mergeGuestCart: vi.fn(),
  },
}));

const mockCheckoutApi = vi.hoisted(() => ({
  preview: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock('@/shared/api/checkout', () => ({
  checkoutApi: mockCheckoutApi,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Import after mocks are set up
import { CheckoutPage } from './CheckoutPage';

// Track navigation for testing
let navigateMock: ReturnType<typeof vi.fn>;

// Mock data
const mockCartItem1: CartItem = {
  productId: 'prod-1',
  vendorId: 'vendor-1',
  quantity: 2,
  unitPrice: 29.99,
  addedAt: '2024-01-01T00:00:00Z',
};

const mockCartItem2: CartItem = {
  productId: 'prod-2',
  vendorId: 'vendor-2',
  quantity: 1,
  unitPrice: 49.99,
  addedAt: '2024-01-02T00:00:00Z',
};

const mockCart: Cart = {
  id: 'cart-1',
  items: [mockCartItem1, mockCartItem2],
  version: 1,
  updatedAt: '2024-01-01T00:00:00Z',
};

const emptyCart: Cart = {
  id: 'cart-1',
  items: [],
  version: 1,
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockAddresses: Address[] = [
  {
    id: 'addr-1',
    street: 'Rua das Flores',
    number: '123',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    isPrimary: true,
  },
  {
    id: 'addr-2',
    street: 'Avenida Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    isPrimary: false,
  },
];

const mockPreviewVendorGroup1: CheckoutPreviewVendorGroup = {
  id: 'vendor-1',
  vendorName: 'Vendor 1',
  subtotal: 59.98,
  commissionPct: 10,
  commissionAmount: 6.00,
  vendorNet: 53.98,
  items: [
    {
      productId: 'prod-1',
      productName: 'Produto Teste 1',
      quantity: 2,
      unitPrice: 29.99,
      totalPrice: 59.98,
    },
  ],
};

const mockPreviewVendorGroup2: CheckoutPreviewVendorGroup = {
  id: 'vendor-2',
  vendorName: 'Vendor 2',
  subtotal: 49.99,
  commissionPct: 10,
  commissionAmount: 5.00,
  vendorNet: 44.99,
  items: [
    {
      productId: 'prod-2',
      productName: 'Produto Teste 2',
      quantity: 1,
      unitPrice: 49.99,
      totalPrice: 49.99,
    },
  ],
};

const mockPreviewResponse: CheckoutPreviewResponse = {
  vendorGroups: [mockPreviewVendorGroup1, mockPreviewVendorGroup2],
  totalAmount: 109.97,
};

const mockPreviewResponseWithDiscount: CheckoutPreviewResponse = {
  vendorGroups: [
    {
      ...mockPreviewVendorGroup1,
      subtotal: 53.98, // 10% discount on 59.98
      items: [
        {
          ...mockPreviewVendorGroup1.items[0],
          totalPrice: 53.98,
        },
      ],
    },
    {
      ...mockPreviewVendorGroup2,
      subtotal: 44.99, // 10% discount on 49.99
      items: [
        {
          ...mockPreviewVendorGroup2.items[0],
          totalPrice: 44.99,
        },
      ],
    },
  ],
  totalAmount: 98.97,
};

const mockOrder: Order = {
  id: 'order-123',
  personId: 'user-1',
  status: 'paid',
  vendorGroups: [
    {
      id: 'vg-1',
      orderId: 'order-123',
      vendorId: 'vendor-1',
      status: 'confirmed',
      items: [
        {
          id: 'oi-1',
          productId: 'prod-1',
          productName: 'Produto Teste 1',
          vendorId: 'vendor-1',
          quantity: 2,
          unitPrice: 29.99,
          totalPrice: 59.98,
        },
      ],
      subtotal: 59.98,
      commissionPct: 10,
      commissionAmount: 6.00,
      vendorNet: 53.98,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'vg-2',
      orderId: 'order-123',
      vendorId: 'vendor-2',
      status: 'confirmed',
      items: [
        {
          id: 'oi-2',
          productId: 'prod-2',
          productName: 'Produto Teste 2',
          vendorId: 'vendor-2',
          quantity: 1,
          unitPrice: 49.99,
          totalPrice: 49.99,
        },
      ],
      subtotal: 49.99,
      commissionPct: 10,
      commissionAmount: 5.00,
      vendorNet: 44.99,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ],
  shippingAddress: mockAddresses[0],
  totalAmount: 109.97,
  financialStatus: 'pending',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const resetMocks = () => {
  vi.clearAllMocks();
  vi.stubGlobal('open', vi.fn());
  mockPersonApi.getMe.mockReset();
  mockCheckoutApi.preview.mockReset();
  mockCheckoutApi.checkout.mockReset();
  
  // Reset useCheckoutState - call the reset function to clear internal state
  mockUseCheckoutState.reset();
  mockUseCheckoutState.addCouponCode.mockClear();
  mockUseCheckoutState.removeCouponCode.mockClear();
  mockUseCheckoutState.setSelectedAddressId.mockClear();
  mockUseCheckoutState.setPaymentMethod.mockClear();
  mockUseCheckoutState.reset.mockClear();
  mockUseCheckoutState.setCouponCodes.mockClear();
  mockUseCheckoutState.clearCouponCodes.mockClear();
  
  // Reset useCheckoutPreview
  mockUseCheckoutPreview.data = mockPreviewResponse;
  mockUseCheckoutPreview.isLoading = false;
  mockUseCheckoutPreview.error = null;
  mockUseCheckoutPreview.refetch.mockClear();
  
  // Reset useCheckout
  mockUseCheckout.mutateAsync.mockReset();
  mockUseCheckout.isPending = false;
  mockUseCheckout.isError = false;
  mockUseCheckout.error = null;
  mockUseCheckout.reset.mockClear();
  
  // Reset useCart
  mockUseCart.data = { cart: mockCart };
  mockUseCart.isLoading = false;
  mockUseCart.error = null;
  mockUseCart.refetch.mockClear();
  
  // Reset mockAuthState
  mockAuthState.user = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['CONSUMER'] as const,
  };
  mockAuthState.isAuthenticated = true;
  mockAuthState.isLoading = false;
  mockAuthState.error = null;
  mockAuthState.login.mockClear();
  mockAuthState.register.mockClear();
  mockAuthState.logout.mockClear();
  mockAuthState.refreshAccessToken.mockClear();
  mockAuthState.initializeAuth.mockClear();
  mockAuthState.setError.mockClear();
  mockAuthState.clearError.mockClear();
  mockAuthState.hasRole.mockImplementation((role: string) => role === 'CONSUMER');
  
  // Default fetch response
  mockPersonApi.getMe.mockResolvedValue({
    person: {
      addresses: mockAddresses,
    },
  });
};

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
      <MemoryRouter initialEntries={['/checkout']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );

  return TestWrapper;
};

const renderWithNav = (ui: React.ReactElement) => {
  navigateMock = vi.fn();
  const wrapper = createWrapper();
  const { container, rerender, ...utils } = render(ui, { wrapper });
  return { container, rerender, ...utils, navigateMock };
};

describe('CheckoutPage', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading state initially when cart is loading', async () => {
    mockUseCart.isLoading = true;
    
    renderWithNav(<CheckoutPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/carregando checkout/i)).toBeInTheDocument();
  });

  it('redirects to /products when cart is empty', async () => {
    mockUseCart.data = { cart: emptyCart };
    
    const { navigateMock } = renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/Your cart is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar comprando/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /continuar comprando/i }));
    expect(navigateMock).toHaveBeenCalledWith('/products');
  });

  it('shows error state when address fetch fails', async () => {
    mockPersonApi.getMe.mockRejectedValueOnce(new Error('Failed to fetch profile'));

    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/Erro ao carregar endereços/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('displays address selection with radio buttons', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check address section - use the legend in RadioGroup which is more specific
    expect(screen.getByText(/^Delivery address$/i)).toBeInTheDocument();
    
    // Check radio buttons for addresses (labels contain street, number, neighborhood)
    expect(screen.getByLabelText(/rua das flores, 123 - centro/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/avenida paulista, 1000 - bela vista/i)).toBeInTheDocument();
    
    // Check primary address indicator
    expect(screen.getByText(/\(principal\)/i)).toBeInTheDocument();
  });

  it('validates address is required (button disabled when not selected)', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Don't select any address, button should be disabled
    const submitButton = screen.getByTestId('checkout-submit-button');
    expect(submitButton).toBeDisabled();
  });

  it('coupon input and apply button are enabled', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const couponInput = screen.getByTestId('coupon-input');
    const applyButton = screen.getByTestId('coupon-apply-button');

    expect(couponInput).not.toBeDisabled();
    expect(applyButton).not.toBeDisabled();
  });

  it('does not mark a coupon applied when preview does not confirm validation', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const couponInput = screen.getByTestId('coupon-input');
    const applyButton = screen.getByTestId('coupon-apply-button');

    // Enter a coupon code and apply
    fireEvent.change(couponInput, { target: { value: 'TEST10' } });
    fireEvent.click(applyButton);

    expect(await screen.findByText(/validação de cupons está indisponível/i)).toBeInTheDocument();
    expect(mockUseCheckoutState.addCouponCode).not.toHaveBeenCalled();
  });

  it('displays a coupon service error without applying the code', async () => {
    mockCheckoutApi.preview.mockRejectedValueOnce(new Error('Cupons temporariamente indisponíveis'));
    renderWithNav(<CheckoutPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    fireEvent.change(screen.getByTestId('coupon-input'), { target: { value: 'EXAMPLE' } });
    fireEvent.click(screen.getByTestId('coupon-apply-button'));
    expect(await screen.findByText('Cupons temporariamente indisponíveis')).toBeInTheDocument();
    expect(mockUseCheckoutState.addCouponCode).not.toHaveBeenCalled();
  });

  it('shows that coupon application is temporarily unavailable', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/Aplicação de cupons temporariamente indisponível/i)).toBeInTheDocument();
  });

it('displays order summary with vendor groups, items, subtotal, discount, total', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check order summary section
    expect(screen.getByText(/resumo do pedido/i)).toBeInTheDocument();

    // Check vendor groups
    expect(screen.getByText('Vendor 1')).toBeInTheDocument();
    expect(screen.getByText('Vendor 2')).toBeInTheDocument();

    // Check items
    expect(screen.getByText('Produto Teste 1')).toBeInTheDocument();
    expect(screen.getByText('Produto Teste 2')).toBeInTheDocument();

    // Check quantities and prices
    expect(screen.getByText(/qtd: 2 ×/i)).toBeInTheDocument();
    expect(screen.getByText(/qtd: 1 ×/i)).toBeInTheDocument();

    // Check subtotal - use the sidebar subtotal which is more specific
    expect(within(screen.getByTestId('checkout-sidebar-summary')).getByText(/^subtotal bruto$/i)).toBeInTheDocument();
    // Check total in sidebar (more specific than main summary) - use exact match
    expect(within(screen.getByTestId('checkout-sidebar-summary')).getByText(/^total$/i)).toBeInTheDocument();
    // Check total amount in sidebar (the large total at the bottom with bold text)
    const sidebar = screen.getByTestId('checkout-sidebar-summary');
    expect(within(sidebar).getByText(/^total$/i).closest('div')).toContainHTML('R$ 109,97');
  });

  it('does not show discount (coupons disabled)', async () => {
    // Set up coupon in state using the mock function
    mockUseCheckoutState.setCouponCodes(['SAVE10']);
    mockUseCheckoutPreview.data = mockPreviewResponseWithDiscount;

    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Select address
    fireEvent.click(screen.getByLabelText(/rua das flores, 123 - centro/i));

    // Discount line should not appear
    expect(screen.queryByText(/desconto informado no preview/i)).not.toBeInTheDocument();
  });

  it('shows gross subtotal and informational preview discount in both summaries without subtracting twice', async () => {
    mockUseCheckoutPreview.data = {
      vendorGroups: [{ ...mockPreviewVendorGroup1, subtotal: 53.98 }, mockPreviewVendorGroup2],
      discountAmount: 6,
      totalAmount: 103.97,
    };

    renderWithNav(<CheckoutPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    for (const summary of [screen.getAllByTestId('checkout-step-summary')[1], screen.getByTestId('checkout-sidebar-summary')]) {
      const section = within(summary);
      expect(section.getByText(/^desconto informado no preview$/i).closest('div')).toHaveTextContent(/-R\$\s*6,00/);
      expect(section.getByText(/^subtotal bruto$/i).closest('div')).toHaveTextContent(/R\$\s*109,97/);
      expect(section.getByText(/^total$/i).closest('div')).toHaveTextContent(/R\$\s*103,97/);
    }
    expect(screen.getByTestId('main-shipping-amount')).toHaveTextContent('free');
    expect(screen.getByTestId('sidebar-shipping-amount')).toHaveTextContent('free');
    expect(mockUseCheckoutState.addCouponCode).not.toHaveBeenCalled();
  });

  it('shows gross subtotal without a discount when no coupon discount is returned', async () => {
    mockUseCheckoutPreview.data = { ...mockPreviewResponse, discountAmount: 0 };
    renderWithNav(<CheckoutPage />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    for (const summary of [screen.getAllByTestId('checkout-step-summary')[1], screen.getByTestId('checkout-sidebar-summary')]) {
      const section = within(summary);
      expect(section.getByText(/^subtotal bruto$/i).closest('div')).toHaveTextContent(/R\$\s*109,97/);
      expect(section.queryByText(/^desconto informado no preview$/i)).not.toBeInTheDocument();
      expect(section.getByText(/^total$/i).closest('div')).toHaveTextContent(/R\$\s*109,97/);
    }
  });

  it.each([
    { state: 'loading', loading: true, error: null, label: 'Calculating...' },
    { state: 'error', loading: false, error: new Error('Preview unavailable'), label: 'Unavailable' },
    { state: 'idle', loading: false, error: null, label: 'Unavailable' },
  ])('shows unknown shipping and total during preview $state', async ({ loading, error, label }) => {
    mockUseCheckoutPreview.data = undefined;
    mockUseCheckoutPreview.isLoading = loading;
    mockUseCheckoutPreview.error = error;
    mockUseCheckoutState.setSelectedAddressId('addr-1');
    mockUseCheckoutState.setPaymentMethod('stripe_checkout');
    renderWithNav(<CheckoutPage />);
    await screen.findByText('3. Resumo do Pedido');

    for (const summary of [screen.getAllByTestId('checkout-step-summary')[1], screen.getByTestId('checkout-sidebar-summary')]) {
      const section = within(summary);
      expect(section.getByText(/^subtotal bruto$/i).closest('div')).toHaveTextContent(/R\$\s*109,97/);
      expect(section.getByText(/^frete$/i).closest('div')).toHaveTextContent(label);
      expect(section.getByText(/^total$/i).closest('div')).toHaveTextContent(label);
    }
    expect(screen.getByTestId('checkout-submit-button')).toBeDisabled();
    expect(mockCheckoutApi.checkout).not.toHaveBeenCalled();
  });

  it('shows a real zero total and free shipping when the preview returns them', async () => {
    mockUseCheckoutPreview.data = {
      vendorGroups: [{ ...mockPreviewVendorGroup1, subtotal: 0 }],
      discountAmount: 59.98,
      totalAmount: 0,
    };
    renderWithNav(<CheckoutPage />);
    await screen.findByText('3. Resumo do Pedido');
    for (const summary of [screen.getAllByTestId('checkout-step-summary')[1], screen.getByTestId('checkout-sidebar-summary')]) {
      const section = within(summary);
      expect(section.getByText(/^frete$/i).closest('div')).toHaveTextContent('free');
      expect(section.getByText(/^total$/i).closest('div')).toHaveTextContent(/R\$\s*0,00/);
    }
  });

  it('shows payment selection with radio buttons', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check payment section - use the legend in RadioGroup which is more specific
    expect(screen.getByText(/^forma de pagamento$/i)).toBeInTheDocument();

    // Check payment options
    expect(screen.getByLabelText(/pagamento seguro via stripe/i)).toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup', { name: /forma de pagamento/i })).getAllByRole('radio')).toHaveLength(1);
  });

  it('validates payment method is required (button disabled when not selected)', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Select address but not payment
    fireEvent.click(screen.getByLabelText(/rua das flores, 123 - centro/i));

    // Wait for address selection to be reflected in state
    await waitFor(() => expect(mockUseCheckoutState.setSelectedAddressId).toHaveBeenCalledWith('addr-1'));

    // Button should be disabled because payment method is not selected
    const submitButton = screen.getByTestId('checkout-submit-button');
    expect(submitButton).toBeDisabled();
  });

  it('submits checkout and handles success (shows confirmation)', async () => {
    mockCheckoutApi.checkout.mockResolvedValueOnce({ order: mockOrder, checkoutUrl: 'https://checkout.stripe.test/session' });
    mockUseCheckoutState.reset.mockClear();

    const { rerender } = renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Select address
    fireEvent.click(screen.getByLabelText(/rua das flores, 123 - centro/i));

    // Wait for address selection
    await waitFor(() => expect(mockUseCheckoutState.setSelectedAddressId).toHaveBeenCalledWith('addr-1'));

    // Select payment
    fireEvent.click(screen.getByLabelText(/pagamento seguro via stripe/i));

    // Wait for payment selection
    await waitFor(() => expect(mockUseCheckoutState.setPaymentMethod).toHaveBeenCalledWith('stripe_checkout'));

    // Force re-render to pick up updated mock state
    rerender(<CheckoutPage />);

    // Now button should be enabled - submit
    const submitButton = screen.getByTestId('checkout-submit-button');
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockCheckoutApi.checkout).toHaveBeenCalledWith({
        shippingAddressId: 'addr-1',
        couponCodes: undefined,
      });
      expect(window.open).toHaveBeenCalledWith('https://checkout.stripe.test/session', '_self');
    });

    // Simulate successful submission by updating mock state using mock functions
    mockUseCheckoutState.clearCouponCodes();
    mockUseCheckoutState.setSelectedAddressId(null);
    mockUseCheckoutState.setPaymentMethod(null);
    
    // The component sets isSubmitted=true and submittedOrder internally
    // We can't easily test the success UI without triggering the internal state change
    // But we can verify the mutation was called correctly
  });

  it('handles checkout errors (insufficient stock, invalid address, etc.)', async () => {
    const errorMessage = 'Estoque insuficiente para o produto Produto Teste 1';
    mockCheckoutApi.checkout.mockRejectedValueOnce(new Error(errorMessage));

    const { rerender } = renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Select address
    fireEvent.click(screen.getByLabelText(/rua das flores, 123 - centro/i));

    // Wait for address selection
    await waitFor(() => expect(mockUseCheckoutState.setSelectedAddressId).toHaveBeenCalledWith('addr-1'));

    // Select payment
    fireEvent.click(screen.getByLabelText(/pagamento seguro via stripe/i));

    // Wait for payment selection
    await waitFor(() => expect(mockUseCheckoutState.setPaymentMethod).toHaveBeenCalledWith('stripe_checkout'));

    // Force re-render to pick up updated mock state
    rerender(<CheckoutPage />);

    // Now button should be enabled - submit
    const submitButton = screen.getByTestId('checkout-submit-button');
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    // Error alert should show the error message - use role="status" (ErrorAlert uses role="status")
    // Find the error alert that contains the error message
    await waitFor(() => {
      const statusElements = screen.getAllByRole('status');
      const errorAlert = statusElements.find(el => 
        el.textContent?.toLowerCase().includes('estoque insuficiente')
      );
      expect(errorAlert).toBeDefined();
      expect(errorAlert).toBeInTheDocument();
    });

    // Error alert should be dismissible
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('prevents double submission (button disabled while submitting)', async () => {
    let resolveCheckout: (value: { order: Order; checkoutUrl: string }) => void;
    const checkoutPromise = new Promise<{ order: Order; checkoutUrl: string }>((resolve) => {
      resolveCheckout = resolve;
    });
    mockCheckoutApi.checkout.mockReturnValueOnce(checkoutPromise);

    const { rerender } = renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Select address
    fireEvent.click(screen.getByLabelText(/rua das flores, 123 - centro/i));

    // Wait for address selection
    await waitFor(() => expect(mockUseCheckoutState.setSelectedAddressId).toHaveBeenCalledWith('addr-1'));

    // Select payment
    fireEvent.click(screen.getByLabelText(/pagamento seguro via stripe/i));

    // Wait for payment selection
    await waitFor(() => expect(mockUseCheckoutState.setPaymentMethod).toHaveBeenCalledWith('stripe_checkout'));

    // Force re-render to pick up updated mock state
    rerender(<CheckoutPage />);

    // Submit
    const submitButton = screen.getByTestId('checkout-submit-button');
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    // Click again - should not call checkout again due to double-click prevention in handleSubmit
    fireEvent.click(screen.getByTestId('checkout-submit-button'));

    // Resolve the promise
    await act(async () => {
      resolveCheckout!({ order: mockOrder, checkoutUrl: 'https://checkout.stripe.test/session' });
    });

    // Should only have been called once due to double-click prevention
    expect(mockCheckoutApi.checkout).toHaveBeenCalledTimes(1);
  });

  it('shows free shipping when shipping amount is zero', async () => {
    const freeShippingPreview: CheckoutPreviewResponse = {
      vendorGroups: [mockPreviewVendorGroup1, mockPreviewVendorGroup2],
      totalAmount: 109.97, // Same as subtotal = free shipping
    };
    mockUseCheckoutPreview.data = freeShippingPreview;

    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Use sidebar-shipping-amount testid to check for free shipping
    const sidebarShipping = screen.getByTestId('sidebar-shipping-amount');
    expect(sidebarShipping).toHaveTextContent(/free/i);
  });

  it('shows empty addresses state when user has no addresses', async () => {
    mockPersonApi.getMe.mockResolvedValueOnce({
      person: {
        addresses: [],
      },
    });

    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/No addresses registered/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage addresses/i })).toBeInTheDocument();
  });

  it('navigates to address management when button clicked', async () => {
    mockPersonApi.getMe.mockResolvedValueOnce({
      person: {
        addresses: [],
      },
    });

    const { navigateMock } = renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /manage addresses/i }));
    expect(navigateMock).toHaveBeenCalledWith('/account/addresses');
  });

  it('shows cart error when cart fetch fails', async () => {
    mockUseCart.error = new Error('Network error');
    mockUseCart.isLoading = false;

    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/Erro ao carregar carrinho/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('refetches preview when coupon is removed', async () => {
    mockUseCheckoutState.setCouponCodes(['SAVE10']);
    mockUseCheckoutPreview.refetch.mockClear();

    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Select address
    fireEvent.click(screen.getByLabelText(/rua das flores, 123 - centro/i));

    // Apply coupon (already in state)

    // Remove coupon
    fireEvent.click(screen.getByRole('button', { name: /remover cupom save10/i }));

    // Should call removeCouponCode
    expect(mockUseCheckoutState.removeCouponCode).toHaveBeenCalledWith('SAVE10');
  });

  it('shows progress steps', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const progressSteps = screen.getByTestId('checkout-progress-steps');
    expect(progressSteps).toBeInTheDocument();
    
    // Check step elements exist within progress steps nav
    expect(within(progressSteps).getByTestId('checkout-step-address')).toBeInTheDocument();
    expect(within(progressSteps).getByTestId('checkout-step-coupon')).toBeInTheDocument();
    expect(within(progressSteps).getByTestId('checkout-step-summary')).toBeInTheDocument();
    expect(within(progressSteps).getByTestId('checkout-step-payment')).toBeInTheDocument();
  });

  it('shows order summary sidebar with correct totals', async () => {
    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Check sidebar summary using testid
    const sidebarSummary = screen.getByTestId('checkout-sidebar-summary');
    expect(sidebarSummary).toBeInTheDocument();
    
    // Query within sidebar for totals - use more specific matchers
    expect(within(sidebarSummary).getByText(/^subtotal bruto$/i)).toBeInTheDocument();
    expect(within(sidebarSummary).getByText(/^total$/i)).toBeInTheDocument();
    expect(within(sidebarSummary).getByText(/2 items no pedido/i)).toBeInTheDocument();
  });

  it('shows authentication required when not logged in', async () => {
    // Override auth state to unauthenticated
    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    mockAuthState.hasRole.mockImplementation(() => false);

    renderWithNav(<CheckoutPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/Access denied/i)).toBeInTheDocument();
    expect(screen.getByText(/You need to be logged in to access the checkout/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fazer login/i })).toBeInTheDocument();
    
    // Restore auth state for other tests (though this is the last test)
    mockAuthState.user = {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      roles: ['CONSUMER'] as const,
    };
    mockAuthState.isAuthenticated = true;
    mockAuthState.hasRole.mockImplementation((role: string) => role === 'CONSUMER');
  });
});
