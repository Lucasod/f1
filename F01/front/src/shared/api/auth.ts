import { apiClient } from './client';

export interface RegisterInput {
  name: string;
  taxIdType: 'CPF' | 'CNPJ';
  taxIdValue: string;
  email: string;
  password: string;
  role: 'CONSUMER' | 'VENDOR' | 'ADMIN';
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  roles: ('CONSUMER' | 'VENDOR' | 'ADMIN')[];
  createdAt?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  person: Person;
  tokens: TokenPair;
}

export interface RefreshResponse {
  tokens: TokenPair;
}

export interface ApiError {
  error: string;
  message: string;
}

class AuthApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AuthApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  
  if (!response.ok) {
    // Throw error with the error code as the message so tests can catch it
    throw new AuthApiError(data.error || 'UNKNOWN_ERROR', data.error || 'An error occurred');
  }
  
  return data;
}

export const authApi = {
  async register(input: RegisterInput): Promise<AuthResponse> {
    const response = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    return handleResponse<AuthResponse>(response);
  },

  async login(input: LoginInput): Promise<AuthResponse> {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
    return handleResponse<AuthResponse>(response);
  },

  async refreshToken(refreshToken: string): Promise<RefreshResponse> {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    return handleResponse<RefreshResponse>(response);
  },

  async changePassword(input: ChangePasswordInput): Promise<{ message: string }> {
    const response = await apiClient.patch('/api/v1/auth/change-password', input);
    return handleResponse<{ message: string }>(response);
  }
};

export { AuthApiError };