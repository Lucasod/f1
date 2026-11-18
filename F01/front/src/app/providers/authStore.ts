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
  clearAuthData: () => void;
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

let authEpoch = 0;
let refreshEpoch = 0;
let sessionEpoch = 0;

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
        const epoch = ++authEpoch;
        let apiSucceeded = false;
        let loadingStatePersisted = false;
        try {
          // Persist loading state first (fail-closed: if this throws, we fail closed)
          set({ isLoading: true, error: null });
          loadingStatePersisted = true;
          
          const response = await authApi.login({ email, password });
          if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
          apiSucceeded = true;
          const { person, tokens } = response;
          
          const user = {
            id: person.id,
            name: person.name,
            email: person.email,
            roles: person.roles as UserRole[]
          };
          
          ++sessionEpoch;
          // Write to localStorage FIRST (fail-closed: if this throws, state isn't updated)
          localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
          // Then clear queryClient
          queryClient.clear();
          // Then update state
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
          
          // Merge guest cart after successful login
          if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
          await get().mergeGuestCartOnLogin();
          if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'LOGIN_FAILED';
          if (epoch === authEpoch) {
            // Fail closed if loading state persistence failed, or if API succeeded but later steps failed
            // Preserve session only if loading state persisted AND API failed (invalid credentials)
            if (!loadingStatePersisted || apiSucceeded) {
              // localStorage or later step failed - fail closed: clear everything
              localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.USER);
              // queryClient.clear() handled by subscription on isAuthenticated transition
              set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isLoading: false, error: message });
            } else {
              // API failed (invalid credentials) but loading state persisted - preserve existing session
              set({ isLoading: false, error: message });
            }
          }
          throw error;
        }
      },

      register: async (input) => {
        const epoch = ++authEpoch;
        let apiSucceeded = false;
        let loadingStatePersisted = false;
        try {
          // Persist loading state first (fail-closed: if this throws, we fail closed)
          set({ isLoading: true, error: null });
          loadingStatePersisted = true;
          
          const response = await authApi.register(input);
          if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
          apiSucceeded = true;
          const { person, tokens } = response;
          
          const user = {
            id: person.id,
            name: person.name,
            email: person.email,
            roles: person.roles as UserRole[]
          };
          
          ++sessionEpoch;
          // Write to localStorage FIRST (fail-closed: if this throws, state isn't updated)
          localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
          // Then clear queryClient
          queryClient.clear();
          // Then update state
          set({
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
          
          // Merge guest cart after successful registration
          if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
          await get().mergeGuestCartOnLogin();
          if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'REGISTRATION_FAILED';
          if (epoch === authEpoch) {
            // Fail closed if loading state persistence failed, or if API succeeded but later steps failed
            // Preserve session only if loading state persisted AND API failed (invalid credentials)
            if (!loadingStatePersisted || apiSucceeded) {
              // localStorage or later step failed - fail closed: clear everything
              localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.USER);
              // queryClient.clear() handled by subscription on isAuthenticated transition
              set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, isLoading: false, error: message });
            } else {
              // API failed (invalid credentials) but loading state persisted - preserve existing session
              set({ isLoading: false, error: message });
            }
          }
          throw error;
        }
      },

      logout: () => {
        ++authEpoch;
        ++refreshEpoch;
        ++sessionEpoch;
        // Clear individual localStorage keys for apiClient compatibility
        localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.USER);

        // Clear sensitive React Query cached data to prevent cross-account leakage
        // (handled by subscription on isAuthenticated transition)
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
          error: null
        });
      },

      clearAuthData: () => {
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
          isLoading: false,
          error: null
        });
      },

      refreshAccessToken: async () => {
        const epoch = authEpoch;
        const session = sessionEpoch;
        const refreshOperation = ++refreshEpoch;
        const { refreshToken } = get();
        if (!refreshToken) {
          get().logout();
          throw new Error('NO_REFRESH_TOKEN');
        }

        try {
          const response = await authApi.refreshToken(refreshToken);
          if (epoch !== authEpoch || session !== sessionEpoch || refreshOperation !== refreshEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
          localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, response.tokens.accessToken);
          localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, response.tokens.refreshToken);
          set({
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken
          });
          
        } catch (error) {
          // Only clear auth data if this refresh is still the current auth operation
          // Don't increment epochs - let pending login/register proceed
          if (epoch === authEpoch && session === sessionEpoch && refreshOperation === refreshEpoch) {
            get().clearAuthData();
          }
          throw error;
        }
      },

      refreshUserProfile: async () => {
        const epoch = authEpoch;
        await get().refreshAccessToken();
        if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
        const { person } = await personApi.getMe();
        if (epoch !== authEpoch) throw new Error('AUTH_OPERATION_SUPERSEDED');
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
        set({ isLoading: true }); // Set loading at start
        try {
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
              // Wrap in try-catch to avoid triggering logout on merge failure
              try {
                await get().mergeGuestCartOnLogin();
              } catch (error) {
                // Log merge failure but don't clear auth state
                console.error('Guest cart merge failed during init:', error);
              }
            } catch {
              // Invalid stored data, clear it
              get().logout();
            }
          }
        } finally {
          set({ isLoading: false }); // Always clear loading at end
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
        const epoch = authEpoch;
        const guestCartId = localStorage.getItem('guestCartId');
        if (!guestCartId) {
          return;
        }

        try {
          // Attempt merge but handle errors gracefully
          // The merge endpoint handles empty/non-existent guest carts gracefully
          // 403 should not fail login - guest cart merge is best effort
          await cartApi.mergeGuestCart({ guestCartId });
          // After successful merge, clear the guestCartId
          if (epoch === authEpoch) cartApi.clearGuestCartId();
        } catch (error) {
          // Log error but don't fail login - guest cart merge is best effort
          console.error('Failed to merge guest cart:', error);
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

// Subscribe to auth state changes to clear queryClient on logout/cross-tab invalidation
let wasAuthenticated = false;
useAuthStore.subscribe((state) => {
  const isAuthenticated = state.isAuthenticated;
  if (wasAuthenticated && !isAuthenticated) {
    queryClient.clear();
  }
  wasAuthenticated = isAuthenticated;
});
