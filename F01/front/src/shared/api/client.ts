const GUEST_CART_ID_KEY = 'guestCartId';

function getGuestCartId(): string | null {
  return localStorage.getItem(GUEST_CART_ID_KEY);
}

function setGuestCartId(id: string): void {
  localStorage.setItem(GUEST_CART_ID_KEY, id);
}

function clearGuestCartId(): void {
  localStorage.removeItem(GUEST_CART_ID_KEY);
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function getGuestCartHeaders(): HeadersInit {
  const guestCartId = getGuestCartId();
  return guestCartId ? { 'X-Guest-Cart-Id': guestCartId } : {};
}

function buildHeaders(extraHeaders: HeadersInit = {}): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...getGuestCartHeaders(),
    ...extraHeaders,
  };
}

function handleResponseHeaders(response: Response): void {
  const guestCartId = response.headers.get('X-Guest-Cart-Id');
  if (guestCartId) {
    setGuestCartId(guestCartId);
  }
}

/**
 * Error thrown by the apiClient when the server responds with a non-OK status.
 * Only a safe server error code and a generic message are exposed; internal
 * details (stack traces, debug messages, database errors, etc.) are discarded
 * so they never reach the UI.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: string;
  message?: unknown;
}

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/**
 * Extracts only safe error information from a non-OK response. The server
 * error `error` code is preserved when present; any internal `message`,
 * `stack` or debug fields are discarded.
 */
async function extractSafeError(response: Response): Promise<{ code?: string; message: string }> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  let code: string | undefined;
  if (isErrorBody(body) && typeof body.error === 'string') {
    code = body.error;
  }
  return { code, message: `Request failed with status ${response.status}` };
}

export const apiClient = {
  getAuthHeaders,
  getGuestCartId,
  setGuestCartId,
  clearGuestCartId,

  async get(url: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      method: 'GET',
      headers: buildHeaders(options.headers),
    });
    handleResponseHeaders(response);
    if (!response.ok) {
      const safeError = await extractSafeError(response);
      throw new ApiError(safeError.message, response.status, safeError.code);
    }
    return response;
  },

  async post(url: string, body: unknown, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      method: 'POST',
      headers: buildHeaders(options.headers),
      body: JSON.stringify(body),
    });
    handleResponseHeaders(response);
    if (!response.ok) {
      const safeError = await extractSafeError(response);
      throw new ApiError(safeError.message, response.status, safeError.code);
    }
    return response;
  },

  async patch(url: string, body: unknown, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      method: 'PATCH',
      headers: buildHeaders(options.headers),
      body: JSON.stringify(body),
    });
    handleResponseHeaders(response);
    if (!response.ok) {
      const safeError = await extractSafeError(response);
      throw new ApiError(safeError.message, response.status, safeError.code);
    }
    return response;
  },

  async delete(url: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      method: 'DELETE',
      headers: buildHeaders(options.headers),
    });
    handleResponseHeaders(response);
    if (!response.ok) {
      const safeError = await extractSafeError(response);
      throw new ApiError(safeError.message, response.status, safeError.code);
    }
    return response;
  },
};