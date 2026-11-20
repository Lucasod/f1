import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';
import { VendorDashboard } from './VendorDashboard';
import { productApi, Product } from '@/shared/api/product';
import { vendorApi, Vendor, VendorApiException } from '@/shared/api/vendor';
import { financialApi } from '@/shared/api/financial';
import { orderApi } from '@/shared/api/order';

// Mock the API modules
vi.mock('@/shared/api/product', () => ({
  productApi: {
    getMyProducts: vi.fn(),
  },
}));

vi.mock('@/shared/api/vendor', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    vendorApi: {
      getMe: vi.fn(),
    },
  };
});

vi.mock('@/shared/api/financial', () => ({
  financialApi: {
    getVendorDashboard: vi.fn(),
  },
}));

vi.mock('@/shared/api/order', () => ({
  orderApi: {
    getVendorOrderGroups: vi.fn(),
  },
}));

const mockGetMyProducts = vi.mocked(productApi.getMyProducts);
const mockGetMe = vi.mocked(vendorApi.getMe);
const mockGetVendorDashboard = vi.mocked(financialApi.getVendorDashboard);
const mockGetVendorOrderGroups = vi.mocked(orderApi.getVendorOrderGroups);

// Mock AuthStore
vi.mock('@/app/providers/authStore', () => ({
  useAuthStore: vi.fn()
}));

const mockUseAuthStore = vi.mocked(useAuthStore);

const mockUser = {
  id: 'person-123',
  name: 'Test Vendor',
  email: 'vendor@test.com',
  roles: ['VENDOR'] as const,
};

const createMockStore = (overrides: Partial<ReturnType<typeof useAuthStore>> = {}) => ({
  user: mockUser,
  accessToken: null,
  refreshToken: null,
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
  hasRole: vi.fn((role: string) => mockUser.roles.includes(role as 'VENDOR')),
  ...overrides,
});

const renderDashboard = () => {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <VendorDashboard />
      </AuthProvider>
    </BrowserRouter>
  );
};

// Test data
const mockVendor: Vendor = {
  id: 'vendor-123',
  personId: 'person-123',
  storeName: 'Test Store',
  slug: 'test-store',
  status: 'active',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockProducts = [
  {
    id: 'prod-1',
    vendorId: 'vendor-123',
    categoryId: 'cat-1',
    name: 'Product 1',
    description: 'Description 1',
    price: 99.99,
    quantity: 10,
    status: 'active' as const,
    images: ['/api/v1/uploads/products/vendor-123/prod-1/main.jpg'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'prod-2',
    vendorId: 'vendor-123',
    categoryId: 'cat-1',
    name: 'Product 2',
    description: 'Description 2',
    price: 149.99,
    quantity: 0,
    status: 'out_of_stock' as const,
    images: [],
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  },
];

describe('VendorDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue(createMockStore());
    mockGetMe.mockResolvedValue({ vendor: mockVendor });
    mockGetMyProducts.mockResolvedValue({ products: mockProducts });
    mockGetVendorDashboard.mockResolvedValue({
      grossSales: 1000,
      grossSalesLabel: 'pre-commission',
      netExpectedAmount: 900,
      receivedInStripe: 800,
      pendingDistribution: 100,
      bankPayout: 700,
      history: [],
    });
    mockGetVendorOrderGroups.mockResolvedValue({ vendorGroups: [], total: 0, page: 1, limit: 20 });
    localStorage.clear();
  });

  it('does not present unavailable financial data as zero', async () => {
    mockGetVendorDashboard.mockRejectedValue(new Error('Financial service unavailable'));
    renderDashboard();
    await screen.findByText('Test Store');
    await waitFor(() => expect(screen.getByText('Gross Sales').closest('.bg-white')).toHaveTextContent('Unavailable'));
    expect(screen.getByText('Net Expected').closest('.bg-white')).toHaveTextContent('Unavailable');
  });

  it('does not present unverified distribution totals as reliable balances', async () => {
    renderDashboard();
    await screen.findByText('Test Store');
    await waitFor(() => expect(screen.getByText('Gross Sales').closest('.bg-white')).toHaveTextContent('1.000,00'));
    expect(screen.getByText('Received').closest('.bg-white')).toHaveTextContent('R$ 800,00');
    expect(screen.getByText('Pending Distribution').closest('.bg-white')).toHaveTextContent('R$ 100,00');
  });

  it('keeps the latest period when financial requests resolve out of order', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof financialApi.getVendorDashboard>>) => void;
    const old = new Promise<Awaited<ReturnType<typeof financialApi.getVendorDashboard>>>(resolve => { resolveOld = resolve; });
    const latest = { grossSales: 200, grossSalesLabel: 'pre-commission', netExpectedAmount: 180, receivedInStripe: 0, pendingDistribution: 0, bankPayout: 0, history: [] };
    mockGetVendorDashboard.mockReset().mockReturnValueOnce(old).mockResolvedValueOnce(latest);
    renderDashboard();
    await screen.findByText('Test Store');
    await waitFor(() => expect(mockGetVendorDashboard).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7d' } });
    await waitFor(() => expect(screen.getByText('Gross Sales').closest('.bg-white')).toHaveTextContent('200,00'));
    await act(async () => { resolveOld({ ...latest, grossSales: 100 }); await old; });
    expect(screen.getByText('Gross Sales').closest('.bg-white')).toHaveTextContent('200,00');
  });

  it('should load vendor profile and products on mount', async () => {
    renderDashboard();

    // Should show loading initially
    expect(screen.getByRole('status')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Test Store')).toBeInTheDocument();
    expect(screen.getByText('Product 1')).toBeInTheDocument();
    expect(screen.getByText('Product 2')).toBeInTheDocument();
  });

  it('should display metrics: total products, active, out of stock', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/total products/i)).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument(); // Total count
    });

    // Find the "Active" metric card and verify its count
    const activeCard = screen.getByText('Active', { selector: 'p' }).closest('.bg-white');
    expect(activeCard).toHaveTextContent('1');

    // Find the "Out of Stock" metric card and verify its count
    const outOfStockCard = screen.getByText('Out of Stock', { selector: 'p' }).closest('.bg-white');
    expect(outOfStockCard).toHaveTextContent('1');
  });

  it('should display product list with name, price, status, stock', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Product 1')).toBeInTheDocument();
      expect(screen.getByText('R$ 99,99')).toBeInTheDocument();
      // Product 1 status badge (Active) - span inside td
      expect(screen.getByText('Active', { selector: 'span' })).toBeInTheDocument();
      expect(screen.getByText('10 units')).toBeInTheDocument();

      expect(screen.getByText('Product 2')).toBeInTheDocument();
      expect(screen.getByText('R$ 149,99')).toBeInTheDocument();
      // Product 2 status badge (Out of Stock) - span inside td
      expect(screen.getByText('Out of Stock', { selector: 'span' })).toBeInTheDocument();
      expect(screen.getByText('0 units')).toBeInTheDocument();
    });
  });

  it('should show empty state when vendor has no products', async () => {
    mockGetMyProducts.mockResolvedValue({ products: [] });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/no products yet/i)).toBeInTheDocument();
    });
  });

  it('should handle loading state', async () => {
    let resolveProducts: (value: { products: Product[] }) => void;
    const productsPromise = new Promise<{ products: Product[] }>(resolve => { resolveProducts = resolve; });
    mockGetMyProducts.mockReturnValue(productsPromise);

    renderDashboard();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    await act(async () => {
      resolveProducts!({ products: mockProducts });
    });

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('should handle API error gracefully', async () => {
    mockGetMyProducts.mockRejectedValue(new VendorApiException('API Error', 500));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/error loading dashboard/i)).toBeInTheDocument();
    });
  });

  it('should have add product button', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /add product/i })).toBeInTheDocument();
    });
  });
});
