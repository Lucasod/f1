import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';
import { authApi } from '@/shared/api/auth';

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn()
  }
}));

const mockLogin = vi.mocked(authApi.login);
const mockRegister = vi.mocked(authApi.register);
const mockRefreshToken = vi.mocked(authApi.refreshToken);

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null
    });
    // Clear localStorage
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('login', () => {
    it('should set loading state during login', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockLogin.mockResolvedValueOnce(mockResponse);

      const promise = useAuthStore.getState().login('john@example.com', 'password123');

      // Check loading state during async operation
      expect(useAuthStore.getState().isLoading).toBe(true);

      await promise;

      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should store user and tokens on successful login', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockLogin.mockResolvedValueOnce(mockResponse);

      await useAuthStore.getState().login('john@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockResponse.person);
      expect(state.accessToken).toBe('access-token');
      expect(state.refreshToken).toBe('refresh-token');
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should persist tokens to localStorage', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockLogin.mockResolvedValueOnce(mockResponse);

      await useAuthStore.getState().login('john@example.com', 'password123');

      expect(localStorage.getItem('accessToken')).toBe('access-token');
      expect(localStorage.getItem('refreshToken')).toBe('refresh-token');
      expect(localStorage.getItem('user')).toBe(JSON.stringify(mockResponse.person));
    });

    it('should set error on login failure', async () => {
      mockLogin.mockRejectedValueOnce(new Error('INVALID_CREDENTIALS'));

      try {
        await useAuthStore.getState().login('john@example.com', 'wrong');
      } catch (e) {
        // Expected to throw
      }

      const state = useAuthStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('INVALID_CREDENTIALS');
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('register', () => {
    it('should register user and store tokens', async () => {
      const mockResponse = {
        person: { id: '1', name: 'Jane', email: 'jane@example.com', roles: ['VENDOR'], createdAt: '2024-01-01' },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockRegister.mockResolvedValueOnce(mockResponse);

      await useAuthStore.getState().register({
        name: 'Jane',
        taxIdType: 'CNPJ',
        taxIdValue: '12345678000199',
        email: 'jane@example.com',
        password: 'password123',
        role: 'VENDOR'
      });

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockResponse.person);
      expect(state.accessToken).toBe('access-token');
      expect(state.refreshToken).toBe('refresh-token');
      expect(state.isAuthenticated).toBe(true);
    });

    it('should set error on registration failure', async () => {
      mockRegister.mockRejectedValueOnce(new Error('EMAIL_ALREADY_EXISTS'));

      try {
        await useAuthStore.getState().register({
          name: 'Jane',
          taxIdType: 'CPF',
          taxIdValue: '12345678901',
          email: 'jane@example.com',
          password: 'password123',
          role: 'CONSUMER'
        });
      } catch (e) {
        // Expected to throw
      }

      const state = useAuthStore.getState();
      expect(state.error).toBe('EMAIL_ALREADY_EXISTS');
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('logout', () => {
    it('should clear user and tokens', async () => {
      // First login
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };
      mockLogin.mockResolvedValueOnce(mockResponse);

      await useAuthStore.getState().login('john@example.com', 'password123');

      // Then logout
      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh access token using refresh token', async () => {
      // Set initial state with refresh token
      useAuthStore.setState({
        refreshToken: 'old-refresh-token',
        accessToken: 'old-access-token'
      });

      const mockResponse = {
        tokens: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' }
      };
      mockRefreshToken.mockResolvedValueOnce(mockResponse);

      await useAuthStore.getState().refreshAccessToken();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('new-access-token');
      expect(state.refreshToken).toBe('new-refresh-token');
      expect(localStorage.getItem('accessToken')).toBe('new-access-token');
      expect(localStorage.getItem('refreshToken')).toBe('new-refresh-token');
    });

    it('should logout on refresh token failure', async () => {
      useAuthStore.setState({
        refreshToken: 'expired-refresh-token',
        accessToken: 'old-access-token',
        isAuthenticated: true,
        user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] }
      });

      mockRefreshToken.mockRejectedValueOnce(new Error('TOKEN_EXPIRED'));

      try {
        await useAuthStore.getState().refreshAccessToken();
      } catch (e) {
        // Expected
      }

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
    });
  });

  describe('initializeAuth', () => {
    it('should restore auth from localStorage on init', () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] };
      localStorage.setItem('accessToken', 'stored-access-token');
      localStorage.setItem('refreshToken', 'stored-refresh-token');
      localStorage.setItem('user', JSON.stringify(mockUser));

      useAuthStore.getState().initializeAuth();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('stored-access-token');
      expect(state.refreshToken).toBe('stored-refresh-token');
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it('should not restore if tokens missing', () => {
      localStorage.clear();

      useAuthStore.getState().initializeAuth();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('should return true if user has role', () => {
      useAuthStore.setState({
        user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER', 'VENDOR'] },
        isAuthenticated: true
      });

      expect(useAuthStore.getState().hasRole('CONSUMER')).toBe(true);
      expect(useAuthStore.getState().hasRole('VENDOR')).toBe(true);
      expect(useAuthStore.getState().hasRole('ADMIN')).toBe(false);
    });

    it('should return false if not authenticated', () => {
      useAuthStore.setState({ isAuthenticated: false, user: null });
      expect(useAuthStore.getState().hasRole('CONSUMER')).toBe(false);
    });
  });
});