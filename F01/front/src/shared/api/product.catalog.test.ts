import { expect, it, vi } from 'vitest';
import { productApi } from './product';
import { apiClient } from './client';

vi.mock('./client', () => ({ apiClient: { get: vi.fn() } }));

it('serializes catalog visibility with the requested filters and pagination', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ ok: true, json: async () => ({ products: [], total: 0, page: 2, limit: 1 }) } as Response);
  await productApi.list({ catalog: true, vendorId: 'vendor', categoryId: 'category', page: 2, limit: 1 });
  const url = vi.mocked(apiClient.get).mock.calls[0][0];
  const params = new URLSearchParams(url.split('?')[1]);
  expect(params.get('catalog')).toBe('true');
  expect(params.get('vendorId')).toBe('vendor');
  expect(params.get('categoryId')).toBe('category');
  expect(params.get('page')).toBe('2');
  expect(params.get('limit')).toBe('1');
  expect(params.has('status')).toBe(false);
});
