import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Navigation } from './Navigation';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';

vi.mock('@/app/providers/authStore', () => ({
  useAuthStore: vi.fn()
}));

const mockUseAuthStore = vi.mocked(useAuthStore);

const renderWithProvider = (component: React.ReactNode, initialEntries: string[] = ['/']) => {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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

describe('Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue(createMockStore());
  });

  it('shows Login and Register links when unauthenticated', () => {
    renderWithProvider(<Navigation />);

    expect(screen.getByRole('menuitem', { name: /login/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /register/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /browse products/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /logout/i })).not.toBeInTheDocument();
  });

  it('shows loading skeleton while auth initializes', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({ isLoading: true }));

    renderWithProvider(<Navigation />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows Browse Products for authenticated CONSUMER', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'CONSUMER')
    }));

    renderWithProvider(<Navigation />);

    expect(screen.getByRole('menuitem', { name: /browse products/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /vendor dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /vendor products/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /admin dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /admin users/i })).not.toBeInTheDocument();
  });

  it('shows Vendor Dashboard and Vendor Products for VENDOR role', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'Jane', email: 'jane@example.com', roles: ['VENDOR'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'VENDOR')
    }));

    renderWithProvider(<Navigation />);

    expect(screen.getByRole('menuitem', { name: /browse products/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /vendor dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /vendor products/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /admin dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /admin users/i })).not.toBeInTheDocument();
  });

  it('shows Admin Dashboard and Admin Users for ADMIN role', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'Admin', email: 'admin@example.com', roles: ['ADMIN'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'ADMIN')
    }));

    renderWithProvider(<Navigation />);

    expect(screen.getByRole('menuitem', { name: /browse products/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /admin dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /admin users/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /vendor dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /vendor products/i })).not.toBeInTheDocument();
  });

  it('shows both Vendor and Admin links when user has both roles', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'Super', email: 'super@example.com', roles: ['VENDOR', 'ADMIN'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => ['VENDOR', 'ADMIN'].includes(role))
    }));

    renderWithProvider(<Navigation />);

    expect(screen.getByRole('menuitem', { name: /browse products/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /vendor dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /vendor products/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /admin dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /admin users/i })).toBeInTheDocument();
  });

  it('shows user name, roles, and logout button when authenticated', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'CONSUMER')
    }));

    renderWithProvider(<Navigation />);

    expect(screen.getByText(/john \(consumer\)/i)).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /logout/i })).toBeInTheDocument();
  });

  it('highlights active link for current route', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'Jane', email: 'jane@example.com', roles: ['VENDOR'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'VENDOR')
    }));

    renderWithProvider(<Navigation />, ['/vendor/dashboard']);

    const vendorDashboardLink = screen.getByRole('menuitem', { name: /vendor dashboard/i });
    expect(vendorDashboardLink).toHaveClass('bg-green-100');
    expect(vendorDashboardLink).toHaveClass('text-green-700');
  });

  it('has accessible markup with nav, ul, li, and proper ARIA roles', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      isAuthenticated: true,
      hasRole: vi.fn((role) => role === 'CONSUMER')
    }));

    renderWithProvider(<Navigation />);

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('aria-label', 'Main navigation');

    const menubar = screen.getByRole('menubar');
    expect(menubar).toBeInTheDocument();

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBeGreaterThan(0);
  });

  it('home link navigates to root path', () => {
    mockUseAuthStore.mockReturnValue(createMockStore({
      isAuthenticated: false
    }));

    renderWithProvider(<Navigation />);

    const homeLink = screen.getByRole('link', { name: /fs-01 marketplace home/i });
    expect(homeLink).toHaveAttribute('href', '/');
  });
});