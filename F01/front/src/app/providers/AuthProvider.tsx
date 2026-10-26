import { useEffect } from 'react';
import { createContext, useContext, ReactNode } from 'react';
import { useAuthStore, type User } from './authStore';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    taxIdType: 'CPF' | 'CNPJ';
    taxIdValue: string;
    email: string;
    password: string;
    role: User['roles'][0];
  }) => Promise<void>;
  logout: () => void;
  refreshAccessToken: () => Promise<void>;
  hasRole: (role: User['roles'][0]) => boolean;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    register,
    logout,
    refreshAccessToken,
    hasRole,
    clearError,
    initializeAuth
  } = useAuthStore();

  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        error,
        login,
        register,
        logout,
        refreshAccessToken,
        hasRole,
        clearError
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}