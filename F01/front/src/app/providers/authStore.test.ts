import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './authStore';
import { authApi } from '@/shared/api/auth';
import { cartApi } from '@/shared/api/cart';
import { personApi } from '@/shared/api/person';

vi.mock('@/shared/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn()
  }
}));

vi.mock('@/shared/api/cart', () => ({
  cartApi: {
    mergeGuestCart: vi.fn(),
    clearGuestCartId: vi.fn()
  }
}));

vi.mock('@/shared/api/person', () => ({
  personApi: {
    getMe: vi.fn(),
  },
}));

const mockLogin = vi.mocked(authApi.login);
const mockRegister = vi.mocked(authApi.register);
const mockRefreshToken = vi.mocked(authApi.refreshToken);
const mockMergeGuestCart = vi.mocked(cartApi.mergeGuestCart);
const mockClearGuestCartId = vi.mocked(cartApi.clearGuestCartId);
const mockGetMe = vi.mocked(personApi.getMe);

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
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
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
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
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
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockLogin.mockResolvedValueOnce(mockResponse);

      await useAuthStore.getState().login('john@example.com', 'password123');

      const persistedState = JSON.parse(localStorage.getItem('auth-storage') ?? 'null')?.state;
      expect(persistedState).toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: mockResponse.person
      });
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
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
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
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
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
      const persistedState = JSON.parse(localStorage.getItem('auth-storage') ?? 'null')?.state;
      expect(persistedState).toMatchObject({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token'
      });
    });

    it('refreshes credentials and adopts current backend roles', async () => {
      useAuthStore.setState({
        user: { id: 'person-1', name: 'Consumer', email: 'consumer@example.com', roles: ['CONSUMER'] },
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        isAuthenticated: true,
      });
      mockRefreshToken.mockResolvedValueOnce({
        tokens: { accessToken: 'new-access-token', refreshToken: 'new-refresh-token' },
      });
      mockGetMe.mockResolvedValueOnce({
        person: {
          id: 'person-1',
          name: 'Consumer',
          roles: ['CONSUMER', 'VENDOR'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[],
          mainInfo: { name: 'Consumer', taxIdType: 'CPF', taxIdValue: '***' },
          contactInfos: [
            { id: 'email-1', type: 'email', value: 'consumer@example.com', isPrimary: true },
          ],
          addresses: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      });

      await useAuthStore.getState().refreshUserProfile();

      expect(mockGetMe).toHaveBeenCalledOnce();
      expect(useAuthStore.getState().user?.roles).toEqual(['CONSUMER', 'VENDOR']);
      expect(useAuthStore.getState().accessToken).toBe('new-access-token');
      expect(localStorage.getItem('user')).toContain('"VENDOR"');
    });

    it('should logout on refresh token failure', async () => {
      useAuthStore.setState({
        refreshToken: 'expired-refresh-token',
        accessToken: 'old-access-token',
        isAuthenticated: true,
        user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] }
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
    it('should restore auth from localStorage on init', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] };
      localStorage.setItem('accessToken', 'stored-access-token');
      localStorage.setItem('refreshToken', 'stored-refresh-token');
      localStorage.setItem('user', JSON.stringify(mockUser));

      await useAuthStore.getState().initializeAuth();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe('stored-access-token');
      expect(state.refreshToken).toBe('stored-refresh-token');
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it('should not restore if tokens missing', async () => {
      localStorage.clear();

      await useAuthStore.getState().initializeAuth();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('should return true if user has role', () => {
      useAuthStore.setState({
        user: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER', 'VENDOR'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
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

  describe('mergeGuestCartOnLogin', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      localStorage.clear();
    });

    it('should merge guest cart on successful login', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      // Set guest cart ID in localStorage before login
      localStorage.setItem('guestCartId', 'guest:12345678-1234-4123-8123-123456789abc');

      mockLogin.mockResolvedValueOnce(mockResponse);
      mockMergeGuestCart.mockResolvedValueOnce({ cart: { id: '1', items: [], version: 1, updatedAt: new Date().toISOString() } });

      await useAuthStore.getState().login('john@example.com', 'password123');

      expect(mockMergeGuestCart).toHaveBeenCalledWith({ guestCartId: 'guest:12345678-1234-4123-8123-123456789abc' });
      expect(mockClearGuestCartId).toHaveBeenCalled();
    });

    it('should not fail login if mergeGuestCart fails', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      // Set guest cart ID in localStorage before login
      localStorage.setItem('guestCartId', 'guest:12345678-1234-4123-8123-123456789abc');

      mockLogin.mockResolvedValueOnce(mockResponse);
      mockMergeGuestCart.mockRejectedValueOnce(new Error('MERGE_FAILED'));

      await useAuthStore.getState().login('john@example.com', 'password123');

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(mockResponse.person);
      expect(mockMergeGuestCart).toHaveBeenCalled();
    });

    it('should not call mergeGuestCart when no guest cart ID in localStorage', async () => {
      const mockResponse = {
        person: { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] },
        tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' }
      };

      mockLogin.mockResolvedValueOnce(mockResponse);
      // No guestCartId in localStorage

      await useAuthStore.getState().login('john@example.com', 'password123');

      expect(mockMergeGuestCart).not.toHaveBeenCalled();
      expect(mockClearGuestCartId).not.toHaveBeenCalled();
    });

    it('should merge guest cart on initializeAuth when authenticated', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] };
      localStorage.setItem('accessToken', 'stored-access-token');
      localStorage.setItem('refreshToken', 'stored-refresh-token');
      localStorage.setItem('user', JSON.stringify(mockUser));
      localStorage.setItem('guestCartId', 'guest:12345678-1234-4123-8123-123456789abc');

      mockMergeGuestCart.mockResolvedValueOnce({ cart: { id: '1', items: [], version: 1, updatedAt: new Date().toISOString() } });

      await useAuthStore.getState().initializeAuth();

      expect(mockMergeGuestCart).toHaveBeenCalledWith({ guestCartId: 'guest:12345678-1234-4123-8123-123456789abc' });
      expect(mockClearGuestCartId).toHaveBeenCalled();
    });

    it('should not call mergeGuestCart on initializeAuth when no guest cart ID', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] };
      localStorage.setItem('accessToken', 'stored-access-token');
      localStorage.setItem('refreshToken', 'stored-refresh-token');
      localStorage.setItem('user', JSON.stringify(mockUser));
      // No guestCartId in localStorage

      await useAuthStore.getState().initializeAuth();

      expect(mockMergeGuestCart).not.toHaveBeenCalled();
      expect(mockClearGuestCartId).not.toHaveBeenCalled();
    });

    it('should not fail initializeAuth if mergeGuestCart fails', async () => {
      const mockUser = { id: '1', name: 'John', email: 'john@example.com', roles: ['CONSUMER'] as ('CONSUMER' | 'VENDOR' | 'ADMIN')[] };
      localStorage.setItem('accessToken', 'stored-access-token');
      localStorage.setItem('refreshToken', 'stored-refresh-token');
      localStorage.setItem('user', JSON.stringify(mockUser));
      localStorage.setItem('guestCartId', 'guest:12345678-1234-4123-8123-123456789abc');

      mockMergeGuestCart.mockRejectedValueOnce(new Error('MERGE_FAILED'));

      // Should not throw
      await useAuthStore.getState().initializeAuth();

      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(mockUser);
    });
  });
});