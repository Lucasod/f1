import { closeMongoConnection, connectToMongo, initializeCollections } from '../src/shared/database/mongo.client.js';
import { createMongoSeedRepositories, runSeed, validateSeedEnvironment } from '../src/scripts/seed.js';

async function seedMongoDatabase(): Promise<void> {
  validateSeedEnvironment();
  const database = await connectToMongo();

  try {
    await initializeCollections();
    await runSeed(createMongoSeedRepositories(database));
  } finally {
    await closeMongoConnection();
  }
}

if (process.argv[1]?.endsWith('scripts/seed.ts') || process.argv[1]?.endsWith('scripts/seed.js')) {
  seedMongoDatabase().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
