import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { authApi, type AuthResponse, type Person } from '@/shared/api/auth';

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
  initializeAuth: () => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  hasRole: (role: UserRole) => boolean;
}

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
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
          
          set({
            user: {
              id: person.id,
              name: person.name,
              email: person.email,
              roles: person.roles as UserRole[]
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
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
          
          set({
            user: {
              id: person.id,
              name: person.name,
              email: person.email,
              roles: person.roles as UserRole[]
            },
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'REGISTRATION_FAILED';
          set({ isLoading: false, error: message, isAuthenticated: false });
          throw error;
        }
      },

      logout: () => {
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
        } catch (error) {
          get().logout();
          throw error;
        }
      },

      initializeAuth: () => {
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