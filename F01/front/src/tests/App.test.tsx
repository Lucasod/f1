import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../features/home/HomePage';
import { AuthProvider } from '../app/providers/AuthProvider';
import { useAuthStore } from '../app/providers/authStore';

vi.mock('../app/providers/authStore', () => ({
  useAuthStore: vi.fn()
}));

const mockUseAuthStore = vi.mocked(useAuthStore);

const renderWithProvider = (component: React.ReactNode) => {
  return render(
    <MemoryRouter>
      <AuthProvider>{component}</AuthProvider>
    </MemoryRouter>
  );
};

const createMockStore = (overrides: Partial<ReturnType<typeof useAuthStore>> = {}) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshAccessToken: vi.fn(),
  hasRole: vi.fn(() => false),
  clearError: vi.fn(),
  initializeAuth: vi.fn(),
  ...overrides
});

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue(createMockStore());
  });

  it('renders welcome message and call to action when not authenticated', () => {
    renderWithProvider(<HomePage />);

    expect(screen.getByRole('heading', { name: /discover products from independent sellers/i })).toBeInTheDocument();
    expect(screen.getByText(/browse a growing selection of products/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create account/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /login/i })).not.toBeInTheDocument();
  });

  it('renders same content regardless of auth state (navigation handled by Navigation component)', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'CONSUMER')
    }));

    renderWithProvider(<HomePage />);

    expect(screen.getByRole('heading', { name: /discover products from independent sellers/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /login/i })).not.toBeInTheDocument();
    // Navigation component handles role-based links, not HomePage
    expect(screen.queryByRole('link', { name: /vendor dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /admin dashboard/i })).not.toBeInTheDocument();
  });

  it('renders same content for vendor role', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'Jane', email: 'jane@example.com', roles: ['VENDOR'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'VENDOR')
    }));

    renderWithProvider(<HomePage />);

    expect(screen.getByRole('heading', { name: /discover products from independent sellers/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /vendor dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
  });

  it('renders same content for admin role', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'Admin', email: 'admin@example.com', roles: ['ADMIN'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'ADMIN')
    }));

    renderWithProvider(<HomePage />);

    expect(screen.getByRole('heading', { name: /discover products from independent sellers/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /admin dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
  });
});