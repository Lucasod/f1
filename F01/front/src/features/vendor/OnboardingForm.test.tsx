import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { OnboardingForm } from './OnboardingForm';
import { vendorApi, VendorApiException } from '@/shared/api/vendor';
import type { Vendor } from '@/shared/api/vendor';

// Mock APIs - use actual VendorApiException class for instanceof checks
vi.mock('@/shared/api/vendor', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    vendorApi: {
      getMe: vi.fn(),
      onboard: vi.fn(),
    },
  };
});

const mockedVendorApi = vi.mocked(vendorApi);

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

const createVendor = (overrides: Partial<Vendor> = {}): Vendor => ({
  id: 'vendor-123',
  personId: 'person-123',
  storeName: 'Test Store',
  slug: 'test-store',
  status: 'active' as const,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

const renderForm = (initialPath = '/vendor/onboard') => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/vendor/onboard" element={<OnboardingForm />} />
          <Route path="/vendor/dashboard" element={<div data-testid="dashboard">Dashboard</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
};

describe('OnboardingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedVendorApi.onboard.mockResolvedValue({
      vendor: createVendor(),
    });
  });

  describe('Loading State', () => {
    it('should show loading spinner while checking existing profile', () => {
      let resolveGetMe: (value: { vendor: Vendor } | PromiseLike<{ vendor: Vendor }>) => void;
      mockedVendorApi.getMe.mockImplementation(() => new Promise((resolve) => {
        resolveGetMe = resolve;
      }));

      renderForm();

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText(/checking existing profile/i)).toBeInTheDocument();

      // Resolve with 404 to allow form to render (no existing profile)
      resolveGetMe!({ vendor: null as any });
    });

    it('should redirect to dashboard if vendor already exists', async () => {
      mockedVendorApi.getMe.mockResolvedValue({
        vendor: createVendor({ storeName: 'Existing Store', slug: 'existing-store' }),
      });

      renderForm();

      await waitFor(() => {
        expect(screen.getByTestId('dashboard')).toBeInTheDocument();
      });
    });
  });

  describe('Form Rendering', () => {
    beforeEach(() => {
      mockedVendorApi.getMe.mockRejectedValue(
        new VendorApiException('Not Found', 404)
      );
    });

    it('should render form with correct fields and labels', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      expect(screen.getByPlaceholderText(/your store name/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/my-store/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create store/i })).toBeInTheDocument();
      expect(screen.getByText(/lowercase letters, numbers, and hyphens only/i)).toBeInTheDocument();
    });
  });

  describe('Validation', () => {
    beforeEach(() => {
      mockedVendorApi.getMe.mockRejectedValue(
        new VendorApiException('Not Found', 404)
      );
    });

    it('should show error for empty storeName on blur', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      await userEvent.click(storeNameInput);
      await userEvent.tab();

      expect(await screen.findByText(/store name is required/i)).toBeInTheDocument();
    });

    it('should show error for empty slug on blur', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const slugInput = screen.getByLabelText(/store slug/i);
      await userEvent.click(slugInput);
      await userEvent.tab();

      expect(await screen.findByText(/slug is required/i)).toBeInTheDocument();
    });

    it('should show error for invalid slug format (uppercase with special chars that survive lowercasing)', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const slugInput = screen.getByLabelText(/store slug/i);
      // Use special chars that remain invalid after lowercasing
      await userEvent.type(slugInput, 'My@Store!');
      await userEvent.tab();

      expect(await screen.findByText(/slug must contain only lowercase letters, numbers, and hyphens/i)).toBeInTheDocument();
    });

    it('should show error for invalid slug format (spaces)', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      // Fill storeName first so slug validation runs first
      const storeNameInput = screen.getByLabelText(/store name/i);
      const slugInput = screen.getByLabelText(/store slug/i);
      await userEvent.type(storeNameInput, 'Valid Store Name');
      // Use fireEvent.change to set value with space (userEvent.type doesn't handle spaces in jsdom)
      fireEvent.change(slugInput, { target: { value: 'my store' } });
      await userEvent.tab();

      expect(await screen.findByText(/slug must contain only lowercase letters, numbers, and hyphens/i)).toBeInTheDocument();
    });

    it('should show error for invalid slug format (special chars)', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const slugInput = screen.getByLabelText(/store slug/i);
      await userEvent.type(slugInput, 'my@store!');
      await userEvent.tab();

      expect(await screen.findByText(/slug must contain only lowercase letters, numbers, and hyphens/i)).toBeInTheDocument();
    });

    it('should show error for slug shorter than 2 characters', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const slugInput = screen.getByLabelText(/store slug/i);
      await userEvent.type(slugInput, 'a');
      await userEvent.tab();

      expect(await screen.findByText(/slug must be at least 2 characters/i)).toBeInTheDocument();
    });

    it('should show error for storeName shorter than 2 characters', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      await userEvent.type(storeNameInput, 'a');
      await userEvent.tab();

      expect(await screen.findByText(/store name must be at least 2 characters/i)).toBeInTheDocument();
    });

    it('should enable submit button when valid input is provided', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      const slugInput = screen.getByLabelText(/store slug/i);
      const submitButton = screen.getByRole('button', { name: /create store/i });

      // Initially submit button is enabled (no disabled state for empty form)
      expect(submitButton).not.toBeDisabled();

      await userEvent.type(storeNameInput, 'Valid Store');
      await userEvent.type(slugInput, 'valid-store');

      expect(submitButton).not.toBeDisabled();
    });

    it('should clear validation error when user types after error', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      await userEvent.click(storeNameInput);
      await userEvent.tab();

      await waitFor(() => {
        expect(screen.getByText(/store name is required/i)).toBeInTheDocument();
      });

      await userEvent.type(storeNameInput, 'Valid Store');

      expect(screen.queryByText(/store name is required/i)).not.toBeInTheDocument();
    });
  });

  describe('Submission', () => {
    beforeEach(() => {
      mockedVendorApi.getMe.mockRejectedValue(
        new VendorApiException('Not Found', 404)
      );
    });

    it('should call vendorApi.onboard with correct payload on valid submission', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      const slugInput = screen.getByLabelText(/store slug/i);
      const submitButton = screen.getByRole('button', { name: /create store/i });

      // Use fireEvent.change to set value with spaces (userEvent.type doesn't handle spaces in jsdom)
      fireEvent.change(storeNameInput, { target: { value: 'My Awesome Store' } });
      await userEvent.type(slugInput, 'my-awesome-store');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(mockedVendorApi.onboard).toHaveBeenCalledWith({
          storeName: 'My Awesome Store',
          slug: 'my-awesome-store',
        });
      });
    });

    it('should redirect to dashboard on successful onboarding', async () => {
      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      const slugInput = screen.getByLabelText(/store slug/i);
      const submitButton = screen.getByRole('button', { name: /create store/i });

      fireEvent.change(storeNameInput, { target: { value: 'My Awesome Store' } });
      await userEvent.type(slugInput, 'my-awesome-store');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('dashboard')).toBeInTheDocument();
      });
    });

    it('should show loading state during submission', async () => {
      // Make onboard slow to capture loading state
      let resolveOnboard: (value: { vendor: Vendor } | PromiseLike<{ vendor: Vendor }>) => void;
      mockedVendorApi.onboard.mockImplementation(() => new Promise((resolve) => {
        resolveOnboard = resolve;
      }));

      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      const slugInput = screen.getByLabelText(/store slug/i);
      const submitButton = screen.getByRole('button', { name: /create store/i });

      fireEvent.change(storeNameInput, { target: { value: 'My Awesome Store' } });
      await userEvent.type(slugInput, 'my-awesome-store');
      await userEvent.click(submitButton);

      // Should show loading spinner and disabled state - target button specifically
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /creating store.../i })).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /creating store.../i })).toBeDisabled();
      expect(storeNameInput).toBeDisabled();
      expect(slugInput).toBeDisabled();

      // Resolve to allow cleanup
      resolveOnboard!({
        vendor: createVendor({ storeName: 'My Awesome Store', slug: 'my-awesome-store' }),
      });
    });

    it('should display error message on submission failure', async () => {
      // Mock rejection with error code that mapBackendError recognizes
      mockedVendorApi.onboard.mockRejectedValue(
        new VendorApiException('Slug already taken', 400, 'SLUG_ALREADY_EXISTS')
      );

      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      const slugInput = screen.getByLabelText(/store slug/i);
      const submitButton = screen.getByRole('button', { name: /create store/i });

      fireEvent.change(storeNameInput, { target: { value: 'My Awesome Store' } });
      await userEvent.type(slugInput, 'my-awesome-store');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });
      expect(screen.getByText(/this store slug is already taken/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
    });

    it('should allow retry after dismissing error', async () => {
      // First call fails with recognized error code, second succeeds
      mockedVendorApi.onboard
        .mockRejectedValueOnce(
          new VendorApiException('Invalid slug format', 400, 'INVALID_SLUG_FORMAT')
        )
        .mockResolvedValueOnce({
          vendor: createVendor({ storeName: 'My Awesome Store', slug: 'my-awesome-store' }),
        });

      renderForm();

      await waitFor(() => {
        expect(screen.getByLabelText(/store name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/store slug/i)).toBeInTheDocument();
      });

      const storeNameInput = screen.getByLabelText(/store name/i);
      const slugInput = screen.getByLabelText(/store slug/i);
      const submitButton = screen.getByRole('button', { name: /create store/i });

      fireEvent.change(storeNameInput, { target: { value: 'My Awesome Store' } });
      await userEvent.type(slugInput, 'my-awesome-store');
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/slug must contain only lowercase letters, numbers, and hyphens/i)).toBeInTheDocument();
      });

      // Dismiss error
      await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

      expect(screen.queryByText(/slug must contain only lowercase letters, numbers, and hyphens/i)).not.toBeInTheDocument();

      // Try again
      await userEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('dashboard')).toBeInTheDocument();
      });
    });
  });
});