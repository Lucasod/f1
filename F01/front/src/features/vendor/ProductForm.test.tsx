import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { ProductForm } from './ProductForm';
import { productApi } from '@/shared/api/product';

// Mock APIs - use vi.fn() inline to avoid hoisting issues
vi.mock('@/shared/api/product', () => ({
  productApi: {
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    uploadImage: vi.fn(),
    uploadImages: vi.fn(),
    deleteImage: vi.fn(),
  },
}));

// Get properly typed mocks using vi.mocked
const mockedProductApi = vi.mocked(productApi);

vi.mock('@/app/providers/AuthProvider', async () => {
  const actual = await vi.importActual('@/app/providers/AuthProvider');
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'person-123', name: 'Test Vendor', email: 'vendor@test.com', roles: ['VENDOR'] },
      isAuthenticated: true,
      hasRole: (role: string) => role === 'VENDOR',
      isLoading: false,
    }),
  };
});

const mockCategories = [
  { id: 'cat-1', name: 'Electronics', slug: 'electronics', path: '/electronics/', parentId: null, createdAt: '', updatedAt: '' },
  { id: 'cat-2', name: 'Clothing', slug: 'clothing', path: '/clothing/', parentId: null, createdAt: '', updatedAt: '' },
];

const mockProduct = {
  id: 'prod-1',
  vendorId: 'vendor-123',
  categoryId: 'cat-1',
  name: 'Existing Product',
  description: 'Existing description',
  price: 199.99,
  quantity: 5,
  status: 'active' as const,
  images: ['/api/v1/uploads/products/vendor-123/prod-1/main.jpg'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const setupFetchMock = () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ categories: mockCategories }),
  });
};

const renderForm = (initialPath = '/vendor/products/new') => {
  setupFetchMock();
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/vendor/products/new" element={<ProductForm />} />
          <Route path="/vendor/products/:productId/edit" element={<ProductForm />} />
          <Route path="/vendor/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
};

describe('ProductForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedProductApi.create.mockResolvedValue({ product: { ...mockProduct, id: 'new-prod' } });
    mockedProductApi.update.mockResolvedValue({ product: mockProduct });
    mockedProductApi.uploadImage.mockResolvedValue({ image: { key: 'test-key', url: '/api/v1/uploads/test.jpg' } });
    mockedProductApi.deleteImage.mockResolvedValue(undefined);
  });

  describe('Create Mode', () => {
    it('should render form with all required fields', () => {
      renderForm('/vendor/products/new');
      
      expect(screen.getByLabelText(/product name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/stock quantity/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
      // There are two cancel buttons - one in header, one in footer
      expect(screen.getAllByRole('button', { name: /cancel/i })).toHaveLength(2);
    });

    it('should show validation errors for empty required fields', async () => {
      renderForm('/vendor/products/new');
      
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      
      expect(screen.getByText(/name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/description is required/i)).toBeInTheDocument();
      expect(screen.getByText(/price must be positive/i)).toBeInTheDocument();
      expect(screen.getByText(/quantity must be a non-negative integer/i)).toBeInTheDocument();
      expect(screen.getByText(/category is required/i)).toBeInTheDocument();
    });

    it('should validate price is positive', async () => {
      renderForm('/vendor/products/new');
      
      // Fill required fields first
      await userEvent.type(screen.getByLabelText(/product name/i), 'Test Product');
      await userEvent.type(screen.getByLabelText(/description/i), 'Test description');
      await userEvent.selectOptions(screen.getByLabelText(/category/i), 'cat-1');
      await userEvent.type(screen.getByLabelText(/stock quantity/i), '10');
      
      // Set invalid price
      const priceInput = screen.getByLabelText(/price/i);
      await userEvent.clear(priceInput);
      await userEvent.type(priceInput, '-10');
      
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      
      expect(screen.getByText(/price must be positive/i)).toBeInTheDocument();
    });

    it('should validate quantity is non-negative integer', async () => {
      renderForm('/vendor/products/new');
      
      // Fill required fields first
      await userEvent.type(screen.getByLabelText(/product name/i), 'Test Product');
      await userEvent.type(screen.getByLabelText(/description/i), 'Test description');
      await userEvent.selectOptions(screen.getByLabelText(/category/i), 'cat-1');
      await userEvent.type(screen.getByLabelText(/price/i), '99.99');
      
      // Set invalid quantity
      const qtyInput = screen.getByLabelText(/stock quantity/i);
      await userEvent.clear(qtyInput);
      await userEvent.type(qtyInput, '-5');
      
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      
      expect(screen.getByText(/quantity must be a non-negative integer/i)).toBeInTheDocument();
    });

    it('should create product successfully', async () => {
      renderForm('/vendor/products/new');
      
      await userEvent.type(screen.getByLabelText(/product name/i), 'New Product');
      await userEvent.type(screen.getByLabelText(/description/i), 'New description');
      await userEvent.type(screen.getByLabelText(/price/i), '99.99');
      await userEvent.type(screen.getByLabelText(/stock quantity/i), '10');
      await userEvent.selectOptions(screen.getByLabelText(/category/i), 'cat-1');
      
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      
      await waitFor(() => {
        expect(mockedProductApi.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'New Product',
            description: 'New description',
            price: 99.99,
            quantity: 10,
            categoryId: 'cat-1',
          })
        );
      });
    });

    it('should allow image upload after product creation', async () => {
      renderForm('/vendor/products/new');
      
      await userEvent.type(screen.getByLabelText(/product name/i), 'New Product');
      await userEvent.type(screen.getByLabelText(/description/i), 'New description');
      await userEvent.type(screen.getByLabelText(/price/i), '99.99');
      await userEvent.type(screen.getByLabelText(/stock quantity/i), '10');
      await userEvent.selectOptions(screen.getByLabelText(/category/i), 'cat-1');
      
      await userEvent.click(screen.getByRole('button', { name: /save/i }));
      
      await waitFor(() => {
        expect(mockedProductApi.create).toHaveBeenCalled();
      });
    });
  });

  describe('Edit Mode', () => {
    it('should pre-fill form with existing product data', async () => {
      mockedProductApi.getById.mockResolvedValue({ product: mockProduct });
      
      renderForm('/vendor/products/prod-1/edit');
      
      await waitFor(() => {
        expect(screen.getByLabelText(/product name/i)).toHaveValue('Existing Product');
        expect(screen.getByLabelText(/description/i)).toHaveValue('Existing description');
        expect(screen.getByLabelText(/price/i)).toHaveValue(199.99);
        expect(screen.getByLabelText(/stock quantity/i)).toHaveValue(5);
        expect(screen.getByLabelText(/category/i)).toHaveValue('cat-1');
      });
      
      // Should show existing image with new alt text format
      expect(screen.getByAltText('Existing Product image 1')).toBeInTheDocument();
    });

    it('should update product successfully', async () => {
      mockedProductApi.getById.mockResolvedValue({ product: mockProduct });
      
      renderForm('/vendor/products/prod-1/edit');
      
      await waitFor(() => {
        expect(screen.getByLabelText(/product name/i)).toHaveValue('Existing Product');
      });
      
      await userEvent.clear(screen.getByLabelText(/product name/i));
      await userEvent.type(screen.getByLabelText(/product name/i), 'Updated Product');
      
      // Click the save button in the form footer (second one)
      const saveButtons = screen.getAllByRole('button', { name: /save/i });
      await userEvent.click(saveButtons[saveButtons.length - 1]);
      
      await waitFor(() => {
        expect(mockedProductApi.update).toHaveBeenCalledWith('prod-1', expect.objectContaining({
          name: 'Updated Product',
        }));
      });
    });

    it('should allow removing existing image', async () => {
      mockedProductApi.getById.mockResolvedValue({ product: mockProduct });
      
      renderForm('/vendor/products/prod-1/edit');
      
      await waitFor(() => {
        expect(screen.getByAltText('Existing Product image 1')).toBeInTheDocument();
      });
      
      // New remove button uses aria-label
      await userEvent.click(screen.getByRole('button', { name: /remove image 1/i }));
      
      await waitFor(() => {
        expect(screen.queryByAltText('Existing Product image 1')).not.toBeInTheDocument();
      });
    });
  });
});