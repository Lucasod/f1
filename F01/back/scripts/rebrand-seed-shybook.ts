import { connectToMongo, closeMongoConnection } from '../src/shared/database/mongo.client.js';
import { MongoProductRepository } from '../src/modules/product/product.mongo.repository.js';
import { PRODUCTS, VENDORS } from '../src/scripts/seed.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('DEMO_SEED_PRODUCTION_FORBIDDEN');
  const product = PRODUCTS.find(item => item.seedIdentity === 'fs01:product:tech-macbook-pro-16');
  const vendor = VENDORS.find(item => item.slug === product?.vendorSlug);
  if (!product || !vendor) throw new Error('SEED_DEFINITION_INVALID');
  const base = `products/${vendor.id}/${product.id}`;
  const db = await connectToMongo();
  try {
    const updated = await new MongoProductRepository(db).rebrandSeedProduct({
      productId: product.id, vendorId: vendor.id, seedIdentity: product.seedIdentity,
      oldName: 'MacBook Pro 16', oldDescription: 'Powerful laptop with M3 Max chip, 16-inch Liquid Retina XDR display.', oldImage: `${base}/main.webp`,
      newName: product.name, newDescription: product.description, newImage: `${base}/main-shybook.png`,
    });
    console.log(updated ? 'Seed laptop rebranded.' : 'Seed laptop unchanged; verify existing fields before proceeding.');
  } finally {
    await closeMongoConnection();
  }
}

if (process.argv[1]?.endsWith('rebrand-seed-shybook.ts') || process.argv[1]?.endsWith('rebrand-seed-shybook.js')) {
  main().catch(() => { console.error('Seed laptop rebrand failed.'); process.exitCode = 1; });
}
