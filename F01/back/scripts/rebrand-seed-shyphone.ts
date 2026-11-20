import { connectToMongo, closeMongoConnection } from '../src/shared/database/mongo.client.js';
import { MongoProductRepository } from '../src/modules/product/product.mongo.repository.js';
import { PRODUCTS, VENDORS } from '../src/scripts/seed.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('DEMO_SEED_PRODUCTION_FORBIDDEN');
  const product = PRODUCTS.find(item => item.seedIdentity === 'fs01:product:tech-iphone-15-pro');
  const vendor = VENDORS.find(item => item.slug === product?.vendorSlug);
  if (!product || !vendor) throw new Error('SEED_DEFINITION_INVALID');
  const base = `products/${vendor.id}/${product.id}`;
  const db = await connectToMongo();
  try {
    const updated = await new MongoProductRepository(db).rebrandSeedProduct({
      productId: product.id, vendorId: vendor.id, seedIdentity: product.seedIdentity,
      oldName: 'iPhone 15 Pro', oldDescription: 'Latest iPhone with A17 Pro chip, titanium design, and advanced camera system.', oldImage: `${base}/main.webp`,
      newName: product.name, newDescription: product.description, newImage: `${base}/main-shyphone.png`,
    });
    console.log(updated ? 'Seed phone rebranded.' : 'Seed phone unchanged; verify existing fields before proceeding.');
  } finally {
    await closeMongoConnection();
  }
}

if (process.argv[1]?.endsWith('rebrand-seed-shyphone.ts') || process.argv[1]?.endsWith('rebrand-seed-shyphone.js')) {
  main().catch(() => { console.error('Seed phone rebrand failed.'); process.exitCode = 1; });
}
