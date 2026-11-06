import { create } from 'zustand';
import { queryClient } from './queryClient';
import { persist, createJSONStorage } from 'zustand/middleware';
import { authApi } from '@/shared/api/auth';
import { cartApi } from '@/shared/api/cart';
import { personApi } from '@/shared/api/person';

export type UserRole = 'CONSUMER' | 'VENDOR' | 'ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    taxIdType: 'CPF' | 'CNPJ';
    taxIdValue: string;
    email: string;
    password: string;
    role: UserRole;
  }) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  initializeAuth: () => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  hasRole: (role: UserRole) => boolean;
  
  // Guest cart merge
  mergeGuestCartOnLogin: () => Promise<void>;
}

const STORAGE_KEYS = {
  ACCESS_TOKEN: `accessToken`,
  REFRESH_TOKEN: `refreshToken`,
  USER: 'user'
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.login({ email, password });
          const { person, tokens } = response;
          
          const user = {
            id: person.id,
            name: person.name,
            email: person.email,
            roles: person.roles as UserRole[]
          };
          
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
          
          // Also set individual localStorage keys for apiClient compatibility
          localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
          
          // Merge guest cart after successful login
          await get().mergeGuestCartOnLogin();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'LOGIN_FAILED';
          set({ isLoading: false, error: message, isAuthenticated: false });
          throw error;
        }
      },

      register: async (input) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.register(input);
          const { person, tokens } = response;
          
          const user = {
            id: person.id,
            name: person.name,
            email: person.email,
            roles: person.roles as UserRole[]
          };
          
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
          
          // Also set individual localStorage keys for apiClient compatibility
          localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
          
          // Merge guest cart after successful registration
          await get().mergeGuestCartOnLogin();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'REGISTRATION_FAILED';
          set({ isLoading: false, error: message, isAuthenticated: false });
          throw error;
        }
      },

      logout: () => {
        // Clear individual localStorage keys for apiClient compatibility
        localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.USER);

        // Clear sensitive React Query cached data to prevent cross-account leakage
        queryClient.clear();

        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          error: null
        });
      },

      refreshAccessToken: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          get().logout();
          throw new Error('NO_REFRESH_TOKEN');
        }

        try {
          const response = await authApi.refreshToken(refreshToken);
          set({
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken
          });
          
          // Also update individual localStorage keys for apiClient compatibility
          localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, response.tokens.accessToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, response.tokens.refreshToken);
        } catch (error) {
          get().logout();
          throw error;
        }
      },

      refreshUserProfile: async () => {
        await get().refreshAccessToken();
        const { person } = await personApi.getMe();
        const currentUser = get().user;
        if (!currentUser || currentUser.id !== person.id) {
          throw new Error('PERSON_MISMATCH');
        }

        const email = person.contactInfos.find(
          contact => contact.type === 'email' && contact.isPrimary
        )?.value ?? person.contactInfos.find(contact => contact.type === 'email')?.value;
        if (!email) {
          throw new Error('PERSON_EMAIL_UNAVAILABLE');
        }

        const user: User = {
          id: person.id,
          name: person.name,
          email,
          roles: person.roles.filter(
            (role): role is UserRole =>
              role === 'CONSUMER' || role === 'VENDOR' || role === 'ADMIN'
          ),
        };
        set({ user });
        localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
      },

      initializeAuth: async () => {
        const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
        const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
        const userStr = localStorage.getItem(STORAGE_KEYS.USER);

        if (accessToken && refreshToken && userStr) {
          try {
            const user = JSON.parse(userStr);
            set({
              user,
              accessToken,
              refreshToken,
              isAuthenticated: true
            });
            
            // Trigger guest cart merge after restoring auth state
            await get().mergeGuestCartOnLogin();
          } catch {
            // Invalid stored data, clear it
            get().logout();
          }
        }
      },

      setError: (error: string | null) => set({ error }),
      clearError: () => set({ error: null }),

      hasRole: (role: UserRole) => {
        const { user, isAuthenticated } = get();
        if (!isAuthenticated || !user) return false;
        return user.roles.includes(role);
      },

      mergeGuestCartOnLogin: async () => {
        const guestCartId = localStorage.getItem('guestCartId');
        if (guestCartId) {
          try {
            await cartApi.mergeGuestCart({ guestCartId });
            cartApi.clearGuestCartId();
          } catch (error) {
            // Log error but don't fail login - guest cart merge is best effort
            console.error('Failed to merge guest cart:', error);
          }
        }
      }
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
);