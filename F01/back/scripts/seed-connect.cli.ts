import dotenv from 'dotenv';
import Stripe from 'stripe';
import { MongoClient } from 'mongodb';
import { VENDORS } from '../src/scripts/seed';
import { provisionSeedConnect, validateConnectSeedEnvironment } from '../src/scripts/seed.connect';
import { MongoSeedConnectStore } from '../src/scripts/seed.connect.mongo';

dotenv.config();
async function main(): Promise<void> {
  const run = process.argv[2] ?? '';
  validateConnectSeedEnvironment(process.env);
  if (process.env.MONGO_DB_NAME !== 'fs01_marketplace') throw new Error('SEED_CONNECT_F01_DB_REQUIRED');
  if (!process.env.MONGO_URI) throw new Error('SEED_CONNECT_MONGO_URI_REQUIRED');
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  try {
    const db = client.db('fs01_marketplace');
    const vendors = VENDORS.map(v => ({ id: v.id, personId: v.personId }));
    const count = await db.collection('vendors').countDocuments({ $or: vendors.map(v => ({ _id: v.id as never, personId: v.personId })) });
    if (count !== 3) throw new Error('SEED_CONNECT_VENDOR_SET_MISMATCH');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
    const accounts = await provisionSeedConnect(stripe, new MongoSeedConnectStore(db), vendors, run, process.env);
    console.log(JSON.stringify(accounts.map((a, i) => ({ vendor: vendors[i].id, account: a.id, details_submitted: a.details_submitted, charges_enabled: a.charges_enabled, payouts_enabled: a.payouts_enabled, capabilities: a.capabilities, requirements: a.requirements?.currently_due }))));
  } finally { await client.close(); }
}
main().catch((error: any) => { console.error(JSON.stringify({ error: error?.message, code: error?.code, status: error?.statusCode })); process.exitCode = 1; });
