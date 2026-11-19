import { connectToMongo, closeMongoConnection } from '../src/shared/database/mongo.client.js';
import { MongoProductRepository } from '../src/modules/product/product.mongo.repository.js';
import { repairSeedImages } from '../src/scripts/seed.image-repair.js';

async function main(): Promise<void> {
  const db = await connectToMongo();
  try {
    const result = await repairSeedImages(new MongoProductRepository(db));
    console.log(`Seed image references: ${result.updated} updated, ${result.unchanged} unchanged.`);
  } finally {
    await closeMongoConnection();
  }
}

if (process.argv[1]?.endsWith('repair-seed-images.ts') || process.argv[1]?.endsWith('repair-seed-images.js')) {
  main().catch(() => { console.error('Seed image repair failed.'); process.exitCode = 1; });
}
