import { config } from '../config/index.js';
import { connectToMongo, closeMongoConnection } from '../shared/database/mongo.client.js';
import { createMongoSeedRepositories } from './seed.js';
import { seedDemoOrders, validateDemoDatabase, validateDemoOrdersEnvironment } from './seed.demo-orders.js';
import { MongoOrderRepository } from '../modules/order/order.mongo.repository.js';
import { MongoPaymentRepository } from '../modules/order/payment.mongo.repository.js';

async function main(): Promise<void> {
  validateDemoOrdersEnvironment(process.env);
  validateDemoDatabase(config.mongoUri, config.mongoDbName);
  const database = await connectToMongo();
  try {
    await seedDemoOrders({ ...createMongoSeedRepositories(database), orderRepo: new MongoOrderRepository(database), paymentRepo: new MongoPaymentRepository(database) }, process.env);
    console.log('Simulated demo orders prepared. No Stripe payment was made.');
  } finally {
    await closeMongoConnection();
  }
}

main().catch(() => { console.error('Could not prepare simulated demo orders.'); process.exitCode = 1; });
