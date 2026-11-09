// Reset script: drops all MongoDB collections to start fresh.
// This prevents stale data issues in E2E tests.
const { MongoClient } = require('mongodb');

async function main() {
  const uri = 'mongodb://localhost:27017';
  const dbName = 'fs01_marketplace';

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // List all collection names
  const collections = await db.listCollections().toArray();
  
  for (const collection of collections) {
    await db.collection(collection.name).drop();
    console.log('Dropped collection: ' + collection.name);
  }

  await client.close();
  console.log('Database reset complete.');
}

main().catch(err => {
  console.error('Database reset failed:', err);
  process.exit(1);
});
