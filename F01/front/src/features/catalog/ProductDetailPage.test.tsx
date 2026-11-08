import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductDetailPage } from './ProductDetailPage';
import { productApi } from '@/shared/api/product';
import { cartApi } from '@/shared/api/cart';
import { Product } from '@/shared/api/product';
import { AuthProvider } from '@/app/providers/AuthProvider';
import React from 'react';

vi.mock('@/shared/api/product', () => ({
  productApi: {
    getById: vi.fn(),
  },
}));

vi.mock('@/shared/api/cart', () => ({
  cartApi: {
    addItem: vi.fn(),
  },
}));

// Mock product data
const mockProduct: Product = {
  id: 'prod-1',
  vendorId: 'vendor-1',
  categoryId: 'cat-1',
  name: 'Test Product',
  description: 'A detailed test product description',
  price: 29.99,
  quantity: 10,
  status: 'active',
  images: ['products/vendor-1/prod-1/main.jpg'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const createWrapper = (initialEntries: string[] = ['/products/prod-1']) => {
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

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/products/:productId" element={children} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

describe('ProductDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default successful product fetch
    vi.mocked(productApi.getById).mockResolvedValue({ product: mockProduct });
    vi.mocked(cartApi.addItem).mockResolvedValue({ 
      cart: { id: 'cart-1', items: [], version: 1, updatedAt: new Date().toISOString() } 
    });
  });

  it('shows loading state initially', () => {
    let resolvePromise: (value: { product: Product }) => void;
    const promise = new Promise<{ product: Product }>((resolve) => {
      resolvePromise = resolve;
    });
    vi.mocked(productApi.getById).mockReturnValue(promise);

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    // Spinner has nested status roles, get the first one
    expect(screen.getAllByRole('status')[0]).toBeInTheDocument();
    expect(screen.getByText(/loading product/i)).toBeInTheDocument();

    // Clean up
    resolvePromise!({ product: mockProduct });
  });

  it('shows error state when fetch fails with retry button', async () => {
    vi.mocked(productApi.getById).mockRejectedValueOnce(new Error('Network error'));

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.getByText(/failed to load product/i)).toBeInTheDocument());
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows not-found state when product is null', async () => {
    vi.mocked(productApi.getById).mockResolvedValue({ product: null as any });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.getByText(/product not found/i)).toBeInTheDocument());
    expect(screen.getByText(/the product you requested could not be found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse products/i })).toBeInTheDocument();
  });

  it('displays product name when data loads', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Test Product' })).toBeInTheDocument();
  });

  it('displays product price when data loads', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('R$ 29,99')).toBeInTheDocument();
  });

  it('displays stock status badge (in stock)', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('In Stock')).toBeInTheDocument();
  });

  it('displays stock status badge (out of stock)', async () => {
    const outOfStockProduct = { ...mockProduct, quantity: 0, status: 'out_of_stock' as const };
    vi.mocked(productApi.getById).mockResolvedValue({ product: outOfStockProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    // Badge appears first, then button - check the badge
    expect(screen.getAllByText('Out of Stock')[0]).toBeInTheDocument();
  });

  it('displays stock status badge (inactive)', async () => {
    const inactiveProduct = { ...mockProduct, status: 'inactive' as const };
    vi.mocked(productApi.getById).mockResolvedValue({ product: inactiveProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('displays stock status badge (discontinued)', async () => {
    const discontinuedProduct = { ...mockProduct, status: 'discontinued' as const };
    vi.mocked(productApi.getById).mockResolvedValue({ product: discontinuedProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('Discontinued')).toBeInTheDocument();
  });

  it.each(['inactive', 'discontinued'] as const)(
    'does not offer cart actions for a %s product with stock',
    async (status) => {
      vi.mocked(productApi.getById).mockResolvedValue({ product: { ...mockProduct, status } });
      render(<ProductDetailPage />, { wrapper: createWrapper() });

      const button = await screen.findByRole('button', { name: /unavailable/i });
      expect(button).toBeDisabled();
      expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toBeDisabled();
      fireEvent.click(button);
      expect(cartApi.addItem).not.toHaveBeenCalled();
    },
  );

  it('displays product image with correct src', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const img = screen.getByAltText('Test Product');
    expect(img).toHaveAttribute('src', '/api/v1/uploads/products/vendor-1/prod-1/main.jpg');
  });

  it('uses placeholder image when no images', async () => {
    const productNoImages = { ...mockProduct, images: [] };
    vi.mocked(productApi.getById).mockResolvedValue({ product: productNoImages });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const img = screen.getByAltText('Test Product');
    expect(img).toHaveAttribute('src', '/placeholder-product.svg');
  });

  it('quantity selector increments when plus button clicked', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();

    const incrementButton = screen.getByRole('button', { name: /increase quantity/i });
    fireEvent.click(incrementButton);

    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('quantity selector decrements when minus button clicked', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    // First increment to 2
    const incrementButton = screen.getByRole('button', { name: /increase quantity/i });
    fireEvent.click(incrementButton);
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();

    // Then decrement back to 1
    const decrementButton = screen.getByRole('button', { name: /decrease quantity/i });
    fireEvent.click(decrementButton);
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
  });

  it('quantity selector clamps to max quantity', async () => {
    const limitedProduct = { ...mockProduct, quantity: 3 };
    vi.mocked(productApi.getById).mockResolvedValue({ product: limitedProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    // Try to increment beyond max
    const incrementButton = screen.getByRole('button', { name: /increase quantity/i });
    fireEvent.click(incrementButton); // 2
    fireEvent.click(incrementButton); // 3
    fireEvent.click(incrementButton); // Should stay at 3
    
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  it('quantity selector input accepts manual change', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i });
    
    await act(async () => {
      fireEvent.change(quantityInput, { target: { value: '5' } });
    });
    
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  });

  it('quantity selector clamps manual input to max', async () => {
    const limitedProduct = { ...mockProduct, quantity: 3 };
    vi.mocked(productApi.getById).mockResolvedValue({ product: limitedProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    const quantityInput = screen.getByRole('spinbutton', { name: /quantity/i });
    
    await act(async () => {
      fireEvent.change(quantityInput, { target: { value: '10' } });
    });
    
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  it('add to cart button calls cartApi.addItem with correct data', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    await waitFor(() => expect(cartApi.addItem).toHaveBeenCalledWith({
      productId: 'prod-1',
      quantity: 1,
    }));
  });

  it('add to cart button uses current quantity', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    // Increase quantity to 3
    const incrementButton = screen.getByRole('button', { name: /increase quantity/i });
    fireEvent.click(incrementButton);
    fireEvent.click(incrementButton);
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    await waitFor(() => expect(cartApi.addItem).toHaveBeenCalledWith({
      productId: 'prod-1',
      quantity: 3,
    }));
  });

  it('add to cart button disabled when out of stock', async () => {
    const outOfStockProduct = { ...mockProduct, quantity: 0, status: 'out_of_stock' as const };
    vi.mocked(productApi.getById).mockResolvedValue({ product: outOfStockProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const outOfStockButton = screen.getByRole('button', { name: /out of stock/i });
    expect(outOfStockButton).toBeDisabled();
    
    // Click should not call addItem
    fireEvent.click(outOfStockButton);
    expect(cartApi.addItem).not.toHaveBeenCalled();
  });

  it('add to cart button shows "Added!" during mutation', async () => {
    let resolveAddItem: (value: { cart: { id: string; items: { productId: string; vendorId: string; quantity: number; unitPrice: number; addedAt: string }[]; version: number; updatedAt: string } }) => void;
    const addItemPromise = new Promise<{ cart: { id: string; items: { productId: string; vendorId: string; quantity: number; unitPrice: number; addedAt: string }[]; version: number; updatedAt: string } }>((resolve) => {
      resolveAddItem = resolve;
    });
    vi.mocked(cartApi.addItem).mockReturnValue(addItemPromise);

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    // During mutation, button should show "Adding..." (loading state)
    await waitFor(() => expect(screen.getByRole('button', { name: /adding/i })).toBeInTheDocument());
    
    // Resolve the mutation
    await act(async () => {
      resolveAddItem!({ cart: { id: 'cart-1', items: [], version: 1, updatedAt: new Date().toISOString() } });
    });

    // After mutation, button should show "Added!" for 2 seconds
    expect(screen.getByRole('button', { name: /added/i })).toBeInTheDocument();
  });

  it('shows "Back to Products" NavLink', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const backLink = screen.getByRole('link', { name: /back to products/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/products');
  });

  it('has accessible main content area', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });

  it('displays product description when available', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('A detailed test product description')).toBeInTheDocument();
  });

  it('does not show description section when empty', async () => {
    const productNoDescription = { ...mockProduct, description: '' };
    vi.mocked(productApi.getById).mockResolvedValue({ product: productNoDescription });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.queryByText('Description')).not.toBeInTheDocument();
  });

  it('displays vendor info', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.getByText(/sold by vendor id: vendor-1/i)).toBeInTheDocument();
  });

  it('shows max quantity hint when stock is low', async () => {
    const lowStockProduct = { ...mockProduct, quantity: 5 };
    vi.mocked(productApi.getById).mockResolvedValue({ product: lowStockProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.getByText('(max 5)')).toBeInTheDocument();
  });

  it('does not show max quantity hint when stock is high', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.queryByText('(max 10)')).not.toBeInTheDocument();
  });

  it('has thumbnail navigation when multiple images', async () => {
    const multiImageProduct = { 
      ...mockProduct, 
      images: [
        'products/vendor-1/prod-1/main.jpg',
        'products/vendor-1/prod-1/secondary.jpg',
      ] 
    };
    vi.mocked(productApi.getById).mockResolvedValue({ product: multiImageProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    // Main image
    expect(screen.getByAltText('Test Product')).toHaveAttribute('src', '/api/v1/uploads/products/vendor-1/prod-1/main.jpg');
    
    // Thumbnail buttons
    const thumbnails = screen.getAllByRole('button', { name: /select image/i });
    expect(thumbnails.length).toBe(2);
    
    // Click second thumbnail
    fireEvent.click(thumbnails[1]);
    expect(screen.getByAltText('Test Product')).toHaveAttribute('src', '/api/v1/uploads/products/vendor-1/prod-1/secondary.jpg');
  });

  it('shows image dots when multiple images', async () => {
    const multiImageProduct = { 
      ...mockProduct, 
      images: [
        'products/vendor-1/prod-1/main.jpg',
        'products/vendor-1/prod-1/secondary.jpg',
      ] 
    };
    vi.mocked(productApi.getById).mockResolvedValue({ product: multiImageProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const dots = screen.getAllByRole('button', { name: /view image/i });
    expect(dots.length).toBe(2);
  });

  it('handles image error by falling back to placeholder', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const img = screen.getByAltText('Test Product');
    fireEvent.error(img);
    
    // Should fallback to placeholder
    expect(img).toHaveAttribute('src', '/placeholder-product.svg');
  });

  it('displays product with correct price formatting for different prices', async () => {
    const expensiveProduct = { ...mockProduct, id: 'prod-2', price: 199.99 };
    vi.mocked(productApi.getById).mockResolvedValue({ product: expensiveProduct });

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.getByText('R$ 199,99')).toBeInTheDocument();
  });

  it('shows card with product details', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    // Check that product details card exists
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('R$ 29,99')).toBeInTheDocument();
    expect(screen.getByText('In Stock')).toBeInTheDocument();
  });

  it('add to cart button is not disabled when in stock', async () => {
    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    expect(addToCartButton).not.toBeDisabled();
  });

  it('handles add to cart mutation error gracefully', async () => {
    vi.mocked(cartApi.addItem).mockRejectedValueOnce(new Error('Failed to add to cart'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    // Wait for mutation to complete
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to add to cart:', expect.any(Error)));
    
    // Check that user-visible error message appears
    await waitFor(() => expect(screen.getByText(/failed to add to cart/i)).toBeInTheDocument());
    
    consoleError.mockRestore();
  });

  it('shows auth error message for 401/403 errors', async () => {
    const authError = new Error('Unauthorized');
    (authError as any).status = 401;
    vi.mocked(cartApi.addItem).mockRejectedValueOnce(authError);

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    await waitFor(() => expect(screen.getByText(/please log in to add items to your cart/i)).toBeInTheDocument());
  });

  it('shows stock conflict error message for 409 errors', async () => {
    const conflictError = new Error('Insufficient stock');
    (conflictError as any).status = 409;
    vi.mocked(cartApi.addItem).mockRejectedValueOnce(conflictError);

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    await waitFor(() => expect(screen.getByText(/insufficient stock/i)).toBeInTheDocument());
  });

  it('distinguishes an unavailable product from insufficient stock', async () => {
    const unavailableError = new Error('Product is not available');
    Object.assign(unavailableError, { status: 409, code: 'PRODUCT_NOT_AVAILABLE' });
    vi.mocked(cartApi.addItem).mockRejectedValueOnce(unavailableError);

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    await waitFor(() => expect(screen.getByText(/product is no longer available/i)).toBeInTheDocument());
    expect(screen.queryByText(/insufficient stock/i)).not.toBeInTheDocument();
  });

  it('shows server error message for 5xx errors', async () => {
    const serverError = new Error('Internal Server Error');
    (serverError as any).status = 500;
    vi.mocked(cartApi.addItem).mockRejectedValueOnce(serverError);

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    await waitFor(() => expect(screen.getByText(/server error/i)).toBeInTheDocument());
  });

  it('clears error message on new add to cart attempt', async () => {
    vi.mocked(cartApi.addItem).mockRejectedValueOnce(new Error('Failed to add to cart'));

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    await waitFor(() => expect(screen.getByText(/failed to add to cart/i)).toBeInTheDocument());

    // Reset mock to succeed
    vi.mocked(cartApi.addItem).mockResolvedValue({ 
      cart: { id: 'cart-1', items: [], version: 1, updatedAt: new Date().toISOString() } 
    });

    // Click again - error should clear
    fireEvent.click(addToCartButton);

    await waitFor(() => expect(screen.queryByText(/failed to add to cart/i)).not.toBeInTheDocument());
  });

  it('shows "Added!" message and clears it after timeout (race condition fix)', async () => {
    let resolveAddItem: (value: { cart: { id: string; items: { productId: string; vendorId: string; quantity: number; unitPrice: number; addedAt: string }[]; version: number; updatedAt: string } }) => void;
    const addItemPromise = new Promise<{ cart: { id: string; items: { productId: string; vendorId: string; quantity: number; unitPrice: number; addedAt: string }[]; version: number; updatedAt: string } }>((resolve) => {
      resolveAddItem = resolve;
    });
    vi.mocked(cartApi.addItem).mockReturnValue(addItemPromise);

    const wrapper = createWrapper();
    render(<ProductDetailPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const addToCartButton = screen.getByRole('button', { name: /add to cart/i });
    fireEvent.click(addToCartButton);

    // During mutation, button should show "Adding..." (loading state)
    await waitFor(() => expect(screen.getByRole('button', { name: /adding/i })).toBeInTheDocument());
    
    // Resolve the mutation
    await act(async () => {
      resolveAddItem!({ cart: { id: 'cart-1', items: [], version: 1, updatedAt: new Date().toISOString() } });
    });

    // After mutation, button should show "Added!" for 2 seconds
    expect(screen.getByRole('button', { name: /added/i })).toBeInTheDocument();

    // Start a new mutation before timeout - should reset "Added!" state
    const addItemPromise2 = new Promise<{ cart: { id: string; items: { productId: string; vendorId: string; quantity: number; unitPrice: number; addedAt: string }[]; version: number; updatedAt: string } }>((resolve) => {
      resolveAddItem = resolve;
    });
    vi.mocked(cartApi.addItem).mockReturnValue(addItemPromise2);

    fireEvent.click(addToCartButton);

    // Should show "Adding..." again, not "Added!"
    await waitFor(() => expect(screen.getByRole('button', { name: /adding/i })).toBeInTheDocument());
  });
});
