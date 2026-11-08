import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi } from './admin';
import { apiClient } from './client';

describe('admin metrics API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requests the admin endpoint and returns its registered totals', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue(new Response(JSON.stringify({ orders: 101, vendors: 2, products: 3 }), { status: 200 }));
    expect(await adminApi.getMetrics()).toEqual({ orders: 101, vendors: 2, products: 3 });
    expect(get).toHaveBeenCalledWith('/api/v1/admin/metrics');
  });

  it('rejects non-success responses', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue(new Response(null, { status: 503 }));
    await expect(adminApi.getMetrics()).rejects.toThrow('Unable to load registered totals');
  });
});
