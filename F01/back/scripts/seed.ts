import { closeMongoConnection, connectToMongo, initializeCollections } from '../src/shared/database/mongo.client.js';
import { createMongoSeedRepositories, runSeed, validateSeedEnvironment, ACCOUNTS, VENDORS } from '../src/scripts/seed.js';

import Stripe from 'stripe';
import { reconcileSeedStripeAfterReset, validatePostResetStripeEnvironment } from '../src/scripts/seed.stripe-reconciliation.js';

async function seedMongoDatabase(): Promise<void> {
  validateSeedEnvironment();
  const afterReset = process.argv.includes('--after-reset');
  if (afterReset) validatePostResetStripeEnvironment(process.env);
  const database = await connectToMongo();

  try {
    await initializeCollections();
    const repositories = createMongoSeedRepositories(database);
    await runSeed(repositories);
    if (afterReset) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
      const personIds = [...new Set([...ACCOUNTS.map(account => account.id), ...VENDORS.map(vendor => vendor.personId)])];
      await reconcileSeedStripeAfterReset(stripe, repositories.personRepo, repositories.vendorRepo, personIds, process.env);
    }
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
