import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';

const renderWithProviders = (
  component: React.ReactNode,
  outlet: React.ReactNode = <div data-testid="protected-content">Protected Content</div>
) => {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route path="/dashboard" element={component}>
            <Route index element={outlet} />
          </Route>
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

    renderWithProviders(<ProtectedRoute />);

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    renderWithProviders(<ProtectedRoute />);

    expect(screen.getByText(/login page/i)).toBeInTheDocument();
  });

  it('shows loading while auth initializes', () => {
    useAuthStore.setState({ isLoading: true });

    renderWithProviders(<ProtectedRoute />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('allows access when user has required role', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['VENDOR'] },
      accessToken: 'token'
    });

    renderWithProviders(
      <ProtectedRoute allowedRoles={['VENDOR', 'ADMIN']} />,
      <div data-testid="vendor-content">Vendor Dashboard</div>
    );

    expect(screen.getByTestId('vendor-content')).toBeInTheDocument();
  });

  it('redirects when user lacks required role', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      accessToken: 'token'
    });

    renderWithProviders(<ProtectedRoute allowedRoles={['VENDOR', 'ADMIN']} />);

    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });

  it('does not bypass an explicit role restriction for admin', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: '1', name: 'Admin', email: 'admin@example.com', roles: ['ADMIN'] },
      accessToken: 'token'
    });

    renderWithProviders(<ProtectedRoute allowedRoles={['VENDOR']} />);

    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });
});