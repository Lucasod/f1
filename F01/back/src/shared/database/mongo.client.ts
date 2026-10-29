import { MongoClient, Db } from 'mongodb';
import { config } from '../../config';

let mongoClient: MongoClient | null = null;
let db: Db | null = null;

export async function connectToMongo(): Promise<Db> {
  if (db) {
    return db;
  }

  mongoClient = new MongoClient(config.mongoUri);
  await mongoClient.connect();
  db = mongoClient.db(config.mongoDbName);

  console.log(`Connected to MongoDB: ${config.mongoDbName}`);

  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error('MongoDB not connected. Call connectToMongo() first.');
  }
  return db;
}

export async function closeMongoConnection(): Promise<void> {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}

export async function initializeCollections(): Promise<void> {
  const database = await connectToMongo();

  const peopleCollection = database.collection('people');
  const mainInfosCollection = database.collection('main_infos');
  const credentialsCollection = database.collection('credentials');
  const addressesCollection = database.collection('addresses');
  const contactInfosCollection = database.collection('contact_infos');
  const vendorsCollection = database.collection('vendors');
  const categoriesCollection = database.collection('categories');
  const productsCollection = database.collection('products');

  // Create indexes
  await Promise.all([
    // People indexes
    peopleCollection.createIndex({ roles: 1 }),
    mainInfosCollection.createIndex({ person_id: 1 }, { unique: true }),
    mainInfosCollection.createIndex({ 'tax_id.value': 1 }, { unique: true }),
    credentialsCollection.createIndex({ person_id: 1 }, { unique: true }),
    addressesCollection.createIndex({ person_id: 1, is_primary: -1 }),
    contactInfosCollection.createIndex({ person_id: 1 }),
    contactInfosCollection.createIndex(
      { type: 1, value: 1 },
      { unique: true, partialFilterExpression: { type: 'email' } }
    ),

    // Vendors indexes
    vendorsCollection.createIndex(
      { slug: 1 },
      { unique: true, collation: { locale: 'en', strength: 2 } }
    ),
    vendorsCollection.createIndex({ personId: 1 }, { unique: true }),

    // Categories indexes
    categoriesCollection.createIndex(
      { slug: 1 },
      { unique: true, collation: { locale: 'en', strength: 2 } }
    ),
    categoriesCollection.createIndex({ parentId: 1 }),
    categoriesCollection.createIndex({ path: 1 }),

    // Products indexes
    productsCollection.createIndex({ vendorId: 1 }),
    productsCollection.createIndex({ categoryId: 1 }),
  ]);

  console.log('MongoDB collections and indexes initialized');
}