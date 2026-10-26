import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository } from '../person/person.domain';
import { InMemoryProductRepository, InMemoryCategoryRepository, ProductStatus } from './product.domain';
import { AuthService } from '../auth/auth.service';
import { ProductService } from './product.service';
import { createProductRoutes, createCategoryRoutes } from './product.routes';
import { createAuthRoutes } from '../auth/auth.routes';
import { PersonRole } from '../person/person.domain';
import { InMemoryVendorRepository } from '../vendor/vendor.domain';
import { VendorService } from '../vendor/vendor.service';
import { createVendorRoutes } from '../vendor/vendor.routes';
import { config } from '../../config';

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
  const testPassword = 'SecurePass123!';
  
  let vendorToken: string;
  let vendor2Token: string;
  let consumerToken: string;
  let adminToken: string;
  let vendorId: string;
  let vendor2Id: string;
  let vendorPersonId: string;
  let vendor2PersonId: string;
  let categoryId: string;

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    vendorRepo = new InMemoryVendorRepository();
    productRepo = new InMemoryProductRepository();
    categoryRepo = new InMemoryCategoryRepository();
    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
    vendorService = new VendorService(vendorRepo, personRepo, config);
    productService = new ProductService(productRepo, categoryRepo, vendorRepo, config);

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
      vendorRepo
    }));
    app.use('/api/v1/categories', createCategoryRoutes({ 
      authService, 
      productService,
      personRepo,
      vendorRepo
    }));

    // Register vendor 1
    const vendorRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'John Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: VALID_CNPJ_1,
        email: 'john@vendor.com',
        password: testPassword,
        role: PersonRole.VENDOR
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

    // Register vendor 2 (for ownership tests)
    const vendor2Register = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Jane Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: VALID_CNPJ_2,
        email: 'jane@vendor.com',
        password: testPassword,
        role: PersonRole.VENDOR
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

    // Register admin
    const adminRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Admin User',
        taxIdType: 'CPF',
        taxIdValue: VALID_CPF_2,
        email: 'admin@example.com',
        password: testPassword,
        role: PersonRole.ADMIN
      });
    expect(adminRegister.status).toBe(201);
    adminToken = adminRegister.body.tokens.accessToken;

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
      expect(response.body.products.length).toBe(3);
      expect(response.body.total).toBe(3);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(20);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/products?status=active');

      expect(response.status).toBe(200);
      expect(response.body.products.length).toBe(2);
      expect(response.body.products.every((p: any) => p.status === ProductStatus.ACTIVE)).toBe(true);
    });

    it('should filter by vendorId', async () => {
      const response = await request(app)
        .get(`/api/v1/products?vendorId=${vendorId}`);

      expect(response.status).toBe(200);
      expect(response.body.products.length).toBe(2);
      expect(response.body.products.every((p: any) => p.vendorId === vendorId)).toBe(true);
    });

    it('should filter by categoryId', async () => {
      const response = await request(app)
        .get(`/api/v1/products?categoryId=${categoryId}`);

      expect(response.status).toBe(200);
      expect(response.body.products.length).toBe(3);
      expect(response.body.products.every((p: any) => p.categoryId === categoryId)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/products?page=1&limit=2');

      expect(response.status).toBe(200);
      expect(response.body.products.length).toBe(2);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(2);
      expect(response.body.total).toBe(3);
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
      expect(response.body.products.length).toBe(1);
      expect(response.body.products[0].id).toBe(productId);
      expect(response.body.products[0].vendorId).toBe(vendorId);
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
});