#!/bin/bash
# Reset script: drops all MongoDB collections to start fresh.
# This prevents stale data issues in E2E tests.
export NODE_PATH=/home/workstation/source/f1/F01/back/node_modules
node -e "
const { MongoClient } = require('mongodb');
const uri = 'mongodb://localhost:27017';
const dbName = 'fs01_marketplace';
const client = new MongoClient(uri);
client.connect().then(async () => {
  const db = client.db(dbName);
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.collection(col.name).drop();
    console.log('Dropped collection: ' + col.name);
  }
  await client.close();
  console.log('Database reset complete.');
}).catch(err => { console.error('Reset failed:', err); process.exit(1); });
"
