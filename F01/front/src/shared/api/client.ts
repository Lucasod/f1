export const apiClient = {
  getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('accessToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  async get(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...options,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...options.headers,
      },
    });
  },

  async post(url: string, body: unknown, options: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...options.headers,
      },
      body: JSON.stringify(body),
    });
  },

  async patch(url: string, body: unknown, options: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...options.headers,
      },
      body: JSON.stringify(body),
    });
  },

  async delete(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...options,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...options.headers,
      },
    });
  },
};