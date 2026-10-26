import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';

const renderWithProviders = (component: React.ReactNode, initialPath = '/') => {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="*" element={component} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
};

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null
    });
    localStorage.clear();
  });

  it('renders children when authenticated', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      accessToken: 'token'
    });

    renderWithProviders(
      <ProtectedRoute>
        <div data-testid="protected-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    renderWithProviders(
      <ProtectedRoute>
        <div data-testid="protected-content">Protected Content</div>
      </ProtectedRoute>,
      '/dashboard'
    );

    expect(screen.getByText(/redirecting to login/i)).toBeInTheDocument();
  });

  it('shows loading while auth initializes', () => {
    useAuthStore.setState({ isLoading: true });

    renderWithProviders(
      <ProtectedRoute>
        <div data-testid="protected-content">Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('allows access when user has required role', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['VENDOR'] },
      accessToken: 'token'
    });

    renderWithProviders(
      <ProtectedRoute allowedRoles={['VENDOR', 'ADMIN']}>
        <div data-testid="vendor-content">Vendor Dashboard</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('vendor-content')).toBeInTheDocument();
  });

  it('redirects when user lacks required role', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      accessToken: 'token'
    });

    renderWithProviders(
      <ProtectedRoute allowedRoles={['VENDOR', 'ADMIN']}>
        <div data-testid="vendor-content">Vendor Dashboard</div>
      </ProtectedRoute>
    );

    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });

  it('allows admin access to all routes', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '1', name: 'Admin', email: 'admin@example.com', roles: ['ADMIN'] },
      accessToken: 'token'
    });

    renderWithProviders(
      <ProtectedRoute allowedRoles={['VENDOR']}>
        <div data-testid="vendor-content">Vendor Dashboard</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('vendor-content')).toBeInTheDocument();
  });
});