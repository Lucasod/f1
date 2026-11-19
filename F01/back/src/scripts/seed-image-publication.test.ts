import { describe, expect, it, vi } from 'vitest';
import { publishSeedBrandImages } from './seed-image-publication';
import { PRODUCTS, VENDORS } from './seed';

describe('seed brand image publication', () => {
  it('uses the seed identities and conditional writes for all four images', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValue(Buffer.from('fixture'));
    await publishSeedBrandImages({ put, read });
    const entries = PRODUCTS.filter(product => product.imageFilename);
    expect(entries).toHaveLength(4);
    expect(put).toHaveBeenCalledTimes(4);
    for (const product of entries) {
      const vendor = VENDORS.find(item => item.slug === product.vendorSlug)!;
      expect(put).toHaveBeenCalledWith(`products/${vendor.id}/${product.id}/${product.imageFilename}`, expect.any(Buffer));
    }
  });
  it('stops on a write conflict rather than overwriting an existing object', async () => {
    const put = vi.fn().mockRejectedValue(new Error('conflict'));
    await expect(publishSeedBrandImages({ put, read: async () => Buffer.from('fixture') })).rejects.toThrow('conflict');
    expect(put).toHaveBeenCalledTimes(1);
  });
});
