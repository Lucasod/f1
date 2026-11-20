import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { cartApi } from './cart';

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    setGuestCartId: vi.fn(),
    clearGuestCartId: vi.fn(),
  },
}));

describe('cartApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the root-level guest cart ID returned by the cart API', async () => {
    const guestCartId = 'guest:12345678-1234-4123-8123-123456789abc';
    vi.mocked(apiClient.get).mockResolvedValueOnce(new Response(JSON.stringify({
      cart: {
        id: guestCartId,
        items: [],
        version: 1,
        updatedAt: '2026-11-01T00:00:00Z',
      },
      guestCartId,
    }), { status: 200 }));

    await cartApi.getCart();

    expect(apiClient.setGuestCartId).toHaveBeenCalledWith(guestCartId);
  });
});
