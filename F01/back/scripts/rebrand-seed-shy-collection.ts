import { connectToMongo, closeMongoConnection } from '../src/shared/database/mongo.client.js';
import { MongoProductRepository } from '../src/modules/product/product.mongo.repository.js';
import { PRODUCTS, VENDORS } from '../src/scripts/seed.js';

const originals = [
  { identity: 'fs01:product:tech-ipad-pro', oldName: 'iPad Pro', oldDescription: 'iPad Pro with M2 chip, 12.9-inch Liquid Retina XDR display.' },
  { identity: 'fs01:product:tech-airpods-pro', oldName: 'AirPods Pro', oldDescription: 'Active noise cancelling wireless earbuds with transparency mode.' },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('DEMO_SEED_PRODUCTION_FORBIDDEN');
  const db = await connectToMongo();
  try {
    const repository = new MongoProductRepository(db);
    for (const original of originals) {
      const product = PRODUCTS.find(item => item.seedIdentity === original.identity);
      const vendor = VENDORS.find(item => item.slug === product?.vendorSlug);
      if (!product || !vendor || !product.imageFilename) throw new Error('SEED_DEFINITION_INVALID');
      const base = `products/${vendor.id}/${product.id}`;
      const updated = await repository.rebrandSeedProduct({ productId: product.id, vendorId: vendor.id, seedIdentity: product.seedIdentity, oldName: original.oldName, oldDescription: original.oldDescription, oldImage: `${base}/main.webp`, newName: product.name, newDescription: product.description, newImage: `${base}/${product.imageFilename}` });
      console.log(`${product.name}: ${updated ? 'updated' : 'unchanged; verify existing fields'}.`);
    }
  } finally { await closeMongoConnection(); }
}
if (process.argv[1]?.endsWith('rebrand-seed-shy-collection.ts') || process.argv[1]?.endsWith('rebrand-seed-shy-collection.js')) {
  main().catch(() => { console.error('Seed product rebrand failed.'); process.exitCode = 1; });
}
