import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config';
import { InMemoryPersonRepository } from './modules/person/person.domain';
import { InMemoryVendorRepository } from './modules/vendor/vendor.domain';
import { InMemoryProductRepository, InMemoryCategoryRepository } from './modules/product/product.domain';
import { AuthService } from './modules/auth/auth.service';
import { VendorService } from './modules/vendor/vendor.service';
import { ProductService } from './modules/product/product.service';
import { PersonService } from './modules/person/person.service';
import { createAuthRoutes } from './modules/auth/auth.routes';
import { createVendorRoutes } from './modules/vendor/vendor.routes';
import { createProductRoutes, createCategoryRoutes, createUploadRoutes } from './modules/product/product.routes';
import { createCartRoutes } from './modules/cart/cart.routes';
import { CartService } from './modules/cart/cart.service';
import { RedisCartRepository } from './modules/cart/cart.redis.repository';
import { CartRepository, InMemoryCartRepository } from './modules/cart/cart.domain';
import { createCheckoutRoutes } from './modules/checkout/checkout.routes';
import { CheckoutService } from './modules/checkout/checkout.service';
import { createOrderRoutes } from './modules/order/order.routes';
import { OrderService } from './modules/order/order.service';
import { PaymentService } from './modules/order/payment.service';
import { createPersonRoutes } from './modules/person/person.routes';
import { createReviewRoutes } from './modules/review/review.routes';
import { createPaymentRoutes } from './modules/order/payment.routes';
import { createPayoutRoutes } from './modules/payout/payout.routes';
import { PayoutService } from './modules/payout/payout.service';
import { InMemoryReviewRepository, ReviewRepository } from './modules/review/review.domain';
import { InMemoryPayoutRepository, PayoutRepository } from './modules/payout/payout.domain';
import { ReviewService } from './modules/review/review.service';
import { LocalStorageAdapter } from './shared/storage/local.adapter';
import { runDevelopmentSeed as seedDevelopmentData } from './scripts/seed.js';
import { SeedRepositories } from './shared/seed.types';

// MongoDB repositories and client
import { MongoPersonRepository } from './modules/person/person.mongo.repository';
import { MongoVendorRepository } from './modules/vendor/vendor.mongo.repository';
import { MongoCategoryRepository } from './modules/product/category.mongo.repository';
import { MongoProductRepository } from './modules/product/product.mongo.repository';
import { MongoReviewRepository } from './modules/review/review.mongo.repository';
import { MongoOrderRepository } from './modules/order/order.mongo.repository';
import { MongoPaymentRepository } from './modules/order/payment.mongo.repository';
import { connectToMongo, initializeCollections, closeMongoConnection, getDb } from './shared/database/mongo.client';

// Repository interfaces
import { PersonRepository } from './modules/person/person.domain';
import { VendorRepository } from './modules/vendor/vendor.domain';
import { ProductRepository, CategoryRepository } from './modules/product/product.domain';
import { OrderRepository, InMemoryOrderRepository, PaymentRepository, InMemoryPaymentRepository } from './modules/order/order.domain';

validateConfig();

const app = express();

// Repository instances - will be initialized after MongoDB connection
let personRepo: PersonRepository;
let vendorRepo: VendorRepository;
let productRepo: ProductRepository;
let categoryRepo: CategoryRepository;
let cartRepo: CartRepository;
let orderRepo: OrderRepository;
let paymentRepo: PaymentRepository;
let reviewRepo: ReviewRepository;
let payoutRepo: PayoutRepository;

// Initialize services (will be recreated after repositories are set)
let authService!: AuthService;
let vendorService!: VendorService;
let productService!: ProductService;
let cartService!: CartService;
let checkoutService!: CheckoutService;
let orderService!: OrderService;
let personService!: PersonService;
let reviewService!: ReviewService;
let paymentService!: PaymentService;
let payoutService!: PayoutService;

// Initialize storage adapter
const storageAdapter = new LocalStorageAdapter();

// Initialize cart repository (Redis)
cartRepo = new RedisCartRepository();

function initializeServices(): void {
  authService = new AuthService(personRepo, config.jwtSecret, config.jwtExpiresIn, '30d');
  vendorService = new VendorService(vendorRepo, personRepo, config);
  productService = new ProductService(productRepo, categoryRepo, vendorRepo, config);
  cartService = new CartService(cartRepo, productRepo, vendorRepo, config);
  checkoutService = new CheckoutService(orderRepo, paymentRepo, cartRepo, productRepo, vendorRepo, personRepo, cartService, config);
  orderService = new OrderService(orderRepo, paymentRepo, personRepo, vendorRepo, config);
  personService = new PersonService(personRepo);
reviewService = new ReviewService(reviewRepo, orderRepo, productRepo, storageAdapter);
paymentService = new PaymentService(paymentRepo, orderRepo);
payoutService = new PayoutService(payoutRepo, vendorRepo, orderRepo);
}

// Seed the catalog only when empty, but always reconcile demo accounts.
async function runDevelopmentSeed(): Promise<void> {
  if (config.nodeEnv !== 'development') {
    return;
  }

  const seedRepos: SeedRepositories = {
    personRepo,
    vendorRepo,
    categoryRepo,
    productRepo,
  };

  await seedDevelopmentData(seedRepos);
  console.log('✅ Development seed completed');
}

// Run orphaned file cleanup on startup
async function runStartupCleanup() {
  try {
    // Get all products to collect referenced image URLs
    const products = await productService.listProducts();
    const referencedUrls: string[] = [];
    for (const product of products) {
      if (product.images && product.images.length > 0) {
        referencedUrls.push(...product.images);
      }
    }
    referencedUrls.push(...await reviewService.getReviewImageUrls());

    const result = await storageAdapter.cleanupOrphanedFiles(referencedUrls);
    console.log(`Startup cleanup: removed ${result.deletedCount} orphaned files`);
  } catch (error) {
    console.error('Startup cleanup failed:', error);
  }
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, starting graceful shutdown...`);

  try {
    await closeMongoConnection();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
  }

  console.log('Graceful shutdown complete');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

app.use(helmet());
app.use(cors({
  origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
  credentials: true
}));
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export { app };

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  // Run startup tasks before listening (IIFE for top-level await in CommonJS)
  (async () => {
    try {
      // Connect to MongoDB
      console.log('Connecting to MongoDB...');
      await connectToMongo();

      // Initialize collections and indexes
      console.log('Initializing collections and indexes...');
      await initializeCollections();

      // Create MongoDB repository instances
      console.log('Creating MongoDB repository instances...');
      const db = getDb();
      personRepo = new MongoPersonRepository(db);
      vendorRepo = new MongoVendorRepository(db);
      categoryRepo = new MongoCategoryRepository(db);
      productRepo = new MongoProductRepository(db);
reviewRepo = new MongoReviewRepository(db);
orderRepo = new MongoOrderRepository(db);
paymentRepo = new MongoPaymentRepository(db);
payoutRepo = new InMemoryPayoutRepository();

      // Initialize services with MongoDB repositories
      initializeServices();
      console.log('✅ MongoDB repositories initialized');

      // Register routes after services are initialized
      // Auth routes
      app.use('/api/v1/auth', createAuthRoutes({ authService }));

      // Vendor routes
      app.use('/api/v1/vendor', createVendorRoutes({ authService, vendorService, personRepo }));

      // Product routes
      app.use('/api/v1/products', createProductRoutes({ authService, productService, personRepo, vendorRepo, storageAdapter }));

      // Category routes
      app.use('/api/v1/categories', createCategoryRoutes({ authService, productService, personRepo, vendorRepo, storageAdapter }));

      // Upload routes (public)
      app.use('/api/v1/uploads', createUploadRoutes({ storageAdapter }));

      // Cart routes
      app.use('/api/v1/cart', createCartRoutes({ authService, cartService, personRepo }));

      // Checkout routes
      app.use('/api/v1/checkout', createCheckoutRoutes({ authService, checkoutService, personRepo }));

      // Order routes
      app.use('/api/v1/orders', createOrderRoutes({ authService, orderService, personRepo, vendorRepo }));

      // Payment routes (T-1004)
      app.use('/api/v1/payments', createPaymentRoutes({ authService, paymentService, vendorRepo, orderRepo }));

      // Payout routes (T-1003)
      app.use('/api/v1/payouts', createPayoutRoutes({ authService, payoutService, vendorRepo }));

      // Person routes
      app.use('/api/v1/person', createPersonRoutes({ authService, personService, personRepo }));

      // Review routes
      app.use('/api/v1', createReviewRoutes({ authService, reviewService }));

      // 404 handler - must be after all routes
      app.use((_req: Request, res: Response) => {
        res.status(404).json({ error: 'Not found' });
      });

      // Error handler
      app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        console.error('Error:', err);
        res.status(500).json({ error: 'Internal server error' });
      });

    } catch (mongoError) {
      console.error('⚠️  MongoDB connection failed:', mongoError);

      // Fallback to InMemory repositories in development mode
      if (config.nodeEnv === 'development') {
        console.log('🔄 Falling back to InMemory repositories for development...');
        personRepo = new InMemoryPersonRepository();
        vendorRepo = new InMemoryVendorRepository();
        categoryRepo = new InMemoryCategoryRepository();
        productRepo = new InMemoryProductRepository();
        cartRepo = new InMemoryCartRepository();
        orderRepo = new InMemoryOrderRepository();
paymentRepo = new InMemoryPaymentRepository();
reviewRepo = new InMemoryReviewRepository();
payoutRepo = new InMemoryPayoutRepository();

        initializeServices();
        console.log('✅ InMemory repositories initialized (development fallback)');

        // Register routes after services are initialized (fallback path)
        // Auth routes
        app.use('/api/v1/auth', createAuthRoutes({ authService }));

        // Vendor routes
        app.use('/api/v1/vendor', createVendorRoutes({ authService, vendorService, personRepo }));

        // Product routes
        app.use('/api/v1/products', createProductRoutes({ authService, productService, personRepo, vendorRepo, storageAdapter }));

        // Category routes
        app.use('/api/v1/categories', createCategoryRoutes({ authService, productService, personRepo, vendorRepo, storageAdapter }));

        // Upload routes (public)
        app.use('/api/v1/uploads', createUploadRoutes({ storageAdapter }));

        // Cart routes
        app.use('/api/v1/cart', createCartRoutes({ authService, cartService, personRepo }));

        // Checkout routes
        app.use('/api/v1/checkout', createCheckoutRoutes({ authService, checkoutService, personRepo }));

        // Order routes
        app.use('/api/v1/orders', createOrderRoutes({ authService, orderService, personRepo, vendorRepo }));

        // Payment routes (T-1004)
        app.use('/api/v1/payments', createPaymentRoutes({ authService, paymentService, vendorRepo, orderRepo }));

        // Payout routes (T-1003)
        app.use('/api/v1/payouts', createPayoutRoutes({ authService, payoutService, vendorRepo }));

        // Person routes
        app.use('/api/v1/person', createPersonRoutes({ authService, personService, personRepo }));

        // Review routes
        app.use('/api/v1', createReviewRoutes({ authService, reviewService }));
      } else {
        // In production, MongoDB is required
        console.error('❌ MongoDB is required in production mode. Exiting...');
        process.exit(1);
      }
    }

    // Run development seed before cleanup
    await runDevelopmentSeed();

    // Run startup cleanup
    if (config.enableStartupCleanup) {
      await runStartupCleanup();
    } else {
      console.log('Startup cleanup disabled (ENABLE_STARTUP_CLEANUP=false)');
    }

    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
    });
  })();
}