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
import { createProductRoutes, createCategoryRoutes } from './modules/product/product.routes';

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
app.use('/api/v1/products', createProductRoutes({ authService, productService, personRepo, vendorRepo }));

// Category routes
app.use('/api/v1/categories', createCategoryRoutes({ authService, productService, personRepo, vendorRepo }));

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
  });
}