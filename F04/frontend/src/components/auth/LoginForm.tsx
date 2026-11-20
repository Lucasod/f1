/**
 * LoginForm.tsx
 *
 * Username/password login form. On submit:
 * 1. Ensures CSRF is bootstrapped (GET /auth/csrf/).
 * 2. POSTs /auth/login/ with X-CSRFToken header.
 * 3. Stores the session/user via useAuth and navigates to the workspace list.
 *
 * Visible only when the user is not authenticated.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

interface LoginFormProps {
  onLogin?: (username: string) => void;
}

export function LoginForm({ onLogin }: LoginFormProps = {}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const { login, checking } = useAuth();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      if (onLogin) {
        onLogin(username);
      }
      navigate("/workspaces", { replace: true });
    } catch (err: any) {
      setError(
        err?.message ??
          err?.code === "invalid_credentials"
            ? "Invalid username or password."
            : "Login failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  // While the session is still being restored from /auth/me/, show a neutral
  // state instead of the form (prevents login attempts mid-restore).
  if (checking) {
    return null;
  }

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <h2>Sign in</h2>
      {error && (
        <div className="login-form__error" role="alert">
          {error}
        </div>
      )}
      <div className="login-form__field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="login-form__field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
      </div>
      <button type="submit" className="login-form__submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
