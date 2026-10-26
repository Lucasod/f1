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

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthStore.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshAccessToken: vi.fn(),
      hasRole: vi.fn(),
      clearError: vi.fn(),
      initializeAuth: vi.fn()
    });
  });

  it('renders welcome message when not authenticated', () => {
    renderWithProvider(<HomePage />);

    expect(screen.getByText('Welcome to FS-01 Marketplace')).toBeInTheDocument();
    expect(screen.getByText('Your marketplace for buying and selling products.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /get started/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /login/i })).toHaveLength(2);
  });

  it('renders user dashboard when authenticated as consumer', () => {
    mockUseAuthStore.mockReturnValue({
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshAccessToken: vi.fn(),
      hasRole: vi.fn((role) => role === 'CONSUMER'),
      clearError: vi.fn(),
      initializeAuth: vi.fn()
    });

    renderWithProvider(<HomePage />);

    expect(screen.getByText('Welcome, John (CONSUMER)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /vendor dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /admin dashboard/i })).not.toBeInTheDocument();
  });

  it('renders vendor dashboard link when authenticated as vendor', () => {
    mockUseAuthStore.mockReturnValue({
      user: { id: '1', name: 'Jane', email: 'jane@example.com', roles: ['VENDOR'] },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshAccessToken: vi.fn(),
      hasRole: vi.fn((role) => role === 'VENDOR'),
      clearError: vi.fn(),
      initializeAuth: vi.fn()
    });

    renderWithProvider(<HomePage />);

    expect(screen.getByRole('link', { name: /vendor dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
  });

  it('renders only the admin dashboard link when authenticated as admin', () => {
    mockUseAuthStore.mockReturnValue({
      user: { id: '1', name: 'Admin', email: 'admin@example.com', roles: ['ADMIN'] },
      isAuthenticated: true,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refreshAccessToken: vi.fn(),
      hasRole: vi.fn((role) => role === 'ADMIN'),
      clearError: vi.fn(),
      initializeAuth: vi.fn()
    });

    renderWithProvider(<HomePage />);

    expect(screen.getByRole('link', { name: /admin dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /vendor dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse products/i })).toBeInTheDocument();
  });
});