import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';
import { VendorDashboard } from './VendorDashboard';
import { productApi, Product } from '@/shared/api/product';
import { vendorApi, Vendor } from '@/shared/api/vendor';

// Mock the API modules
vi.mock('@/shared/api/product', () => ({
  productApi: {
    getMyProducts: vi.fn(),
  },
}));

vi.mock('@/shared/api/vendor', () => ({
  vendorApi: {
    getMe: vi.fn(),
  },
}));

const mockGetMyProducts = vi.mocked(productApi.getMyProducts);
const mockGetMe = vi.mocked(vendorApi.getMe);

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
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
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
    localStorage.clear();
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
    mockGetMyProducts.mockRejectedValue(new Error('API Error'));

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