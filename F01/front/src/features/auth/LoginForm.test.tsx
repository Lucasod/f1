import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LoginForm } from './LoginForm';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';
import { authApi, type AuthResponse } from '@/shared/api/auth';

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    login: vi.fn()
  }
}));

const mockLogin = vi.mocked(authApi.login);

const renderWithProvider = (component: React.ReactNode) => {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>{component}</AuthProvider>
    </MemoryRouter>
  );
};

describe('LoginForm', () => {
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

  it.each([
    { roles: ['CONSUMER'] as const, target: '/dashboard' },
    { roles: ['CONSUMER', 'VENDOR'] as const, target: '/vendor/dashboard' },
    { roles: ['ADMIN'] as const, target: '/admin/dashboard' },
  ])('opens the appropriate dashboard for $roles', async ({ roles, target }) => {
    mockLogin.mockResolvedValueOnce({ person: { id: '1', name: 'Test', email: 'test@example.com', roles: [...roles] }, tokens: { accessToken: crypto.randomUUID(), refreshToken: crypto.randomUUID() } });
    const Path = () => <span data-testid="current-path">{useLocation().pathname}</span>;
    render(<MemoryRouter initialEntries={['/login']}><AuthProvider><LoginForm /><Path /></AuthProvider></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'sample');
    await userEvent.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent(target));
  });

  it('returns to a protected page requested before login', async () => {
    mockLogin.mockResolvedValueOnce({ person: { id: '1', name: 'Test', email: 'test@example.com', roles: ['CONSUMER'] }, tokens: { accessToken: crypto.randomUUID(), refreshToken: crypto.randomUUID() } });
    const Path = () => { const location = useLocation(); return <span data-testid="current-path">{location.pathname + location.search + location.hash}</span>; };
    render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { from: { pathname: '/cart', search: '?view=compact', hash: '#items' } } }]}><AuthProvider><LoginForm /><Path /></AuthProvider></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/email/i), 'test@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'sample');
    await userEvent.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/cart?view=compact#items'));
  });

  it('renders email and password fields', () => {
    renderWithProvider(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('shows validation error when email is empty', async () => {
    renderWithProvider(<LoginForm />);

    const submitButton = screen.getByRole('button', { name: /login/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
  });

  it('shows validation error when password is empty', async () => {
    renderWithProvider(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /login/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/password is required/i)).toBeInTheDocument();
  });

  it('shows validation error for invalid email format', async () => {
    renderWithProvider(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'invalid-email');

    const passwordInput = screen.getByLabelText(/password/i);
    await userEvent.type(passwordInput, 'password123');

    const submitButton = screen.getByRole('button', { name: /login/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/invalid email format/i)).toBeInTheDocument();
  });

  it('calls login API on valid submit', async () => {
    const mockResponse = {
      person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
      tokens: { sessionId: 'session-abc-123', refreshId: 'refresh-def-456' }
    } as unknown as AuthResponse;
    mockLogin.mockResolvedValueOnce(mockResponse);

    renderWithProvider(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/password/i);
    await userEvent.type(passwordInput, 'password123');

    const submitButton = screen.getByRole('button', { name: /login/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledTimes(1);
      const [input] = mockLogin.mock.calls[0];
      expect(input.email).toBe('john@example.com');
      expect(input.password).toBe('password123');
    });
  });

  it('shows loading state during login', async () => {
    let resolveLogin: (value: AuthResponse) => void;
    const loginPromise = new Promise<AuthResponse>((resolve) => {
      resolveLogin = resolve;
    });
    mockLogin.mockReturnValueOnce(loginPromise);

    renderWithProvider(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/password/i);
    await userEvent.type(passwordInput, 'password123');

    const submitButton = screen.getByRole('button', { name: /login/i });
    await userEvent.click(submitButton);

    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    resolveLogin!({
      person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
      tokens: { sessionId: 'session-abc-123', refreshId: 'refresh-def-456' }
    } as unknown as AuthResponse);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /loading/i })).not.toBeInTheDocument();
    });
  });

  it('displays error message on login failure', async () => {
    mockLogin.mockRejectedValueOnce(new Error('INVALID_CREDENTIALS'));

    renderWithProvider(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/password/i);
    await userEvent.type(passwordInput, 'wrong');

    const submitButton = screen.getByRole('button', { name: /login/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });

  it('has link to register page', () => {
    renderWithProvider(<LoginForm />);

    expect(screen.getByRole('link', { name: /register/i })).toBeInTheDocument();
  });

  it('is accessible - has proper ARIA attributes', () => {
    renderWithProvider(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    expect(emailInput).toHaveAttribute('type', 'email');
    expect(emailInput).toHaveAttribute('autoComplete', 'email');
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveAttribute('autoComplete', 'current-password');
  });
});
