import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { InMemoryPersonRepository, Person } from '../person/person.domain';
import { InMemoryProductRepository, InMemoryCategoryRepository, ProductStatus } from './product.domain';
import { AuthService } from '../auth/auth.service';
import { ProductService } from './product.service';
import { createProductRoutes, createCategoryRoutes, createUploadRoutes } from './product.routes';
import { createAuthRoutes } from '../auth/auth.routes';
import { PersonRole } from '../person/person.domain';
import { InMemoryVendorRepository } from '../vendor/vendor.domain';
import { VendorService } from '../vendor/vendor.service';
import { createVendorRoutes } from '../vendor/vendor.routes';
import { config } from '../../config';
import { LocalStorageAdapter } from '../../shared/storage/local.adapter';
import { hashPassword } from '../auth/credential.domain';

// Valid test CPF/CNPJ values (these pass validation)
const VALID_CPF_1 = '52998224725';
const VALID_CPF_2 = '98765432100'; // Another valid CPF
const VALID_CNPJ_1 = '11222333000181';
const VALID_CNPJ_2 = '04252011000110'; // Valid CNPJ for testing

describe('Product Routes', () => {
  let app: express.Express;
  let personRepo: InMemoryPersonRepository;
  let vendorRepo: InMemoryVendorRepository;
  let productRepo: InMemoryProductRepository;
  let categoryRepo: InMemoryCategoryRepository;
  let authService: AuthService;
  let vendorService: VendorService;
  let productService: ProductService;
  let storageAdapter: LocalStorageAdapter;
  const testPassword =  process.env.TEST_USER_PASSWORD!;
  
  let vendorToken: string;
  let vendor2Token: string;
  let consumerToken: string;
  let adminToken: string;
  let vendorId: string;
  let vendor2Id: string;
  let vendorPersonId: string;
  let vendor2PersonId: string;
  let categoryId: string;
  let productId: string;
  const storageRoot = path.join(process.cwd(), 'test-storage', 'uploads');

  beforeEach(async () => {
    // Set storage root for serve endpoint
    process.env.STORAGE_ROOT = storageRoot;
    
    // Clean up test storage directory
    try {
      await fs.rm(storageRoot, { recursive: true, force: true });
    } catch {}
    
    personRepo = new InMemoryPersonRepository();
    vendorRepo = new InMemoryVendorRepository();
    productRepo = new InMemoryProductRepository();
    categoryRepo = new InMemoryCategoryRepository();
    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
    vendorService = new VendorService(vendorRepo, personRepo, config);
    productService = new ProductService(productRepo, categoryRepo, vendorRepo, config);
    storageAdapter = new LocalStorageAdapter(storageRoot, '/api/v1/uploads');

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));
    app.use('/api/v1/vendor', createVendorRoutes({ 
      authService, 
      vendorService,
      personRepo
    }));
    app.use('/api/v1/products', createProductRoutes({ 
      authService, 
      productService,
      personRepo,
      vendorRepo,
      storageAdapter
    }));
    app.use('/api/v1/uploads', createUploadRoutes({ storageAdapter, productRepo }));
    app.use('/api/v1/categories', createCategoryRoutes({ 
      authService, 
      productService,
      personRepo,
      vendorRepo
    }));

    // Register vendor 1 (as CONSUMER, then onboard to become vendor)
    const vendorRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'John Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: VALID_CNPJ_1,
        email: 'john@vendor.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });
    expect(vendorRegister.status).toBe(201);
    vendorToken = vendorRegister.body.tokens.accessToken;
    vendorPersonId = vendorRegister.body.person.id;

    // Onboard vendor 1
    const vendorOnboard = await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        storeName: 'John\'s Electronics',
        slug: 'johns-electronics'
      });
    expect(vendorOnboard.status).toBe(201);
    vendorId = vendorOnboard.body.vendor.id;

    // Login again to get fresh token with VENDOR role
    const vendorLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'john@vendor.com',
        password: testPassword
      });
    expect(vendorLogin.status).toBe(200);
    vendorToken = vendorLogin.body.tokens.accessToken;

    // Register vendor 2 (for ownership tests, as CONSUMER then onboard)
    const vendor2Register = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Jane Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: VALID_CNPJ_2,
        email: 'jane@vendor.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });
    expect(vendor2Register.status).toBe(201);
    vendor2Token = vendor2Register.body.tokens.accessToken;
    vendor2PersonId = vendor2Register.body.person.id;

    // Onboard vendor 2
    const vendor2Onboard = await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${vendor2Token}`)
      .send({
        storeName: 'Jane\'s Shop',
        slug: 'janes-shop'
      });
    expect(vendor2Onboard.status).toBe(201);
    vendor2Id = vendor2Onboard.body.vendor.id;

    // Login again to get fresh token with VENDOR role
    const vendor2Login = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'jane@vendor.com',
        password: testPassword
      });
    expect(vendor2Login.status).toBe(200);
    vendor2Token = vendor2Login.body.tokens.accessToken;

    // Register consumer
    const consumerRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Jane Consumer',
        taxIdType: 'CPF',
        taxIdValue: VALID_CPF_1,
        email: 'jane@consumer.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });
    expect(consumerRegister.status).toBe(201);
    consumerToken = consumerRegister.body.tokens.accessToken;

    // Create admin user directly in repository (bypassing register API which rejects ADMIN)
    const adminPerson = Person.create({
      name: 'Admin User',
      mainInfo: { name: 'Admin User', taxIdType: 'CPF', taxIdValue: VALID_CPF_2 },
      contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
      addresses: []
    });
    adminPerson.addRole(PersonRole.ADMIN);
    adminPerson.setCredential(await hashPassword(testPassword));
    await personRepo.save(adminPerson);
    
    // Login to get tokens
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@example.com',
        password: testPassword
      });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.tokens.accessToken;

    // Create test category (via admin)
    const categoryResponse = await request(app)
      .post('/api/v1/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Electronics',
        slug: 'electronics'
      });
    expect(categoryResponse.status).toBe(201);
    categoryId = categoryResponse.body.category.id;

    // Create a test product for image tests
    const productResponse = await request(app)
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        categoryId,
        name: 'Test Product for Images',
        description: 'Product for image testing',
        price: 99.99,
        quantity: 10
      });
    expect(productResponse.status).toBe(201);
    productId = productResponse.body.product.id;
  });

  describe('POST /api/v1/products - Create product', () => {
    it('should create product for vendor and return 201', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(201);
      expect(response.body.product).toBeDefined();
      expect(response.body.product.name).toBe('Test Product');
      expect(response.body.product.price).toBe(99.99);
      expect(response.body.product.quantity).toBe(10);
      expect(response.body.product.vendorId).toBe(vendorId);
      expect(response.body.product.categoryId).toBe(categoryId);
      expect(response.body.product.status).toBe(ProductStatus.ACTIVE);
    });

    it('should return 403 for consumer role', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${consumerToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 403 for admin role', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 401 for missing token', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });

    it('should return 400 for missing categoryId', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('CATEGORY_ID_REQUIRED');
    });

    it('should return 400 for missing name', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_NAME_REQUIRED');
    });

    it('should return 400 for missing description', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_DESCRIPTION_REQUIRED');
    });

    it('should return 400 for invalid price', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: -10,
          quantity: 10
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_PRICE_INVALID');
    });

    it('should return 400 for invalid quantity', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: -1
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_QUANTITY_INVALID');
    });

    it('should return 404 for non-existent category', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId: 'non-existent-category-id',
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_CATEGORY_NOT_FOUND');
    });

    it('should return 403 for suspended vendor (non-admin)', async () => {
      // Suspend the vendor first (as admin)
      await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Try to create product as suspended vendor
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('VENDOR_SUSPENDED');
      expect(response.body.message).toBe('Suspended vendor cannot perform this action');
    });
  });

  describe('Suspended vendor restrictions on product operations', () => {
    let suspendedVendorToken: string;
    let suspendedVendorId: string;
    let suspendedProductId: string;

    beforeEach(async () => {
      // Register a new vendor to suspend (use a unique CNPJ, as CONSUMER then onboard)
      const suspendedVendorRegister = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Suspended Vendor',
          taxIdType: 'CNPJ',
          taxIdValue: '12345678000195', // Unique valid CNPJ for testing
          email: 'suspended@vendor.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });
      expect(suspendedVendorRegister.status).toBe(201);
      suspendedVendorToken = suspendedVendorRegister.body.tokens.accessToken;

      const suspendedVendorOnboard = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${suspendedVendorToken}`)
        .send({
          storeName: 'Suspended Shop',
          slug: 'suspended-shop-' + Date.now()
        });
      expect(suspendedVendorOnboard.status).toBe(201);
      suspendedVendorId = suspendedVendorOnboard.body.vendor.id;

      // Login again to get fresh token with VENDOR role
      const suspendedVendorLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'suspended@vendor.com',
          password: testPassword
        });
      expect(suspendedVendorLogin.status).toBe(200);
      suspendedVendorToken = suspendedVendorLogin.body.tokens.accessToken;

      // Create a product for the suspended vendor BEFORE suspending (using vendor token)
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${suspendedVendorToken}`)
        .send({
          categoryId,
          name: 'Suspended Vendor Product',
          description: 'Product for suspended vendor',
          price: 50,
          quantity: 10
        });
      expect(productResponse.status).toBe(201);
      suspendedProductId = productResponse.body.product.id;

      // Now suspend the vendor
      await request(app)
        .patch(`/api/v1/vendor/vendors/${suspendedVendorId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`);
    });

    it('should return 403 for suspended vendor updating product', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}`)
        .set('Authorization', `Bearer ${suspendedVendorToken}`)
        .send({
          name: 'Updated Name'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('VENDOR_SUSPENDED');
    });

    it('should return 403 for suspended vendor updating stock', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/stock`)
        .set('Authorization', `Bearer ${suspendedVendorToken}`)
        .send({
          quantity: 20
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('VENDOR_SUSPENDED');
    });

    it('should return 403 for suspended vendor inactivating product', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/inactivate`)
        .set('Authorization', `Bearer ${suspendedVendorToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('VENDOR_SUSPENDED');
    });

    it('should return 403 for suspended vendor activating product', async () => {
      // First inactivate the product (by admin)
      await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/inactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/activate`)
        .set('Authorization', `Bearer ${suspendedVendorToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('VENDOR_SUSPENDED');
    });

    it('should return 403 for suspended vendor uploading images', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${suspendedProductId}/images`)
        .set('Authorization', `Bearer ${suspendedVendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('VENDOR_SUSPENDED');
    });

    it('should return 403 for suspended vendor deleting images', async () => {
      // First upload an image (by admin)
      const jpegBuffer = await createJpegBuffer(1024);
      const uploadResponse = await request(app)
        .post(`/api/v1/products/${suspendedProductId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', jpegBuffer, 'test.jpg');
      expect(uploadResponse.status).toBe(201);
      const imageKey = uploadResponse.body.image.key;

      // Try to delete as suspended vendor
      const response = await request(app)
        .delete(`/api/v1/products/${suspendedProductId}/images/${encodeURIComponent(imageKey)}`)
        .set('Authorization', `Bearer ${suspendedVendorToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('VENDOR_SUSPENDED');
    });

    it('should allow admin to update product for suspended vendor', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Admin Updated'
        });

      expect(response.status).toBe(200);
      expect(response.body.product.name).toBe('Admin Updated');
    });

    it('should allow admin to update stock for suspended vendor', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          quantity: 25
        });

      expect(response.status).toBe(200);
      expect(response.body.product.quantity).toBe(25);
    });

    it('should allow admin to inactivate product for suspended vendor', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/inactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.product.status).toBe(ProductStatus.INACTIVE);
    });

    it('should allow admin to activate product for suspended vendor', async () => {
      // First inactivate by admin
      await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/inactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      const response = await request(app)
        .patch(`/api/v1/products/${suspendedProductId}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.product.status).toBe(ProductStatus.ACTIVE);
    });

    it('should allow admin to upload images for suspended vendor', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${suspendedProductId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(201);
      expect(response.body.image).toBeDefined();
    });
  });

  describe('GET /api/v1/products/:productId - Get product by ID', () => {
    let productId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Test Product',
          description: 'A great product',
          price: 99.99,
          quantity: 10
        });
      productId = createResponse.body.product.id;
    });

    it('should return product with public access (200)', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${productId}`);

      expect(response.status).toBe(200);
      expect(response.body.product).toBeDefined();
      expect(response.body.product.id).toBe(productId);
      expect(response.body.product.name).toBe('Test Product');
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .get('/api/v1/products/non-existent-id');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('GET /api/v1/products - List products (public)', () => {
    let productId1: string;
    let productId2: string;

    beforeEach(async () => {
      const create1 = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Product 1',
          description: 'First product',
          price: 100,
          quantity: 5,
          status: ProductStatus.ACTIVE
        });
      productId1 = create1.body.product.id;

      const create2 = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Product 2',
          description: 'Second product',
          price: 200,
          quantity: 0,
          status: ProductStatus.OUT_OF_STOCK
        });
      productId2 = create2.body.product.id;

      // Create product from vendor 2
      await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendor2Token}`)
        .send({
          categoryId,
          name: 'Product 3',
          description: 'Third product',
          price: 300,
          quantity: 15,
          status: ProductStatus.ACTIVE
        });
    });

    it('should return all products with default pagination', async () => {
      const response = await request(app)
        .get('/api/v1/products');

      expect(response.status).toBe(200);
      expect(response.body.products).toBeDefined();
      expect(Array.isArray(response.body.products)).toBe(true);
      expect(response.body.products.length).toBe(4); // 3 from this describe + 1 global
      expect(response.body.total).toBe(4);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(20);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/products?status=active');

      expect(response.status).toBe(200);
      // 2 active from this describe + 1 active global = 3
      expect(response.body.products.length).toBe(3);
      expect(response.body.products.every((p: any) => p.status === ProductStatus.ACTIVE)).toBe(true);
    });

    it('should filter by vendorId', async () => {
      const response = await request(app)
        .get(`/api/v1/products?vendorId=${vendorId}`);

      expect(response.status).toBe(200);
      // 2 from vendor1 in this describe + 1 global = 3
      expect(response.body.products.length).toBe(3);
      expect(response.body.products.every((p: any) => p.vendorId === vendorId)).toBe(true);
    });

    it('should filter by categoryId', async () => {
      const response = await request(app)
        .get(`/api/v1/products?categoryId=${categoryId}`);

      expect(response.status).toBe(200);
      // All 4 products use the same category
      expect(response.body.products.length).toBe(4);
      expect(response.body.products.every((p: any) => p.categoryId === categoryId)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/products?page=1&limit=2');

      expect(response.status).toBe(200);
      expect(response.body.products.length).toBe(2);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(2);
      expect(response.body.total).toBe(4);
    });
  });

  describe('GET /api/v1/products/vendor/me - Get vendor products', () => {
    let productId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'My Product',
          description: 'My great product',
          price: 150,
          quantity: 8
        });
      productId = createResponse.body.product.id;
    });

    it('should return vendor\'s products (200)', async () => {
      const response = await request(app)
        .get('/api/v1/products/vendor/me')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.products).toBeDefined();
      expect(Array.isArray(response.body.products)).toBe(true);
      // 1 from this describe's beforeEach + 1 global = 2
      expect(response.body.products.length).toBe(2);
      // The product from this describe's beforeEach should be included
      expect(response.body.products.some((p: any) => p.id === productId)).toBe(true);
      expect(response.body.products.every((p: any) => p.vendorId === vendorId)).toBe(true);
    });

    it('should return 403 for consumer role', async () => {
      const response = await request(app)
        .get('/api/v1/products/vendor/me')
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 403 for admin role', async () => {
      const response = await request(app)
        .get('/api/v1/products/vendor/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 401 for missing token', async () => {
      const response = await request(app)
        .get('/api/v1/products/vendor/me');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });
  });

  describe('PATCH /api/v1/products/:productId - Update product', () => {
    let productId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Original Product',
          description: 'Original description',
          price: 100,
          quantity: 10
        });
      productId = createResponse.body.product.id;
    });

    it('should update product for owner vendor (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          name: 'Updated Product',
          price: 150
        });

      expect(response.status).toBe(200);
      expect(response.body.product.name).toBe('Updated Product');
      expect(response.body.product.price).toBe(150);
      expect(response.body.product.description).toBe('Original description'); // unchanged
    });

    it('should return 403 for other vendor (ownership violation)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendor2Token}`)
        .send({
          name: 'Hacked Product'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PRODUCT_OWNERSHIP_VIOLATION');
    });

    it('should allow admin to update any product (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Admin Updated Product'
        });

      expect(response.status).toBe(200);
      expect(response.body.product.name).toBe('Admin Updated Product');
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .patch('/api/v1/products/non-existent-id')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          name: 'Updated'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('should return 400 for empty name', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          name: ''
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_NAME_REQUIRED');
    });

    it('should return 400 for invalid price', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          price: -50
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_PRICE_INVALID');
    });

    it('should return 400 for invalid quantity', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          quantity: -1
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_QUANTITY_INVALID');
    });

    it('should return 400 for invalid status', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          status: 'invalid_status'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_STATUS_INVALID');
    });

    it('should return 404 for non-existent category', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId: 'non-existent-category'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_CATEGORY_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/products/:productId - Delete product', () => {
    let productId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Product to Delete',
          description: 'Will be deleted',
          price: 50,
          quantity: 5
        });
      productId = createResponse.body.product.id;
    });

    it('should delete product for owner vendor (204)', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(204);

      // Verify product is deleted
      const getResponse = await request(app)
        .get(`/api/v1/products/${productId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should return 403 for other vendor (ownership violation)', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${vendor2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PRODUCT_OWNERSHIP_VIOLATION');
    });

    it('should allow admin to delete any product (204)', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(204);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .delete('/api/v1/products/non-existent-id')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/products/:productId/stock - Update product stock', () => {
    let productId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Stock Product',
          description: 'Product for stock testing',
          price: 75,
          quantity: 10
        });
      productId = createResponse.body.product.id;
    });

    it('should update stock for owner vendor (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          quantity: 20
        });

      expect(response.status).toBe(200);
      expect(response.body.product.quantity).toBe(20);
      expect(response.body.product.status).toBe(ProductStatus.ACTIVE);
    });

    it('should auto-set out_of_stock when quantity becomes 0', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          quantity: 0
        });

      expect(response.status).toBe(200);
      expect(response.body.product.quantity).toBe(0);
      expect(response.body.product.status).toBe(ProductStatus.OUT_OF_STOCK);
    });

    it('should return to active when stock goes from 0 to positive', async () => {
      // First set to 0
      await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({ quantity: 0 });

      // Then set to positive
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          quantity: 5
        });

      expect(response.status).toBe(200);
      expect(response.body.product.quantity).toBe(5);
      expect(response.body.product.status).toBe(ProductStatus.ACTIVE);
    });

    it('should return 403 for other vendor (ownership violation)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${vendor2Token}`)
        .send({
          quantity: 15
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PRODUCT_OWNERSHIP_VIOLATION');
    });

    it('should allow admin to update any product stock (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          quantity: 25
        });

      expect(response.status).toBe(200);
      expect(response.body.product.quantity).toBe(25);
    });

    it('should return 400 for invalid quantity', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          quantity: -1
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('PRODUCT_QUANTITY_INVALID');
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .patch('/api/v1/products/non-existent-id/stock')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          quantity: 10
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/products/:productId/inactivate - Inactivate product', () => {
    let productId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Active Product',
          description: 'To be inactivated',
          price: 60,
          quantity: 10
        });
      productId = createResponse.body.product.id;
    });

    it('should inactivate product for owner vendor (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/inactivate`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.product.status).toBe(ProductStatus.INACTIVE);
    });

    it('should return 403 for other vendor (ownership violation)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/inactivate`)
        .set('Authorization', `Bearer ${vendor2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PRODUCT_OWNERSHIP_VIOLATION');
    });

    it('should allow admin to inactivate any product (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/inactivate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.product.status).toBe(ProductStatus.INACTIVE);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .patch('/api/v1/products/non-existent-id/inactivate')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/products/:productId/activate - Activate product', () => {
    let productId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Inactive Product',
          description: 'To be activated',
          price: 60,
          quantity: 10,
          status: ProductStatus.INACTIVE
        });
      productId = createResponse.body.product.id;
    });

    it('should activate product for owner vendor (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/activate`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.product.status).toBe(ProductStatus.ACTIVE);
    });

    it('should return 403 for other vendor (ownership violation)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/activate`)
        .set('Authorization', `Bearer ${vendor2Token}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PRODUCT_OWNERSHIP_VIOLATION');
    });

    it('should allow admin to activate any product (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${productId}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.product.status).toBe(ProductStatus.ACTIVE);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .patch('/api/v1/products/non-existent-id/activate')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('Category CRUD - Admin only', () => {
    let subCategoryId: string;

    beforeEach(async () => {
      // Create a sub-category for testing
      const subCatResponse = await request(app)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Smartphones',
          slug: 'smartphones',
          parentId: categoryId
        });
      expect(subCatResponse.status).toBe(201);
      subCategoryId = subCatResponse.body.category.id;
    });

    describe('POST /api/v1/categories', () => {
      it('should create category for admin (201)', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Laptops',
            slug: 'laptops'
          });

        expect(response.status).toBe(201);
        expect(response.body.category).toBeDefined();
        expect(response.body.category.name).toBe('Laptops');
        expect(response.body.category.slug).toBe('laptops');
        expect(response.body.category.parentId).toBeNull();
      });

      it('should create sub-category for admin (201)', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Gaming Laptops',
            slug: 'gaming-laptops',
            parentId: categoryId
          });

        expect(response.status).toBe(201);
        expect(response.body.category.name).toBe('Gaming Laptops');
        expect(response.body.category.parentId).toBe(categoryId);
        expect(response.body.category.path).toBe('/electronics/gaming-laptops/');
      });

      it('should return 403 for vendor role', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${vendorToken}`)
          .send({
            name: 'Vendor Category',
            slug: 'vendor-category'
          });

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('FORBIDDEN');
      });

      it('should return 403 for consumer role', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            name: 'Consumer Category',
            slug: 'consumer-category'
          });

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('FORBIDDEN');
      });

      it('should return 401 for missing token', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .send({
            name: 'No Auth Category',
            slug: 'no-auth-category'
          });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('MISSING_TOKEN');
      });

      it('should return 400 for missing name', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            slug: 'no-name'
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('CATEGORY_NAME_REQUIRED');
      });

      it('should return 400 for missing slug', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'No Slug'
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('CATEGORY_SLUG_REQUIRED');
      });

      it('should return 400 for invalid slug format', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Invalid Slug',
            slug: 'Invalid_Slug!'
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('CATEGORY_SLUG_INVALID');
      });

      it('should return 409 for duplicate slug', async () => {
        await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'First Category',
            slug: 'duplicate-slug'
          });

        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Second Category',
            slug: 'duplicate-slug'
          });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('CATEGORY_SLUG_ALREADY_EXISTS');
      });

      it('should return 404 for non-existent parent', async () => {
        const response = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Orphan Category',
            slug: 'orphan-category',
            parentId: 'non-existent-parent'
          });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('CATEGORY_PARENT_NOT_FOUND');
      });
    });

    describe('GET /api/v1/categories', () => {
      it('should list all categories (public)', async () => {
        const response = await request(app)
          .get('/api/v1/categories');

        expect(response.status).toBe(200);
        expect(response.body.categories).toBeDefined();
        expect(Array.isArray(response.body.categories)).toBe(true);
        expect(response.body.categories.length).toBeGreaterThanOrEqual(2); // electronics + smartphones
      });
    });

    describe('GET /api/v1/categories/:categoryId', () => {
      it('should get category by ID (public)', async () => {
        const response = await request(app)
          .get(`/api/v1/categories/${categoryId}`);

        expect(response.status).toBe(200);
        expect(response.body.category).toBeDefined();
        expect(response.body.category.id).toBe(categoryId);
        expect(response.body.category.name).toBe('Electronics');
      });

      it('should return 404 for non-existent category', async () => {
        const response = await request(app)
          .get('/api/v1/categories/non-existent-id');

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('CATEGORY_NOT_FOUND');
      });
    });

    describe('GET /api/v1/categories/slug/:slug', () => {
      it('should get category by slug (public)', async () => {
        const response = await request(app)
          .get('/api/v1/categories/slug/electronics');

        expect(response.status).toBe(200);
        expect(response.body.category).toBeDefined();
        expect(response.body.category.slug).toBe('electronics');
      });

      it('should return 404 for non-existent slug', async () => {
        const response = await request(app)
          .get('/api/v1/categories/slug/non-existent');

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('CATEGORY_NOT_FOUND');
      });
    });

    describe('GET /api/v1/categories/:categoryId/children', () => {
      it('should get child categories (public)', async () => {
        const response = await request(app)
          .get(`/api/v1/categories/${categoryId}/children`);

        expect(response.status).toBe(200);
        expect(response.body.categories).toBeDefined();
        expect(Array.isArray(response.body.categories)).toBe(true);
        expect(response.body.categories.length).toBe(1);
        expect(response.body.categories[0].name).toBe('Smartphones');
        expect(response.body.categories[0].parentId).toBe(categoryId);
      });
    });

    describe('PATCH /api/v1/categories/:categoryId', () => {
      it('should update category for admin (200)', async () => {
        const response = await request(app)
          .patch(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'Consumer Electronics'
          });

        expect(response.status).toBe(200);
        expect(response.body.category.name).toBe('Consumer Electronics');
        expect(response.body.category.slug).toBe('electronics'); // unchanged
      });

      it('should update slug for admin (200)', async () => {
        const response = await request(app)
          .patch(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            slug: 'consumer-electronics'
          });

        expect(response.status).toBe(200);
        expect(response.body.category.slug).toBe('consumer-electronics');
      });

      it('should return 403 for vendor role', async () => {
        const response = await request(app)
          .patch(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${vendorToken}`)
          .send({
            name: 'Vendor Update'
          });

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('FORBIDDEN');
      });

      it('should return 400 for empty name', async () => {
        const response = await request(app)
          .patch(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: ''
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('CATEGORY_NAME_REQUIRED');
      });

      it('should return 400 for empty slug', async () => {
        const response = await request(app)
          .patch(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            slug: ''
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('CATEGORY_SLUG_REQUIRED');
      });

      it('should return 400 for invalid slug format', async () => {
        const response = await request(app)
          .patch(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            slug: 'Invalid_Slug!'
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('CATEGORY_SLUG_INVALID');
      });

      it('should return 409 for duplicate slug', async () => {
        const response = await request(app)
          .patch(`/api/v1/categories/${subCategoryId}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            slug: 'electronics'
          });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe('CATEGORY_SLUG_ALREADY_EXISTS');
      });
    });

    describe('DELETE /api/v1/categories/:categoryId', () => {
      it('should delete category for admin (204)', async () => {
        // Create a new category to delete
        const createResponse = await request(app)
          .post('/api/v1/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'To Delete',
            slug: 'to-delete'
          });
        const deleteId = createResponse.body.category.id;

        const response = await request(app)
          .delete(`/api/v1/categories/${deleteId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(204);

        // Verify deleted
        const getResponse = await request(app)
          .get(`/api/v1/categories/${deleteId}`);
        expect(getResponse.status).toBe(404);
      });

      it('should return 403 for vendor role', async () => {
        const response = await request(app)
          .delete(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${vendorToken}`);

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('FORBIDDEN');
      });

      it('should return 404 for non-existent category', async () => {
        const response = await request(app)
          .delete('/api/v1/categories/non-existent-id')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('CATEGORY_NOT_FOUND');
      });

      it('should return 400 for category with children', async () => {
        const response = await request(app)
          .delete(`/api/v1/categories/${categoryId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('CATEGORY_HAS_CHILDREN');
      });
    });
  });

  // ============ Image Upload Tests ============
  
  // Helper functions to generate valid image buffers with dimensions >= 800x800
  async function createJpegBuffer(size: number = 1024): Promise<Buffer> {
    return sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    }).jpeg({ quality: 80 }).toBuffer();
  }

  async function createPngBuffer(size: number = 1024): Promise<Buffer> {
    return sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 0, g: 255, b: 0 }
      }
    }).png().toBuffer();
  }

  async function createWebpBuffer(size: number = 1024): Promise<Buffer> {
    return sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 0, g: 0, b: 255 }
      }
    }).webp({ quality: 80 }).toBuffer();
  }

  describe('POST /api/v1/products/:productId/images - Upload product image', () => {
    let testProductId: string;

    beforeEach(async () => {
      // Create a fresh product for each test
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Image Test Product',
          description: 'Product for image upload testing',
          price: 49.99,
          quantity: 5
        });
      testProductId = productResponse.body.product.id;
    });

    it('allows an admin to upload under the product owner and retrieve it without granting another vendor access', async () => {
      const image = await createJpegBuffer(1024);
      const denied = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendor2Token}`)
        .attach('image', image, 'other.jpg');
      expect(denied.status).toBe(403);

      const uploaded = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', image, 'admin.jpg');
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.image.key).toMatch(new RegExp(`^products/${vendorId}/${testProductId}/`));
      expect((await productRepo.findById(testProductId))?.images).toContain(uploaded.body.image.url);
      expect((await request(app).get(uploaded.body.image.url)).status).toBe(200);
      expect((await request(app).get(`/api/v1/uploads/${uploaded.body.image.key.replace(`products/${vendorId}/`, `products/${vendor2Id}/`)}`)).status).toBe(404);

      const otherVendor = await vendorRepo.findByPersonId(vendor2PersonId);
      vi.spyOn(vendorRepo, 'findByPersonId').mockResolvedValueOnce(otherVendor);
      const adminWithVendor = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', image, 'admin-again.jpg');
      expect(adminWithVendor.status).toBe(201);
      expect(adminWithVendor.body.image.key).toMatch(new RegExp(`^products/${vendorId}/${testProductId}/`));
      expect((await request(app).get(adminWithVendor.body.image.url)).status).toBe(200);
    });

    it('should allow vendor to upload valid JPEG image (201)', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(201);
      expect(response.body.image).toBeDefined();
      expect(response.body.image.key).toMatch(/^products\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.jpg$/);
      expect(response.body.image.url).toBe(`/api/v1/uploads/${response.body.image.key}`);
    });

    it('should allow vendor to upload valid PNG image (201)', async () => {
      const pngBuffer = await createPngBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', pngBuffer, 'test.png');

      expect(response.status).toBe(201);
      expect(response.body.image.key).toMatch(/^products\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.png$/);
      expect(response.body.image.url).toBe(`/api/v1/uploads/${response.body.image.key}`);
    });

    it('should allow vendor to upload valid WebP image (201)', async () => {
      const webpBuffer = await createWebpBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', webpBuffer, 'test.webp');

      expect(response.status).toBe(201);
      expect(response.body.image.key).toMatch(/^products\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.webp$/);
    });

    it('should add image reference to product.images[]', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const uploadResponse = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(uploadResponse.status).toBe(201);
      
      // Verify product now has the image
      const productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);
      
      expect(productResponse.status).toBe(200);
      expect(productResponse.body.product.images).toBeDefined();
      expect(Array.isArray(productResponse.body.product.images)).toBe(true);
      expect(productResponse.body.product.images.length).toBe(1);
      expect(productResponse.body.product.images[0]).toBe(uploadResponse.body.image.url);
    });

    it('should save image file to storage', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const uploadResponse = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(uploadResponse.status).toBe(201);
      
      // Verify file exists in storage
      const filePath = path.join(storageRoot, uploadResponse.body.image.key);
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);
      
      // Verify file content matches
      const savedBuffer = await fs.readFile(filePath);
      expect(savedBuffer.length).toBe(jpegBuffer.length);
      expect(savedBuffer[0]).toBe(0xFF);
      expect(savedBuffer[1]).toBe(0xD8);
    });

    it('should return 403 for consumer role', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${consumerToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should allow admin to upload (201)', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(201);
      expect(response.body.image).toBeDefined();
    });

    it('should return 401 for unauthenticated request', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });

    it('should return 400 when no file provided', async () => {
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('IMAGE_REQUIRED');
    });

    it('should return 400 for file too large (10MB limit)', async () => {
      // Create a buffer larger than 10MB
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024, 0xFF);
      // Add JPEG signature so it passes initial multer check
      largeBuffer[0] = 0xFF;
      largeBuffer[1] = 0xD8;
      largeBuffer[2] = 0xFF;
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', largeBuffer, 'large.jpg');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_IMAGE');
      expect(response.body.message).toMatch(/File size exceeds maximum of 10MB/);
    });

    it('should return 400 for invalid MIME type', async () => {
      // Create a text file buffer
      const textBuffer = Buffer.from('This is not an image', 'utf-8');
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', textBuffer, 'test.txt');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_IMAGE');
    });

    it('should return 400 for MIME mismatch with content (PNG bytes with JPEG MIME)', async () => {
      const pngBuffer = await createPngBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', pngBuffer, 'test.jpg'); // .jpg extension but PNG content

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_IMAGE');
      expect(response.body.message).toMatch(/File content does not match declared type/);
    });

    it('should return 404 for non-existent product', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post('/api/v1/products/non-existent-product-id/images')
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('should return 403 for other vendor\'s product', async () => {
      // Create product owned by vendor2
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendor2Token}`)
        .send({
          categoryId,
          name: 'Vendor2 Product',
          description: 'Owned by vendor2',
          price: 29.99,
          quantity: 3
        });
      const vendor2ProductId = productResponse.body.product.id;
      
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${vendor2ProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PRODUCT_OWNERSHIP_VIOLATION');
    });

    it('should return 403 for vendor without vendor profile', async () => {
      // Register a new vendor user but don't onboard them
      const newVendorRegister = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'No Profile Vendor',
          taxIdType: 'CNPJ',
          taxIdValue: '12345678000195',
          email: 'noprofile@vendor.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });
      const noProfileToken = newVendorRegister.body.tokens.accessToken;
      
      const jpegBuffer = await createJpegBuffer(1024);
      
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${noProfileToken}`)
        .attach('image', jpegBuffer, 'test.jpg');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });
  });

  describe('DELETE /api/v1/products/:productId/images/:imageKey - Delete product image', () => {
    let testProductId: string;
    let imageKey: string;
    let imageUrl: string;

    beforeEach(async () => {
      // Create a product and upload an image first
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Delete Image Test Product',
          description: 'Product for image delete testing',
          price: 79.99,
          quantity: 8
        });
      testProductId = productResponse.body.product.id;

      const jpegBuffer = await createJpegBuffer(1024);
      const uploadResponse = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');
      
      imageKey = uploadResponse.body.image.key;
      imageUrl = uploadResponse.body.image.url;
    });

    it('should allow vendor to delete own product image (204)', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${imageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(204);
    });

    it('should remove image from product.images[]', async () => {
      // Verify image exists before deletion
      let productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);
      expect(productResponse.body.product.images).toContain(imageUrl);

      // Delete the image
      await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${imageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      // Verify image removed
      productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);
      expect(productResponse.body.product.images).not.toContain(imageUrl);
      expect(productResponse.body.product.images.length).toBe(0);
    });

    it('should delete image file from storage', async () => {
      // Verify file exists before deletion
      const filePath = path.join(storageRoot, imageKey);
      let fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Delete the image
      await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${imageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      // Verify file deleted
      fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should return 403 for consumer role', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${imageKey}`)
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should allow admin to delete (204)', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${imageKey}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(204);
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${imageKey}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .delete('/api/v1/products/non-existent-id/images/' + imageKey)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('PRODUCT_NOT_FOUND');
    });

    it('should return 404 for non-existent image key', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${testProductId}/images/non-existent-key.jpg`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('IMAGE_NOT_FOUND');
    });

    it('should return 403 for other vendor\'s product', async () => {
      // Create product owned by vendor2 with an image
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendor2Token}`)
        .send({
          categoryId,
          name: 'Vendor2 Product for Delete',
          description: 'Owned by vendor2',
          price: 39.99,
          quantity: 6
        });
      const vendor2ProductId = productResponse.body.product.id;

      const jpegBuffer = await createJpegBuffer(1024);
      const uploadResponse = await request(app)
        .post(`/api/v1/products/${vendor2ProductId}/images`)
        .set('Authorization', `Bearer ${vendor2Token}`)
        .attach('image', jpegBuffer, 'test.jpg');
      
      const vendor2ImageKey = uploadResponse.body.image.key;

      // Vendor1 tries to delete vendor2's image
      const response = await request(app)
        .delete(`/api/v1/products/${vendor2ProductId}/images/${vendor2ImageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('PRODUCT_OWNERSHIP_VIOLATION');
    });
  });

  describe('GET /api/v1/uploads/:key - Serve uploaded image', () => {
    let testProductId: string;
    let imageKey: string;
    let imageUrl: string;

    beforeEach(async () => {
      // Create a product and upload an image first
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Serve Image Test Product',
          description: 'Product for image serving testing',
          price: 59.99,
          quantity: 12
        });
      testProductId = productResponse.body.product.id;

      const jpegBuffer = await createJpegBuffer(1024);
      const uploadResponse = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('image', jpegBuffer, 'test.jpg');
      
      imageKey = uploadResponse.body.image.key;
      imageUrl = uploadResponse.body.image.url;
    });

    it('should serve existing image (200)', async () => {
      const response = await request(app)
        .get(`/api/v1/uploads/${imageKey}`);

      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
    });

    it('should return correct Content-Type header for JPEG', async () => {
      const response = await request(app)
        .get(`/api/v1/uploads/${imageKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
    });

    it('should set Cache-Control header', async () => {
      const response = await request(app)
        .get(`/api/v1/uploads/${imageKey}`);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('should return 404 for non-existent key', async () => {
      const response = await request(app)
        .get('/api/v1/uploads/non-existent-key.jpg');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('IMAGE_NOT_FOUND');
    });

    it('should return 400 for path traversal attempt', async () => {
      const response = await request(app)
        .get('/api/v1/uploads/../../../etc/passwd');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_KEY');
    });
  });

  // ============ Gallery Image Tests ============
  
  describe('POST /api/v1/products/:productId/images - Upload multiple images (gallery)', () => {
    let testProductId: string;

    beforeEach(async () => {
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Gallery Test Product',
          description: 'Product for gallery testing',
          price: 99.99,
          quantity: 10
        });
      testProductId = productResponse.body.product.id;
    });

    it('should upload multiple images and assign first as main, rest as gallery (201)', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      const pngBuffer = await createPngBuffer(1024);
      const webpBuffer = await createWebpBuffer(1024);

      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('images', jpegBuffer, 'main.jpg')
        .attach('images', pngBuffer, 'gallery1.png')
        .attach('images', webpBuffer, 'gallery2.webp');

      expect(response.status).toBe(201);
      expect(response.body.images).toBeDefined();
      expect(Array.isArray(response.body.images)).toBe(true);
      expect(response.body.images.length).toBe(3);

      // Position defines main/gallery; unique object keys avoid overwriting existing images.
      expect(response.body.images[0].key).toMatch(/^products\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.jpg$/);
      expect(response.body.images[1].key).toMatch(/^products\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.png$/);
      expect(response.body.images[2].key).toMatch(/^products\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.webp$/);
      expect(new Set(response.body.images.map((image: { key: string }) => image.key)).size).toBe(3);
    });

    it('should add all images to product.images[] in correct order', async () => {
      const jpegBuffer = await createJpegBuffer(1024);
      const pngBuffer = await createPngBuffer(1024);

      const uploadResponse = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('images', jpegBuffer, 'main.jpg')
        .attach('images', pngBuffer, 'gallery1.png');

      expect(uploadResponse.status).toBe(201);

      const productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);

      expect(productResponse.status).toBe(200);
      expect(productResponse.body.product.images).toBeDefined();
      expect(productResponse.body.product.images.length).toBe(2);
      // First image (main) should be first in array
      expect(productResponse.body.product.images[0]).toBe(uploadResponse.body.images[0].url);
      expect(productResponse.body.product.images[1]).toBe(uploadResponse.body.images[1].url);
    });

    it('should support up to 10 gallery images (11 total including main)', async () => {
      const buffers = await Promise.all(
        Array.from({ length: 11 }, (_, i) => createJpegBuffer(1024))
      );

      const formData = request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`);
      
      buffers.forEach((buf, i) => {
        formData.attach('images', buf, `image${i}.jpg`);
      });

      const response = await formData;

      expect(response.status).toBe(201);
      expect(response.body.images.length).toBe(11);
      for (const image of response.body.images) {
        expect(image.key).toMatch(/^products\/[^/]+\/[^/]+\/[0-9a-f-]{36}\.jpg$/);
      }
      expect(new Set(response.body.images.map((image: { key: string }) => image.key)).size).toBe(11);
    });

    it('should reject upload with more than 11 images (1 main + 10 gallery)', async () => {
      const buffers = await Promise.all(
        Array.from({ length: 12 }, (_, i) => createJpegBuffer(1024))
      );

      const formData = request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`);
      
      buffers.forEach((buf, i) => {
        formData.attach('images', buf, `image${i}.jpg`);
      });

      const response = await formData;

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_IMAGE');
    });

    it('should return 400 when no images provided', async () => {
      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('IMAGE_REQUIRED');
    });

    it('should validate dimensions for all uploaded images', async () => {
      // Create a small image that will fail dimension validation
      const smallBuffer = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
      }).jpeg().toBuffer();
      
      const validBuffer = await createJpegBuffer(1024);

      const response = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('images', validBuffer, 'main.jpg')
        .attach('images', smallBuffer, 'gallery1.jpg');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_IMAGE');
      expect(response.body.message).toMatch(/dimension/i);
    });
  });

  describe('DELETE /api/v1/products/:productId/images/:imageKey - Delete gallery image', () => {
    let testProductId: string;
    let mainImageKey: string;
    let galleryImageKey: string;
    let mainImageUrl: string;
    let galleryImageUrl: string;

    beforeEach(async () => {
      const productResponse = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          categoryId,
          name: 'Delete Gallery Test Product',
          description: 'Product for gallery delete testing',
          price: 79.99,
          quantity: 8
        });
      testProductId = productResponse.body.product.id;

      const jpegBuffer = await createJpegBuffer(1024);
      const pngBuffer = await createPngBuffer(1024);
      const uploadResponse = await request(app)
        .post(`/api/v1/products/${testProductId}/images`)
        .set('Authorization', `Bearer ${vendorToken}`)
        .attach('images', jpegBuffer, 'main.jpg')
        .attach('images', pngBuffer, 'gallery1.png');
      
      mainImageKey = uploadResponse.body.images[0].key;
      mainImageUrl = uploadResponse.body.images[0].url;
      galleryImageKey = uploadResponse.body.images[1].key;
      galleryImageUrl = uploadResponse.body.images[1].url;
    });

    it('should allow vendor to delete gallery image (204)', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${galleryImageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(204);
    });

    it('should remove gallery image from product.images[]', async () => {
      let productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);
      expect(productResponse.body.product.images).toContain(galleryImageUrl);
      expect(productResponse.body.product.images.length).toBe(2);

      await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${galleryImageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);
      expect(productResponse.body.product.images).not.toContain(galleryImageUrl);
      expect(productResponse.body.product.images.length).toBe(1);
      expect(productResponse.body.product.images[0]).toBe(mainImageUrl);
    });

    it('should delete gallery image file from storage', async () => {
      const filePath = path.join(storageRoot, galleryImageKey);
      let fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${galleryImageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should allow vendor to delete main image (204)', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${mainImageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(204);
    });

    it('should remove main image from product.images[]', async () => {
      let productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);
      expect(productResponse.body.product.images).toContain(mainImageUrl);

      await request(app)
        .delete(`/api/v1/products/${testProductId}/images/${mainImageKey}`)
        .set('Authorization', `Bearer ${vendorToken}`);

      productResponse = await request(app)
        .get(`/api/v1/products/${testProductId}`);
      expect(productResponse.body.product.images).not.toContain(mainImageUrl);
      expect(productResponse.body.product.images.length).toBe(1);
      expect(productResponse.body.product.images[0]).toBe(galleryImageUrl);
    });
  });
});
