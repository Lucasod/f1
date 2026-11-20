import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cartApi, Cart, CartItem, CartApiException } from '@/shared/api/cart';
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

vi.mock('@/shared/api/cart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/cart')>()),
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
  name: 'Test Product 1',
  description: 'Product Description 1',
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
  name: 'Test Product 2',
  description: 'Product Description 2',
  price: 49.99,
  quantity: 5,
  status: 'active',
  images: [],
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
};

// Track navigation for testing
let navigateMock: ReturnType<typeof vi.fn>;

const createWrapper = (client?: QueryClient) => {
  const queryClient = client ?? new QueryClient({
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
const renderWithNav = (ui: React.ReactElement, client?: QueryClient) => {
  navigateMock = vi.fn();
  const wrapper = createWrapper(client);
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

  it.each([[404, 'PRODUCT_NOT_FOUND'], [409, 'PRODUCT_NOT_AVAILABLE'], [400, 'INVALID_QUANTITY'], [400, 'PRODUCT_ID_REQUIRED'], [400, 'GUEST_CART_ID_INVALID']])(
    'allows editing after a proven pre-write rejection %s %s and successful read', async (status, code) => {
      vi.mocked(cartApi.updateItemQuantity).mockRejectedValue(new CartApiException('rejected', status, code));
      renderWithNav(<CartPage />);
      const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
      fireEvent.change(input, { target: { value: '3' } });
      fireEvent.blur(input);
      expect(await screen.findByRole('alert')).toHaveTextContent(/rejected/i);
      expect(await screen.findByRole('button', { name: /proceed to checkout/i })).toBeEnabled();
      expect(cartApi.getCart).toHaveBeenCalledTimes(2);
      expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
    }
  );

  it.each([[400, 'PRODUCT_ID_REQUIRED'], [400, 'GUEST_CART_ID_INVALID']])(
    'allows editing after proven pre-write removal rejection %s %s', async (status, code) => {
      vi.mocked(cartApi.removeItem).mockRejectedValue(new CartApiException('rejected', status, code));
      renderWithNav(<CartPage />);
      fireEvent.click(await screen.findByRole('button', { name: /remove test product 1 from cart/i }));
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/removal was rejected/i);
      expect(await screen.findByRole('button', { name: /proceed to checkout/i })).toBeEnabled();
      expect(cartApi.getCart).toHaveBeenCalledTimes(2);
      expect(cartApi.removeItem).toHaveBeenCalledTimes(1);
    }
  );

  it.each([[400, 'UNHANDLED_ERROR'], [409, 'STOCK_INSUFFICIENT'], [409, 'CART_CONFLICT'], [400, 'PRODUCT_NOT_FOUND'], [500, 'INVALID_QUANTITY']])(
    'keeps an unproven update rejection %s %s unconfirmed', async (status, code) => {
      vi.mocked(cartApi.updateItemQuantity).mockRejectedValue(new CartApiException('rejected', status, code));
      renderWithNav(<CartPage />);
      const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
      fireEvent.change(input, { target: { value: '3' } });
      fireEvent.blur(input);
      expect(await screen.findByText(/cart unconfirmed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
      expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps checkout blocked when a definitive rejection is followed by a failed read', async () => {
    vi.mocked(cartApi.updateItemQuantity).mockRejectedValue(new CartApiException('rejected', 404, 'PRODUCT_NOT_FOUND'));
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: mockCart }).mockRejectedValue(new Error('Unavailable'));
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/cart unconfirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
    expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
  });

  it.each([[400, 'UNHANDLED_ERROR'], [409, 'STOCK_INSUFFICIENT'], [404, 'PRODUCT_NOT_FOUND'], [500, 'PRODUCT_NOT_AVAILABLE']])(
    'keeps an unproven delete rejection %s %s unconfirmed', async (status, code) => {
      vi.mocked(cartApi.removeItem).mockRejectedValue(new CartApiException('rejected', status, code));
      renderWithNav(<CartPage />);
      fireEvent.click(await screen.findByRole('button', { name: /remove test product 1 from cart/i }));
      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
      expect(await screen.findByText(/cart unconfirmed/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
      expect(cartApi.removeItem).toHaveBeenCalledTimes(1);
    }
  );

  it('checks the live quantity rather than a detached optimistic input after an old read', async () => {
    vi.mocked(cartApi.updateItemQuantity).mockResolvedValue({ cart: { ...mockCart, items: [{ ...mockCartItem1, quantity: 3 }, mockCartItem2] } });
    renderWithNav(<CartPage />);
    const oldInput = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(oldInput, { target: { value: '3' } });
    fireEvent.blur(oldInput);
    await screen.findByRole('status');
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(oldInput).toHaveValue(3);
    expect(screen.getByRole('spinbutton', { name: /quantity of test product 1/i })).toHaveValue(2);
    expect(screen.getAllByText(/R\$\s*109,97/).length).toBeGreaterThan(0);
  });

  it('discards only drafts for externally removed items after a cart refetch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithNav(<CartPage />, client);
    const first = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    const second = await screen.findByRole('spinbutton', { name: /quantity of test product 2/i });
    fireEvent.change(first, { target: { value: '' } });
    fireEvent.blur(first);
    fireEvent.change(second, { target: { value: '3' } });
    vi.mocked(cartApi.getCart).mockResolvedValue({ cart: { ...mockCart, items: [mockCartItem2] } });
    await act(async () => { await client.refetchQueries({ queryKey: ['cart'] }); });
    await waitFor(() => expect(screen.queryByRole('spinbutton', { name: /quantity of test product 1/i })).not.toBeInTheDocument());
    const remaining = await screen.findByRole('spinbutton', { name: /quantity of test product 2/i });
    expect(remaining).toHaveValue(3);
    expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeDisabled();
    fireEvent.keyDown(remaining, { key: 'Escape' });
    expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeEnabled();
    expect(cartApi.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('shows processing rather than a retryable error while a mutation is pending', async () => {
    let resolveUpdate!: (value: { cart: Cart }) => void;
    vi.mocked(cartApi.updateItemQuantity).mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve; }));
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('status')).toHaveTextContent(/processing/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    await act(async () => resolveUpdate({ cart: mockCart }));
    expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
  });

  it('does not treat a read after an ambiguous write as proof of completion', async () => {
    vi.mocked(cartApi.updateItemQuantity).mockRejectedValue(new Error('Network failure'));
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/cart unconfirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
  });

  it('serializes a read retry after a confirmed write and failed retrieval', async () => {
    let resolveRead!: (value: { cart: Cart }) => void;
    vi.mocked(cartApi.updateItemQuantity).mockResolvedValue({ cart: mockCart });
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: mockCart })
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    await screen.findByText(/cart unconfirmed/i);
    const retry = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(await screen.findByRole('status')).toHaveTextContent(/processing/i);
    expect(cartApi.getCart).toHaveBeenCalledTimes(3);
    await act(async () => resolveRead({ cart: mockCart }));
    expect(await screen.findByRole('button', { name: /proceed to checkout/i })).toBeEnabled();
    expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
  });

  it('shows loading state initially', () => {
    renderWithNav(<CartPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading cart/i)).toBeInTheDocument();
  });

  it('shows error state when cart fetch fails with retry button', async () => {
    vi.mocked(cartApi.getCart).mockRejectedValueOnce(new Error('Network error'));

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.getByText(/cart unavailable/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows empty cart state when cart is empty', async () => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: { ...mockCart, items: [] } });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText(/your cart is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue shopping/i })).toBeInTheDocument();
  });

  it('displays cart items when data loads', async () => {
    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // Wait for product details to load
    await waitFor(() => expect(screen.getByText('Test Product 1')).toBeInTheDocument());
    expect(screen.getByText('Test Product 2')).toBeInTheDocument();

    // Check quantities
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();

    // Check prices (unit prices)
    expect(screen.getByText(/R\$\s*29,99 \/ un/)).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*49,99 \/ un/)).toBeInTheDocument();

    // Check line totals
    expect(screen.getByText(/R\$\s*59,98/)).toBeInTheDocument(); // 2 * 29.99
    // Product 2 line total is also R$ 49.99 (1 * 49.99), same as unit price
    // So we verify by checking there are 2 elements with R$ 49.99 (unit price + line total)
    const price4999Elements = screen.getAllByText(/R\$\s*49,99/);
    expect(price4999Elements.length).toBeGreaterThanOrEqual(2);
  });

  it('updates quantity when input changes (debounced)', async () => {
    vi.mocked(cartApi.updateItemQuantity).mockResolvedValue({ cart: mockCart });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Test Product 1')).toBeInTheDocument());

    const quantityInput = screen.getByDisplayValue('2');

    // Change quantity
    await act(async () => {
      fireEvent.change(quantityInput, { target: { value: '3' } });
      fireEvent.blur(quantityInput);
    });

    // Wait for debounce (500ms) and mutation
    await waitFor(
      () => expect(cartApi.updateItemQuantity).toHaveBeenCalledWith('prod-1', { quantity: 3 }),
      { timeout: 1000 }
    );
  });

  it('does not display stale quantity and subtotal as confirmed when an update fails', async () => {
    vi.mocked(cartApi.updateItemQuantity).mockRejectedValue(new Error('Update failed'));
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    await screen.findByText(/could not confirm the update/i);
    expect(screen.queryByRole('spinbutton', { name: /quantity of test product 1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
  });

  it('shows the retrieved server quantity and subtotal after a successful update', async () => {
    let cart = mockCart;
    vi.mocked(cartApi.getCart).mockImplementation(async () => ({ cart }));
    vi.mocked(cartApi.updateItemQuantity).mockImplementation(async (productId, input) => {
      cart = { ...cart, items: cart.items.map((item) => item.productId === productId ? { ...item, quantity: input.quantity } : item) };
      return { cart };
    });
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: /quantity of test product 1/i })).toHaveValue(3));
    expect(screen.getAllByText(/R\$\s*139,96/).length).toBeGreaterThan(0);
  });

  it('removes item when remove button clicked and confirmed', async () => {
    vi.mocked(cartApi.removeItem).mockResolvedValue({
      cart: { ...mockCart, items: [mockCartItem2] },
    });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Test Product 1')).toBeInTheDocument());

    // Click remove button for first item
    const removeButton = screen.getByRole('button', { name: /remove test product 1 from cart/i });
    fireEvent.click(removeButton);

    // Confirm dialog should appear
    await waitFor(() => expect(screen.getByText(/are you sure you want to remove "test product 1" from your cart\?/i)).toBeInTheDocument());

    // Click confirm button in dialog (the one with "Remover" text that's not the item remove buttons)
    const confirmButton = screen.getByRole('button', { name: /^remove$/i });
    fireEvent.click(confirmButton);

    // Wait for mutation
    await waitFor(() => expect(cartApi.removeItem).toHaveBeenCalledWith('prod-1'));
  });

  it('shows order summary with correct totals', async () => {
    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Test Product 1')).toBeInTheDocument());

    // Check order summary section
    expect(screen.getByText(/order summary/i)).toBeInTheDocument();

    // Subtotal: 2 * 29.99 + 1 * 49.99 = 109.97
    expect(screen.getByText(/subtotal/i)).toBeInTheDocument();
    // Both subtotal and total show the same value, so we check for the text in the summary section
    const summarySection = screen.getByText(/order summary/i).closest('section') || document.body;
    expect(summarySection).toHaveTextContent(/R\$\s*109,97/);

    // Shipping
    expect(screen.getByText(/^shipping$/i)).toBeInTheDocument();
    expect(screen.getByText(/calculated at checkout/i)).toBeInTheDocument();

    // Total (same as subtotal in this case) - use the bold total label
    expect(screen.getByText(/^partial estimate excluding shipping$/i)).toBeInTheDocument();
  });

  it('checkout button is disabled when cart is empty', async () => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: { ...mockCart, items: [] } });

    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    // In empty cart, checkout button is not rendered, only "Continuar comprando"
    // The order summary sidebar is not shown for empty cart
    expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue shopping/i })).toBeInTheDocument();
  });

  it('checkout button navigates to checkout when clicked', async () => {
    const { navigateMock } = renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Test Product 1')).toBeInTheDocument());

    const checkoutButton = screen.getByRole('button', { name: /proceed to checkout/i });
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
    await waitFor(() => expect(screen.getByText('Test Product 1')).toBeInTheDocument());

    const quantityInput = screen.getByDisplayValue('2');

    // Try to set quantity higher than stock (2)
    await act(async () => {
      fireEvent.change(quantityInput, { target: { value: '5' } });
      fireEvent.blur(quantityInput);
    });

    // Should show error message
    await waitFor(() => expect(screen.getByText(/Stock: 2/i)).toBeInTheDocument());

    // Mutation should not be called
    expect(cartApi.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('allows multi-digit edits without intermediate requests and commits on Enter', async () => {
    vi.mocked(productApi.getById).mockImplementation(async (id) => ({ product: id === 'prod-1' ? { ...mockProduct1, quantity: 50 } : mockProduct2 }));
    vi.mocked(cartApi.updateItemQuantity).mockResolvedValue({ cart: mockCart });
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    input.focus();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '12' } });
    expect(input).toHaveValue(12);
    expect(cartApi.updateItemQuantity).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(cartApi.updateItemQuantity).toHaveBeenCalledWith('prod-1', { quantity: 12 }));
    expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
  });

  it('reconciles an ambiguous update and blocks checkout if retrieval fails', async () => {
    vi.mocked(cartApi.updateItemQuantity).mockRejectedValue(new Error('Network failure'));
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: mockCart }).mockRejectedValue(new Error('Unavailable'));
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.blur(input);
    await screen.findByText(/cart unconfirmed/i);
    expect(cartApi.getCart).toHaveBeenCalledTimes(2);
    expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
    vi.mocked(cartApi.getCart).mockResolvedValue({ cart: mockCart });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/cart unconfirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /proceed to checkout/i })).not.toBeInTheDocument();
    expect(cartApi.updateItemQuantity).toHaveBeenCalledTimes(1);
  });

  it('allows cancelling an invalid draft without sending an update', async () => {
    renderWithNav(<CartPage />);
    const input = await screen.findByRole('spinbutton', { name: /quantity of test product 1/i });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue(2);
    expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeEnabled();
    expect(cartApi.updateItemQuantity).not.toHaveBeenCalled();
  });

  it('reports and reconciles an ambiguous removal', async () => {
    vi.mocked(cartApi.removeItem).mockRejectedValue(new Error('Network failure'));
    renderWithNav(<CartPage />);
    fireEvent.click(await screen.findByRole('button', { name: /remove test product 1 from cart/i }));
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    await screen.findByText(/could not confirm the removal/i);
    await waitFor(() => expect(cartApi.getCart).toHaveBeenCalledTimes(2));
    expect(cartApi.removeItem).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(screen.getByText(/product not found/i)).toBeInTheDocument());
  });

  it('continues shopping button navigates to products', async () => {
    vi.mocked(cartApi.getCart).mockResolvedValueOnce({ cart: { ...mockCart, items: [] } });

    const { navigateMock } = renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    const continueButton = screen.getByRole('button', { name: /continue shopping/i });
    fireEvent.click(continueButton);

    // Should call navigate with /products
    expect(navigateMock).toHaveBeenCalledWith('/products');
  });

  it('shows remove confirmation dialog with correct item name', async () => {
    renderWithNav(<CartPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Test Product 1')).toBeInTheDocument());

    const removeButton = screen.getByRole('button', { name: /remove test product 1 from cart/i });
    fireEvent.click(removeButton);

    await waitFor(() => expect(screen.getByText(/remove item from cart/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/are you sure you want to remove "test product 1" from your cart\?/i)).toBeInTheDocument());

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    // Dialog should close
    await waitFor(() => expect(screen.queryByText(/remove item from cart/i)).not.toBeInTheDocument());
  });
});
