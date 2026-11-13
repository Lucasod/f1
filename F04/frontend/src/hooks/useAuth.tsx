/**
 * useAuth hook + AuthContext.
 *
 * Manages authentication state (user, isAuthenticated) and provides
 * login()/logout() that go through the Django session-backed API with CSRF
 * handling. On initialization the current session is restored via GET /auth/me/.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { login, logout, me } from "../api/auth";
import { bootstrapCsrf } from "../api/client";
import type { User } from "../types/index";

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  checking: boolean; // true while restoring session from /auth/me/
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Auth provider. Wrap the app (or the authenticated subtree) with this. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const isAuthenticated = !!user;

  // Restore session from the existing Django session cookie on mount.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const currentUser = await me();
        if (mounted) {
          setUser(currentUser);
        }
      } catch {
        // /auth/me/ 401/403 -> remain unauthenticated.
        if (mounted) setUser(null);
      } finally {
        if (mounted) setChecking(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const doLogin = useCallback(
    async (username: string, password: string): Promise<User> => {
      const data = await login(username, password);
      setUser(data.user);
      // The server rotates the CSRF token after login (new csrftoken cookie).
      // Re-bootstrap so subsequent unsafe requests send the matching token.
      await bootstrapCsrf();
      return data.user;
    },
    []
  );

  const doLogout = useCallback(async (): Promise<void> => {
    try {
      await logout();
    } catch {
      // Best effort; clear local state regardless.
    } finally {
      setUser(null);
    }
  }, []);

  const value = {
    user,
    isAuthenticated,
    checking,
    login: doLogin,
    logout: doLogout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/** Consume auth state. Must be used within an AuthProvider. */
export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
