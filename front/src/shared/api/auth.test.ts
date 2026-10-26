import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authApi } from './auth';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('authApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should call POST /api/v1/auth/register with correct payload', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'], createdAt: '2024-01-01' },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const input = {
        name: 'John',
        taxIdType: 'CPF' as const,
        taxIdValue: '12345678901',
        email: 'john@example.com',
        password: 'password123',
        role: 'CONSUMER' as const
      };

      const result = await authApi.register(input);

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error on registration failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'EMAIL_ALREADY_EXISTS', message: 'Email already registered' })
      });

      const input = {
        name: 'John',
        taxIdType: 'CPF' as const,
        taxIdValue: '12345678901',
        email: 'john@example.com',
        password: 'password123',
        role: 'CONSUMER' as const
      };

      await expect(authApi.register(input)).rejects.toThrow('EMAIL_ALREADY_EXISTS');
    });
  });

  describe('login', () => {
    it('should call POST /api/v1/auth/login with correct payload', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await authApi.login({ email: 'john@example.com', password: 'password123' });

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'john@example.com', password: 'password123' })
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error on invalid credentials', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password' })
      });

      await expect(authApi.login({ email: 'john@example.com', password: 'wrong' })).rejects.toThrow('INVALID_CREDENTIALS');
    });
  });

  describe('refreshToken', () => {
    it('should call POST /api/v1/auth/refresh with refresh token', async () => {
      const mockResponse = { tokens: { accessToken: 'new-access', refreshToken: 'new-refresh' } };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await authApi.refreshToken('old-refresh-token');

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'old-refresh-token' })
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error on invalid refresh token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'INVALID_TOKEN', message: 'Invalid refresh token' })
      });

      await expect(authApi.refreshToken('invalid')).rejects.toThrow('INVALID_TOKEN');
    });
  });
});