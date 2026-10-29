import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config';
import { InMemoryPersonRepository } from './modules/person/person.domain';
import { InMemoryVendorRepository } from './modules/vendor/vendor.domain';
import { AuthService } from './modules/auth/auth.service';
import { VendorService } from './modules/vendor/vendor.service';
import { createAuthRoutes } from './modules/auth/auth.routes';
import { createVendorRoutes } from './modules/vendor/vendor.routes';
import { ProductService } from './modules/product/product.service';
import { InMemoryProductRepository, InMemoryCategoryRepository } from './modules/product/product.domain';
import { createProductRoutes, createCategoryRoutes, createUploadRoutes } from './modules/product/product.routes';
import { LocalStorageAdapter } from './shared/storage/local.adapter';
import { runSeed } from './scripts/seed.js';
import { SeedRepositories } from './shared/seed.types';

validateConfig();

const app = express();

// Initialize repositories
const personRepo = new InMemoryPersonRepository();
const vendorRepo = new InMemoryVendorRepository();
const productRepo = new InMemoryProductRepository();
const categoryRepo = new InMemoryCategoryRepository();

// Initialize services
const authService = new AuthService(personRepo, config.jwtSecret, config.jwtExpiresIn, '30d');
const vendorService = new VendorService(vendorRepo, personRepo, config);
const productService = new ProductService(productRepo, categoryRepo, vendorRepo, config);

// Initialize storage adapter
const storageAdapter = new LocalStorageAdapter();

// Run seed in development mode if product repo is empty
async function runDevelopmentSeed(): Promise<void> {
  if (config.nodeEnv !== 'development') {
    return;
  }

  const existingProducts = await productRepo.findAll();
  if (existingProducts.length > 0) {
    console.log('Product repository not empty, skipping seed');
    return;
  }

  console.log('🌱 Development mode detected with empty product repository, running seed...');

  const seedRepos: SeedRepositories = {
    personRepo,
    vendorRepo,
    categoryRepo,
    productRepo,
  };

  await runSeed(seedRepos);
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

    const result = await storageAdapter.cleanupOrphanedFiles(referencedUrls);
    console.log(`Startup cleanup: removed ${result.deletedCount} orphaned files`);
  } catch (error) {
    console.error('Startup cleanup failed:', error);
  }
}

app.use(helmet());
app.use(cors({
  origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
  credentials: true
}));
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  // Run startup tasks before listening (IIFE for top-level await in CommonJS)
  (async () => {
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