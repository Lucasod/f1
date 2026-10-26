import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';
import { authApi } from '@/shared/api/auth';

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    login: vi.fn()
  }
}));

const mockLogin = vi.mocked(authApi.login);

const renderWithProvider = (component: React.ReactNode) => {
  return render(<AuthProvider>{component}</AuthProvider>);
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
      person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
    };
    mockLogin.mockResolvedValueOnce(mockResponse);

    renderWithProvider(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/password/i);
    await userEvent.type(passwordInput, 'password123');

    const submitButton = screen.getByRole('button', { name: /login/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'john@example.com',
        password: 'password123'
      });
    });
  });

  it('shows loading state during login', async () => {
    let resolveLogin: (value: any) => void;
    const loginPromise = new Promise((resolve) => {
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
      person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
    });

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