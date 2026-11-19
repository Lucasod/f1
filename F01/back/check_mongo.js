import { MongoClient } from 'mongodb';
const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/fs01_marketplace';
const client = new MongoClient(uri);
client.connect().then(async () => {
  const db = client.db('fs01_marketplace');
  const vendors = await db.collection('vendors').find().toArray();
  console.log('Vendors:', JSON.stringify(vendors.map(v => ({ _id: v._id, id: v.id, personId: v.personId, stripeAccountId: v.stripeAccountId, seedConnectHistory: v.seedConnectHistory })), null, 2));
  const control = await db.collection('seed_connect_control').findOne({ _id: 'f01' });
  console.log('Seed connect control:', JSON.stringify(control, null, 2));
  await client.close();
}).catch(e => console.error(e));
