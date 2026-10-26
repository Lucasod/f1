import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterForm } from './RegisterForm';
import { AuthProvider } from '@/app/providers/AuthProvider';
import { useAuthStore } from '@/app/providers/authStore';
import { authApi } from '@/shared/api/auth';

const VALID_CPF = '52998224725';
const VALID_CNPJ = '11222333000181';

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    register: vi.fn()
  }
}));

const mockRegister = vi.mocked(authApi.register);

const renderWithProvider = (component: React.ReactNode) => {
  return render(<AuthProvider>{component}</AuthProvider>);
};

describe('RegisterForm', () => {
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

  it('renders all required fields', () => {
    renderWithProvider(<RegisterForm />);

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tax id type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tax id value/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
  });

  it('shows validation error when name is empty', async () => {
    renderWithProvider(<RegisterForm />);

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });

  it('shows validation error when tax ID type is not selected', async () => {
    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    // Change taxIdType to empty (select the first option "Select type")
    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, '');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/tax id type is required/i)).toBeInTheDocument();
  });

  it('shows validation error when tax ID value is empty', async () => {
    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/tax id value is required/i)).toBeInTheDocument();
  });

  it('shows validation error for invalid CPF format', async () => {
    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, '123');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/invalid cpf format/i)).toBeInTheDocument();
  });

  it('shows validation error for invalid CNPJ format', async () => {
    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'Company');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CNPJ');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, '123');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/invalid cnpj format/i)).toBeInTheDocument();
  });

  it('shows validation error for invalid email format', async () => {
    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, VALID_CPF);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'invalid-email');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/invalid email format/i)).toBeInTheDocument();
  });

  it('shows validation error when password is too short', async () => {
    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, VALID_CPF);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/^password$/i);
    await userEvent.type(passwordInput, '123');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/password must be at least 8 characters/i)).toBeInTheDocument();
  });

  it('shows validation error when passwords do not match', async () => {
    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, VALID_CPF);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/^password$/i);
    await userEvent.type(passwordInput, 'password123');

    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    await userEvent.type(confirmPasswordInput, 'different123');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it('calls register API on valid submit', async () => {
    const mockResponse = {
      person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'], createdAt: '2024-01-01' },
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
    };
    mockRegister.mockResolvedValueOnce(mockResponse);

    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, VALID_CPF);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/^password$/i);
    await userEvent.type(passwordInput, 'password123');

    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    await userEvent.type(confirmPasswordInput, 'password123');

    const roleSelect = screen.getByLabelText(/role/i);
    await userEvent.selectOptions(roleSelect, 'CONSUMER');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: VALID_CPF,
        email: 'john@example.com',
        password: 'password123',
        role: 'CONSUMER'
      });
    });
  });

  it('shows loading state during registration', async () => {
    let resolveRegister: (value: any) => void;
    const registerPromise = new Promise((resolve) => {
      resolveRegister = resolve;
    });
    mockRegister.mockReturnValueOnce(registerPromise);

    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, VALID_CPF);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/^password$/i);
    await userEvent.type(passwordInput, 'password123');

    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    await userEvent.type(confirmPasswordInput, 'password123');

    const roleSelect = screen.getByLabelText(/role/i);
    await userEvent.selectOptions(roleSelect, 'CONSUMER');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    resolveRegister!({
      person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'], createdAt: '2024-01-01' },
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /loading/i })).not.toBeInTheDocument();
    });
  });

  it('displays error message on registration failure', async () => {
    mockRegister.mockRejectedValueOnce(new Error('EMAIL_ALREADY_EXISTS'));

    renderWithProvider(<RegisterForm />);

    const nameInput = screen.getByLabelText(/name/i);
    await userEvent.type(nameInput, 'John Doe');

    const taxIdTypeSelect = screen.getByLabelText(/tax id type/i);
    await userEvent.selectOptions(taxIdTypeSelect, 'CPF');

    const taxIdValueInput = screen.getByLabelText(/tax id value/i);
    await userEvent.type(taxIdValueInput, VALID_CPF);

    const emailInput = screen.getByLabelText(/email/i);
    await userEvent.type(emailInput, 'john@example.com');

    const passwordInput = screen.getByLabelText(/^password$/i);
    await userEvent.type(passwordInput, 'password123');

    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    await userEvent.type(confirmPasswordInput, 'password123');

    const roleSelect = screen.getByLabelText(/role/i);
    await userEvent.selectOptions(roleSelect, 'CONSUMER');

    const submitButton = screen.getByRole('button', { name: /register/i });
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email already registered/i)).toBeInTheDocument();
    });
  });

  it('has link to login page', () => {
    renderWithProvider(<RegisterForm />);

    expect(screen.getByRole('link', { name: /login/i })).toBeInTheDocument();
  });

  it('is accessible - has proper ARIA attributes', () => {
    renderWithProvider(<RegisterForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/^password$/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);

    expect(emailInput).toHaveAttribute('type', 'email');
    expect(emailInput).toHaveAttribute('autoComplete', 'email');
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveAttribute('autoComplete', 'new-password');
    expect(confirmPasswordInput).toHaveAttribute('type', 'password');
    expect(confirmPasswordInput).toHaveAttribute('autoComplete', 'new-password');
  });

  it('displays role options: Consumer, Vendor, Admin', () => {
    renderWithProvider(<RegisterForm />);

    const roleSelect = screen.getByLabelText(/role/i);
    expect(roleSelect).toHaveAccessibleName(/role/i);
    
    // Check options exist
    expect(screen.getByRole('option', { name: /consumer/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /vendor/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /admin/i })).toBeInTheDocument();
  });
});