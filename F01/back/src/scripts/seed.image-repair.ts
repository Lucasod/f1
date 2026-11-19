import { PRODUCTS, VENDORS } from './seed';
import type { MongoProductRepository } from '../modules/product/product.mongo.repository';

export async function repairSeedImages(repository: Pick<MongoProductRepository, 'repairSeedImage'>): Promise<{ updated: number; unchanged: number }> {
  let updated = 0;
  for (const product of PRODUCTS) {
    const vendor = VENDORS.find(entry => entry.slug === product.vendorSlug);
    if (!vendor || product.images.length !== 1) throw new Error('SEED_IMAGE_DEFINITION_INVALID');
    if (await repository.repairSeedImage(product.id, vendor.id, product.seedIdentity, product.images[0], product.imageFilename ?? 'main.webp')) updated++;
  }
  return { updated, unchanged: PRODUCTS.length - updated };
}
