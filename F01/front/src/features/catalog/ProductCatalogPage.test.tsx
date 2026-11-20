import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductCatalogPage } from './ProductCatalogPage';
import { productApi } from '@/shared/api/product';
import { ProductListResponse } from '@/shared/api/product';
import { AuthProvider } from '@/app/providers/AuthProvider';

vi.mock('@/shared/api/product', () => ({
  productApi: {
    list: vi.fn(),
  },
}));

const mockProductListResponse: ProductListResponse = {
  products: [
    {
      id: 'prod-1',
      vendorId: 'vendor-1',
      categoryId: 'cat-1',
      name: 'Product 1',
      description: 'Description 1',
      price: 10.00,
      quantity: 5,
      status: 'active',
      images: ['products/vendor-1/prod-1/main.jpg'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'prod-2',
      vendorId: 'vendor-1',
      categoryId: 'cat-2',
      name: 'Product 2',
      description: 'Description 2',
      price: 20.00,
      quantity: 10,
      status: 'active',
      images: [],
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
};

const mockCategories = [
  { id: 'cat-1', name: 'Electronics' },
  { id: 'cat-2', name: 'Clothing' },
];

vi.mock('@/features/catalog/useCategories', () => ({
  useCategories: () => ({
    data: { categories: mockCategories },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>
          {children}
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

describe('ProductCatalogPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(productApi.list).mockResolvedValue(mockProductListResponse);
  });

  it('shows loading state initially', () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });
    
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('displays product grid when data loads', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Product 2')).toBeInTheDocument();
    expect(screen.getByText('R$ 10,00')).toBeInTheDocument();
    expect(screen.getByText('R$ 20,00')).toBeInTheDocument();
  });

  it('shows in-stock badge for available products', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.getAllByText('In Stock').length).toBeGreaterThan(0);
  });

  it('shows out-of-stock badge for unavailable products', async () => {
    vi.mocked(productApi.list).mockResolvedValueOnce({
      ...mockProductListResponse,
      products: [
        { ...mockProductListResponse.products[0], quantity: 0, status: 'out_of_stock' as const },
      ],
    });

    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
  });

  it('displays product images', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const images = screen.getAllByAltText(/product/i);
    expect(images.length).toBe(2);
    expect(images[0]).toHaveAttribute('src', '/api/v1/uploads/products/vendor-1/prod-1/main.jpg');
    expect(images[1]).toHaveAttribute('src', '/placeholder-product.svg');
  });

  it('shows empty state when no products', async () => {
    vi.mocked(productApi.list).mockResolvedValueOnce({
      ...mockProductListResponse,
      products: [],
      total: 0,
    });

    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    expect(screen.getByText(/no products found/i)).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    vi.mocked(productApi.list).mockRejectedValueOnce(new Error('Network error'));

    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.getByText(/failed to load products/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders ProductFilters component', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    expect(screen.getByPlaceholderText(/search products/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sort by/i)).toBeInTheDocument();
  });

  it('filters products by category', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const categorySelect = screen.getByLabelText(/category/i);
    vi.mocked(productApi.list).mockResolvedValueOnce({
      ...mockProductListResponse,
      products: [mockProductListResponse.products[0]],
    });
    fireEvent.change(categorySelect, { target: { value: 'cat-1' } });

    await waitFor(() => expect(productApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ categoryId: 'cat-1' })
    ));
  });

  it('searches products by query', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const searchInput = screen.getByPlaceholderText(/search products/i);
    vi.mocked(productApi.list).mockResolvedValueOnce({
      ...mockProductListResponse,
      products: [mockProductListResponse.products[0]],
    });
    fireEvent.change(searchInput, { target: { value: 'laptop' } });

    await waitFor(() => expect(productApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'laptop' })
    ));
  });

  it('requests stock-first ordering by default before server pagination', async () => {
    render(<ProductCatalogPage />, { wrapper: createWrapper() });
    await waitFor(() => expect(productApi.list).toHaveBeenCalledWith(expect.objectContaining({ sortBy: 'stock_status', page: 1 })));
  });

  it('sorts products by selected option', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const sortSelect = screen.getByLabelText(/sort by/i);
    vi.mocked(productApi.list).mockResolvedValueOnce(mockProductListResponse);
    fireEvent.change(sortSelect, { target: { value: 'price_asc' } });

    await waitFor(() => expect(productApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'price_asc' })
    ));
  });

  it('sorts products by stock_status (in-stock first)', async () => {
    const wrapper = createWrapper();
    // Mock products with mixed stock status
    const mixedStockResponse: ProductListResponse = {
      ...mockProductListResponse,
      products: [
        { ...mockProductListResponse.products[0], id: 'prod-1', name: 'In Stock Product', quantity: 5 },
        { ...mockProductListResponse.products[1], id: 'prod-2', name: 'Out of Stock Product', quantity: 0 },
      ],
    };
    vi.mocked(productApi.list).mockResolvedValue(mixedStockResponse);
    
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    // Select stock_status sort option
    const sortSelect = screen.getByLabelText(/sort by/i);
    fireEvent.change(sortSelect, { target: { value: 'stock_status' } });

    await waitFor(() => {
      // In-stock product should appear first
      const productCards = screen.getAllByRole('article');
      expect(productCards[0]).toHaveTextContent('In Stock Product');
      expect(productCards[1]).toHaveTextContent('Out of Stock Product');
    });
  });

  it('has link to product detail page', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const productLink = screen.getByRole('link', { name: /product 1/i });
    expect(productLink).toHaveAttribute('href', '/products/prod-1');
  });

  it('displays total product count', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    // Target the visible product count text (not the sr-only aria-live region)
    // The visible text is in a <p> with class 'text-gray-600 mt-1'
    const productCountText = screen.getByText(/2 product/i, { 
      selector: 'p.text-gray-600' 
    });
    expect(productCountText).toBeInTheDocument();
  });

  it('has accessible main content area', async () => {
    const wrapper = createWrapper();
    render(<ProductCatalogPage />, { wrapper });

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
  });
});
