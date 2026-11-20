import { describe, expect, it, vi } from 'vitest';
import { repairSeedImages } from './seed.image-repair';
import { runSeed } from './seed';
import { InMemoryPersonRepository } from '../modules/person/person.domain';
import { InMemoryVendorRepository } from '../modules/vendor/vendor.domain';
import { InMemoryProductRepository, InMemoryCategoryRepository } from '../modules/product/product.domain';

describe('seed product image references', () => {
  it('uses the authorized product path for every newly seeded image', async () => {
    const productRepo = new InMemoryProductRepository();
    await runSeed({ personRepo: new InMemoryPersonRepository(), vendorRepo: new InMemoryVendorRepository(), categoryRepo: new InMemoryCategoryRepository(), productRepo });
    const products = await productRepo.findAll();
    expect(products).toHaveLength(12);
    for (const product of products) {
      const imageName = product.seedIdentity === 'fs01:product:tech-iphone-15-pro' ? 'main-shyphone.png' : product.seedIdentity === 'fs01:product:tech-macbook-pro-16' ? 'main-shybook.png' : product.seedIdentity === 'fs01:product:tech-ipad-pro' ? 'main-shypad.png' : product.seedIdentity === 'fs01:product:tech-airpods-pro' ? 'main-shyrpods.png' : 'main.webp';
      expect(product.images).toEqual([`products/${product.vendorId}/${product.id}/${imageName}`]);
    }
  });
  it('uses the fictional SHYPHONE brand for the seeded phone', async () => {
    const productRepo = new InMemoryProductRepository();
    await runSeed({ personRepo: new InMemoryPersonRepository(), vendorRepo: new InMemoryVendorRepository(), categoryRepo: new InMemoryCategoryRepository(), productRepo });
    const product = (await productRepo.findAll()).find(p => p.seedIdentity === 'fs01:product:tech-iphone-15-pro');
    expect(product?.name).toBe('SHYPHONE 15 Pro');
    expect(product?.description).toContain('SHYPHONE');
    expect(product?.images).toEqual([`products/${product?.vendorId}/${product?.id}/main-shyphone.png`]);
  });
  it('uses the fictional SHYBOOK brand for the seeded laptop', async () => {
    const productRepo = new InMemoryProductRepository();
    await runSeed({ personRepo: new InMemoryPersonRepository(), vendorRepo: new InMemoryVendorRepository(), categoryRepo: new InMemoryCategoryRepository(), productRepo });
    const product = (await productRepo.findAll()).find(p => p.seedIdentity === 'fs01:product:tech-macbook-pro-16');
    expect(product?.name).toBe('SHYBOOK Pro 16');
    expect(product?.description).toContain('SHYBOOK');
    expect(product?.images).toEqual([`products/${product?.vendorId}/${product?.id}/main-shybook.png`]);
  });
  it.each([
    ['fs01:product:tech-ipad-pro', 'SHYPAD Pro', 'main-shypad.png'],
    ['fs01:product:tech-airpods-pro', 'SHYRPODS Pro', 'main-shyrpods.png'],
  ])('uses the fictional demo brand for %s', async (identity, name, file) => {
    const productRepo = new InMemoryProductRepository();
    await runSeed({ personRepo: new InMemoryPersonRepository(), vendorRepo: new InMemoryVendorRepository(), categoryRepo: new InMemoryCategoryRepository(), productRepo });
    const product = (await productRepo.findAll()).find(p => p.seedIdentity === identity);
    expect(product?.name).toBe(name);
    expect(product?.images).toEqual([`products/${product?.vendorId}/${product?.id}/${file}`]);
  });
  it('repairs only the known seed definitions through the conditional repository operation', async () => {
    const repairSeedImage = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await repairSeedImages({ repairSeedImage })).toEqual({ updated: 1, unchanged: 11 });
    expect(repairSeedImage).toHaveBeenCalledTimes(12);
    expect(repairSeedImage).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'fs01:product:tech-iphone-15-pro', 'seed/products/tech-iphone-15-pro/main.webp', 'main-shyphone.png');
  });

});
