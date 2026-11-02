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
    return response;
  },

  async delete(url: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      method: 'DELETE',
      headers: buildHeaders(options.headers),
    });
    handleResponseHeaders(response);
    return response;
  },
};