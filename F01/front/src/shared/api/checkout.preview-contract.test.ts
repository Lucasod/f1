import { expect, it, vi } from 'vitest';
import { checkoutApi } from './checkout';
import { apiClient } from './client';

vi.mock('./client', () => ({ apiClient: { get: vi.fn() } }));

it('unwraps the existing backend preview envelope and encodes multiple coupon codes', async () => {
  const preview = { vendorGroups: [], totalAmount: 9, discountAmount: 0 };
  vi.mocked(apiClient.get).mockResolvedValue({ ok: true, json: async () => ({ preview }) } as Response);
  await expect(checkoutApi.preview(['ONE', 'TWO'])).resolves.toEqual(preview);
  const params = new URLSearchParams(vi.mocked(apiClient.get).mock.calls[0][0].split('?')[1]);
  expect(params.getAll('couponCodes')).toEqual(['ONE', 'TWO']);
});
