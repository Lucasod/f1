/**
 * API Client with CSRF bootstrap and token rotation logic.
 *
 * - All requests send credentials: "include" so Django session cookies
 *   (sessionid / csrftoken) are transmitted same-origin.
 * - CSRF token bootstrap: fetch GET /auth/csrf/ on first unsafe request.
 * - Token rotation after login: capture X-CSRFToken from login response.
 * - X-CSRFToken header injection for unsafe methods (POST, PATCH, DELETE).
 * - Base URL: http://127.0.0.1:8000/api/v1
 * - Error envelope parsing: { error: { code, message, fields } }
 */

const DEFAULT_API_BASE = `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE;

// CSRF token held in memory; populated by bootstrapCsrf() or rotation.
let csrfToken: string | null = null;
let bootstrapPromise: Promise<string> | null = null;

/**
 * Bootstrap the CSRF token by fetching GET /auth/csrf/.
 * Only one bootstrap flight is in flight at a time.
 */
export async function bootstrapCsrf(): Promise<string> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }
  bootstrapPromise = (async () => {
    const resp = await fetch(`${API_BASE_URL}/auth/csrf/`, {
      credentials: "include",
    });
    if (!resp.ok) {
      throw new Error(`CSRF bootstrap failed (${resp.status})`);
    }
    const data = await resp.json();
    const token = data.csrf_token ?? data.token ?? null;
    if (!token) {
      throw new Error("CSRF token not returned by /auth/csrf/");
    }
    csrfToken = token;
    return token;
  })();
  const token = await bootstrapPromise;
  bootstrapPromise = null;
  return token;
}

/** Return the currently held CSRF token (or null if not yet bootstrapped). */
export function getCsrfToken(): string | null {
  return csrfToken;
}

/**
 * Capture a rotated CSRF token from a login (or other) response's
 * X-CSRFToken header so subsequent unsafe requests use the fresh token.
 */
export function rotateCsrfFromResponse(response: Response): void {
  const token = response.headers.get("x-csrf-token");
  if (token) {
    csrfToken = token;
  }
}

/**
 * Ensure a CSRF token is available and return headers with X-CSRFToken
 * injected for unsafe methods. Safe methods (GET/HEAD/OPTIONS) get no CSRF
 * header per Django CSRF rules.
 */
export async function csrfHeaders(init: RequestInit = {}): Promise<HeadersInit> {
  const method = (init.method || "GET").toUpperCase();
  const isUnsafe =
    method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  const headers: Record<string, string> = {};
  if (init.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([key, value]) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, init.headers);
    }
  }

  if (isUnsafe) {
    if (!csrfToken) {
      await bootstrapCsrf();
    }
    if (csrfToken) {
      headers["X-CSRFToken"] = csrfToken;
    }
  }

  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

/**
 * Parse the API error envelope { error: { code, message, fields } }.
 * Returns null when no error envelope is present (body is read internally).
 */
export async function parseErrorEnvelope(
  response: Response
): Promise<{ code: string; message: string; fields: Record<string, string> } | null> {
  let data: any;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  const error = data && data.error ? data.error : null;
  if (!error) return null;
  return {
    code: error.code ?? "",
    message: error.message ?? "",
    fields: error.fields ?? {},
  };
}

/**
 * Typed API request wrapper.
 * - Resolves the URL against API_BASE_URL.
 * - Injects CSRF headers for unsafe methods (bootstrapping if needed).
 * - Sends credentials: "include".
 * - Throws an ApiError (with parsed envelope) on non-ok responses.
 * - Rotates the CSRF token from the response header when present.
 */
export async function request<T = any>(
  input: string,
  init: RequestInit = {}
): Promise<T> {
  const url = input.startsWith("http")
    ? input
    : `${API_BASE_URL}${input.startsWith("/") ? input : "/" + input}`;

  const headers = await csrfHeaders(init);

  const resp = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });

  // Capture rotated CSRF token (e.g. after login).
  rotateCsrfFromResponse(resp);

  if (!resp.ok) {
    const error = await parseErrorEnvelope(resp);
    const err: any = new Error(
      error?.message ?? `Request failed (${resp.status})`
    );
    err.status = resp.status;
    err.code = error?.code ?? "";
    err.fields = error?.fields ?? {};
    throw err;
  }

  // 204 No Content or empty body -> return null-ish.
  if (resp.status === 204 || resp.status === 205) {
    return null as unknown as T;
  }

  const text = await resp.text();
  if (!text) {
    return null as unknown as T;
  }
  return JSON.parse(text);
}

export default {
  request,
  bootstrapCsrf,
  getCsrfToken,
  rotateCsrfFromResponse,
};
