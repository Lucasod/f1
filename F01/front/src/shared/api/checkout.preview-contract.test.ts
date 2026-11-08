import { expect, it, vi } from 'vitest';
import { checkoutApi } from './checkout';
import { apiClient } from './client';

vi.mock('./client', () => ({ apiClient: { get: vi.fn() } }));

it('unwraps plain preview and rejects unvalidated coupon envelopes while encoding multiple codes', async () => {
  const preview = { vendorGroups: [], totalAmount: 9, discountAmount: 0 };
  vi.mocked(apiClient.get).mockResolvedValue({ ok: true, json: async () => ({ preview }) } as Response);
  await expect(checkoutApi.preview()).resolves.toEqual(preview);
  await expect(checkoutApi.preview(['ONE', 'TWO'])).rejects.toMatchObject({ code: 'INVALID_COUPON_QUOTE' });
  const calls = vi.mocked(apiClient.get).mock.calls;
  const params = new URLSearchParams(calls[calls.length - 1][0].split('?')[1]);
  expect(params.getAll('couponCodes')).toEqual(['ONE', 'TWO']);
});
