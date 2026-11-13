/**
 * LogoutButton.tsx
 *
 * Visible when the user is authenticated. On click:
 * 1. POSTs /auth/logout/ with X-CSRFToken header.
 * 2. Clears local auth state.
 * 3. Redirects to the login page.
 */

import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

export function LogoutButton() {
  const navigate = useNavigate();
  const { isAuthenticated, logout, checking } = useAuth();

  // Hidden while the session is being restored and when not authenticated.
  if (checking || !isAuthenticated) {
    return null;
  }

  const handleClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <button
      className="logout-button"
      onClick={handleClick}
      type="button"
      aria-label="Sign out"
    >
      Sign out
    </button>
  );
}
