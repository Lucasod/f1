/**
 * Auth API functions.
 * Wraps GET /auth/csrf/, POST /auth/login/, GET /auth/me/, POST /auth/logout/.
 * Uses the centralized client (CSRF bootstrap/rotation, credentials: include).
 */

import { request, bootstrapCsrf } from "./client";
import type { User } from "../types/index";

/** Bootstrap CSRF token from GET /auth/csrf/. */
export async function bootstrapCsrfAuth(): Promise<string> {
  return bootstrapCsrf();
}

/**
 * POST /auth/login/ with username + password and X-CSRFToken header.
 * On success the Django sessionid cookie is set and the CSRF token rotates
 * (captured automatically by the client from the X-CSRFToken response header).
 * Returns { user: { id, username, display_name } }.
 */
export async function login(
  username: string,
  password: string
): Promise<{ user: User }> {
  const resp = await request<{ user: User }>("/auth/login/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return resp;
}

/** GET /auth/me/ - returns the current user, or throws on 401/403. */
export async function me(): Promise<User | null> {
  try {
    const data = await request<{ user: User | null }>("/auth/me/");
    return data?.user ?? null;
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return null;
    }
    throw err;
  }
}

/** POST /auth/logout/ - clears the Django session. */
export async function logout(): Promise<void> {
  const resp = await request<void>("/auth/logout/", {
    method: "POST",
  });
  // Ensure any rotated token on the logout response is captured.
  // (logout returns 204; rotation header is best-effort.)
  return resp;
}
