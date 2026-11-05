import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cartApi, Cart, CartItem } from '@/shared/api/cart';
import { productApi, Product } from '@/shared/api/product';
import { AuthProvider } from '@/app/providers/AuthProvider';
import React from 'react';

// Mock useDebounce before importing CartPage - use vi.hoisted to ensure it runs first
const { mockUseDebounce } = vi.hoisted(() => ({
  mockUseDebounce: <T,>(value: T): T => value,
}));

vi.mock('./CartPage', async () => {
  const actual = await vi.importActual('./CartPage');
  return {
    ...actual,
    useDebounce: mockUseDebounce,
  };
});

vi.mock('@/shared/api/cart', () => ({
  cartApi: {
    getCart: vi.fn(),
    addItem: vi.fn(),
    updateItemQuantity: vi.fn(),
    removeItem: vi.fn(),
    mergeGuestCart: vi.fn(),
  },
}));

vi.mock('@/shared/api/product', () => ({
  productApi: {
    getById: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Import after mocks are set up
import { CartPage } from './CartPage';

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

const mockProduct1: Product = {
  id: 'prod-1',
  vendorId: 'vendor-1',
  categoryId: 'cat-1',
  name: 'Produto Teste 1',
  description: 'Descrição do produto 1',
  price: 29.99,
  quantity: 10,
  status: 'active',
  images: ['products/vendor-1/prod-1/main.jpg'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockProduct2: Product = {
  id: 'prod-2',
  vendorId: 'vendor-2',
  categoryId: 'cat-2',
  name: 'Produto Teste 2',
  description: 'Descrição do produto 2',
  price: 49.99,
  quantity: 5,
  status: 'active',
  images: [],
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
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
        <MemoryRouter initialEntries={['/cart']}>
          {children}
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

describe('CartPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cartApi.getCart).mockResolvedValue({ cart: mockCart });
    vi.mocked(productApi.getById).mockImplementation((productId: string) => {
      if (productId === 'prod-1') return Promise.resolve({ product: mockProduct1 });
      if (productId === 'prod-2') return Promise.resolve({ product: mockProduct2 });
      throw new Error('Product not found');
    });
  });

  it('shows loading state initially', () => {
    renderWithNav(<CartPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/carregando carrinho/i)).toBeInTheDocument();
  });

  it('shows error state when cart fetch fails with retry button', async () => {
    vi.mocked(cartApi.getCart).mockRejectedValueOnce(new Error('Network error'));

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.getByText(/Erro ao carregar carrinho/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('shows empty cart state when cart is empty', async () => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: { ...mockCart, items: [] } });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/Your cart is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar comprando/i })).toBeInTheDocument();
  });

  it('displays cart items when data loads', async () => {
    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Wait for product details to load
    await waitFor(() => expect(screen.getByText('Produto Teste 1')).toBeInTheDocument());
    expect(screen.getByText('Produto Teste 2')).toBeInTheDocument();

    // Check quantities
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();

    // Check prices (unit prices)
    expect(screen.getByText(/R\$ 29,99 \/ un/)).toBeInTheDocument();
    expect(screen.getByText(/R\$ 49,99 \/ un/)).toBeInTheDocument();

    // Check line totals
    expect(screen.getByText(/R\$ 59,98/)).toBeInTheDocument(); // 2 * 29.99
    // Product 2 line total is also R$ 49,99 (1 * 49.99), same as unit price
    // So we verify by checking there are 2 elements with R$ 49,99 (unit price + line total)
    const price4999Elements = screen.getAllByText(/R\$ 49,99/);
    expect(price4999Elements.length).toBeGreaterThanOrEqual(2);
  });

  it('updates quantity when input changes (debounced)', async () => {
    vi.mocked(cartApi.updateItemQuantity).mockResolvedValue({ cart: mockCart });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Produto Teste 1')).toBeInTheDocument());

    const quantityInput = screen.getByDisplayValue('2');

    // Change quantity
    await act(async () => {
      fireEvent.change(quantityInput, { target: { value: '3' } });
    });

    // Wait for debounce (500ms) and mutation
    await waitFor(
      () => expect(cartApi.updateItemQuantity).toHaveBeenCalledWith('prod-1', { quantity: 3 }),
      { timeout: 1000 }
    );
  });

  it('removes item when remove button clicked and confirmed', async () => {
    vi.mocked(cartApi.removeItem).mockResolvedValue({
      cart: { ...mockCart, items: [mockCartItem2] },
    });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Produto Teste 1')).toBeInTheDocument());

    // Click remove button for first item
    const removeButton = screen.getByRole('button', { name: /remover produto teste 1 do carrinho/i });
    fireEvent.click(removeButton);

    // Confirm dialog should appear
    await waitFor(() => expect(screen.getByText(/tem certeza que deseja remover "produto teste 1" do carrinho\?/i)).toBeInTheDocument());

    // Click confirm button in dialog (the one with "Remover" text that's not the item remove buttons)
    const confirmButton = screen.getByRole('button', { name: /^remover$/i });
    fireEvent.click(confirmButton);

    // Wait for mutation
    await waitFor(() => expect(cartApi.removeItem).toHaveBeenCalledWith('prod-1'));
  });

  it('shows order summary with correct totals', async () => {
    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Produto Teste 1')).toBeInTheDocument());

    // Check order summary section
    expect(screen.getByText(/resumo do pedido/i)).toBeInTheDocument();

    // Subtotal: 2 * 29.99 + 1 * 49.99 = 109.97
    expect(screen.getByText(/subtotal/i)).toBeInTheDocument();
    // Both subtotal and total show the same value, so we check for the text in the summary section
    const summarySection = screen.getByText(/resumo do pedido/i).closest('section') || document.body;
    expect(summarySection).toHaveTextContent(/R\$ 109,97/);

    // Shipping
    expect(screen.getByText(/frete/i)).toBeInTheDocument();
    expect(screen.getByText(/calculado no checkout/i)).toBeInTheDocument();

    // Total (same as subtotal in this case) - use the bold total label
    expect(screen.getByText(/^total$/i)).toBeInTheDocument();
  });

  it('checkout button is disabled when cart is empty', async () => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: { ...mockCart, items: [] } });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // In empty cart, checkout button is not rendered, only "Continuar comprando"
    // The order summary sidebar is not shown for empty cart
    expect(screen.queryByRole('button', { name: /ir para o checkout/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar comprando/i })).toBeInTheDocument();
  });

  it('checkout button navigates to checkout when clicked', async () => {
    const { navigateMock } = renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Produto Teste 1')).toBeInTheDocument());

    const checkoutButton = screen.getByRole('button', { name: /ir para o checkout/i });
    expect(checkoutButton).not.toBeDisabled();

    fireEvent.click(checkoutButton);

    // Should call navigate with /checkout
    expect(navigateMock).toHaveBeenCalledWith('/checkout');
  });

  it('shows quantity error when exceeding stock', async () => {
    vi.mocked(productApi.getById).mockImplementation((productId: string) => {
      if (productId === 'prod-1') return Promise.resolve({ product: { ...mockProduct1, quantity: 2 } });
      if (productId === 'prod-2') return Promise.resolve({ product: mockProduct2 });
      throw new Error('Product not found');
    });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Produto Teste 1')).toBeInTheDocument());

    const quantityInput = screen.getByDisplayValue('2');

    // Try to set quantity higher than stock (2)
    await act(async () => {
      fireEvent.change(quantityInput, { target: { value: '5' } });
    });

    // Should show error message
    await waitFor(() => expect(screen.getByText(/Estoque: 2/i)).toBeInTheDocument());

    // Mutation should not be called
    expect(cartApi.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('shows product loading skeleton while product details load', async () => {
    // Slow product fetch
    vi.mocked(productApi.getById).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ product: mockProduct1 }), 100)));

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Should show skeleton while loading product - the skeleton is a div with animate-pulse class
    const loadingDivs = document.querySelectorAll('.animate-pulse');
    expect(loadingDivs.length).toBeGreaterThan(0);
  });

  it('shows product error when product not found', async () => {
    vi.mocked(productApi.getById).mockImplementation((productId: string) => {
      if (productId === 'prod-1') throw new Error('Product not found');
      return Promise.resolve({ product: mockProduct2 });
    });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/produto não encontrado/i)).toBeInTheDocument());
  });

  it('continues shopping button navigates to products', async () => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: { ...mockCart, items: [] } });

    const { navigateMock } = renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const continueButton = screen.getByRole('button', { name: /continuar comprando/i });
    fireEvent.click(continueButton);

    // Should call navigate with /products
    expect(navigateMock).toHaveBeenCalledWith('/products');
  });

  it('shows remove confirmation dialog with correct item name', async () => {
    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Produto Teste 1')).toBeInTheDocument());

    const removeButton = screen.getByRole('button', { name: /remover produto teste 1 do carrinho/i });
    fireEvent.click(removeButton);

    await waitFor(() => expect(screen.getByText(/remover item do carrinho/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/tem certeza que deseja remover "produto teste 1" do carrinho\?/i)).toBeInTheDocument());

    const cancelButton = screen.getByRole('button', { name: /cancelar/i });
    fireEvent.click(cancelButton);

    // Dialog should close
    await waitFor(() => expect(screen.queryByText(/remover item do carrinho/i)).not.toBeInTheDocument());
  });
});