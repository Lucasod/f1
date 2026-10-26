import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository } from '../person/person.domain';
import { InMemoryVendorRepository } from './vendor.domain';
import { AuthService } from '../auth/auth.service';
import { VendorService } from './vendor.service';
import { createVendorRoutes } from './vendor.routes';
import { createAuthRoutes } from '../auth/auth.routes';
import { PersonRole } from '../person/person.domain';
import { config } from '../../config';

// Valid test CPF/CNPJ values (these pass validation)
const VALID_CPF_1 = '52998224725';
const VALID_CPF_2 = '98765432100'; // Another valid CPF
const VALID_CNPJ_1 = '11222333000181';
const VALID_CNPJ_2 = '04252011000110'; // Valid CNPJ for testing

describe('Vendor Routes', () => {
  let app: express.Express;
  let personRepo: InMemoryPersonRepository;
  let vendorRepo: InMemoryVendorRepository;
  let authService: AuthService;
  let vendorService: VendorService;
  const testPassword = 'SecurePass123!';

  beforeEach(async () => {
    personRepo = new InMemoryPersonRepository();
    vendorRepo = new InMemoryVendorRepository();
    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
    vendorService = new VendorService(vendorRepo, personRepo, config);

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));
    app.use('/api/v1/vendor', createVendorRoutes({ 
      authService, 
      vendorService,
      personRepo
    }));
  });

  describe('POST /api/v1/vendor/onboard', () => {
    let vendorToken: string;
    let consumerToken: string;

    beforeEach(async () => {
      // Register a vendor
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

      // Register a consumer
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
    });

    it('should onboard vendor for user with VENDOR role and return 201', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'John\'s Electronics',
          slug: 'johns-electronics'
        });

      expect(response.status).toBe(201);
      expect(response.body.vendor).toBeDefined();
      expect(response.body.vendor.storeName).toBe('John\'s Electronics');
      expect(response.body.vendor.slug).toBe('johns-electronics');
      expect(response.body.vendor.status).toBe('active'); // Auto-publish per CD-041
      expect(response.body.vendor.commissionPct).toBe(config.commissionPct);
      expect(response.body.vendor.personId).toBeDefined();
    });

    it('should onboard vendor for user with CONSUMER role (becoming VENDOR) and return 201', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${consumerToken}`)
        .send({
          storeName: 'Jane\'s Shop',
          slug: 'janes-shop'
        });

      expect(response.status).toBe(201);
      expect(response.body.vendor.storeName).toBe('Jane\'s Shop');
      expect(response.body.vendor.slug).toBe('janes-shop');
      expect(response.body.vendor.status).toBe('active');
    });

    it('should return 401 for missing token', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .send({
          storeName: 'Test Store',
          slug: 'test-store'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          storeName: 'Test Store',
          slug: 'test-store'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('INVALID_TOKEN');
    });

    it('should return 403 for user without VENDOR or CONSUMER role (e.g., ADMIN)', async () => {
      // Register an admin with a unique valid CPF
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
      const adminToken = adminRegister.body.tokens.accessToken;

      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          storeName: 'Admin Store',
          slug: 'admin-store'
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 400 for missing storeName', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          slug: 'test-store'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('STORE_NAME_REQUIRED');
    });

    it('should return 400 for missing slug', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'Test Store'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('SLUG_REQUIRED');
    });

    it('should return 400 for invalid slug format', async () => {
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'Test Store',
          slug: 'Invalid_Slug!'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_SLUG_FORMAT');
    });

    it('should return 409 for duplicate slug', async () => {
      // First vendor onboards
      await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'Store 1',
          slug: 'same-slug'
        });

      // Register another vendor with unique CNPJ
      const vendor2Register = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Vendor 2',
          taxIdType: 'CNPJ',
          taxIdValue: VALID_CNPJ_2,
          email: 'vendor2@example.com',
          password: testPassword,
          role: PersonRole.VENDOR
        });
      expect(vendor2Register.status).toBe(201);
      const vendor2Token = vendor2Register.body.tokens.accessToken;

      // Second vendor tries same slug
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendor2Token}`)
        .send({
          storeName: 'Store 2',
          slug: 'same-slug'
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('SLUG_ALREADY_EXISTS');
    });

    it('should return 409 for person already having a vendor', async () => {
      // First onboarding
      await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'Store 1',
          slug: 'store-1'
        });

      // Try to onboard again with same person
      const response = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'Store 2',
          slug: 'store-2'
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('PERSON_ALREADY_HAS_VENDOR');
    });
  });

  describe('GET /api/v1/vendor/me', () => {
    let vendorToken: string;

    beforeEach(async () => {
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

      // Onboard vendor
      await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'John\'s Electronics',
          slug: 'johns-electronics'
        });
    });

    it('should return current user\'s vendor profile', async () => {
      const response = await request(app)
        .get('/api/v1/vendor/me')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(200);
      expect(response.body.vendor).toBeDefined();
      expect(response.body.vendor.storeName).toBe('John\'s Electronics');
      expect(response.body.vendor.slug).toBe('johns-electronics');
      expect(response.body.vendor.status).toBe('active');
    });

    it('should return 404 for user without vendor profile', async () => {
      // Register a consumer without vendor
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
      const consumerToken = consumerRegister.body.tokens.accessToken;

      const response = await request(app)
        .get('/api/v1/vendor/me')
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VENDOR_NOT_FOUND');
    });

    it('should return 401 for missing token', async () => {
      const response = await request(app)
        .get('/api/v1/vendor/me');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });
  });

  describe('PATCH /api/v1/vendor/me', () => {
    let vendorToken: string;

    beforeEach(async () => {
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

      await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'John\'s Electronics',
          slug: 'johns-electronics'
        });
    });

    it('should update vendor storeName', async () => {
      const response = await request(app)
        .patch('/api/v1/vendor/me')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'John\'s Updated Electronics'
        });

      expect(response.status).toBe(200);
      expect(response.body.vendor.storeName).toBe('John\'s Updated Electronics');
      expect(response.body.vendor.slug).toBe('johns-electronics'); // slug unchanged
    });

    it('should return 400 for empty storeName', async () => {
      const response = await request(app)
        .patch('/api/v1/vendor/me')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: ''
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('STORE_NAME_REQUIRED');
    });

    it('should return 404 for user without vendor profile', async () => {
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
      const consumerToken = consumerRegister.body.tokens.accessToken;

      const response = await request(app)
        .patch('/api/v1/vendor/me')
        .set('Authorization', `Bearer ${consumerToken}`)
        .send({
          storeName: 'New Name'
        });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VENDOR_NOT_FOUND');
    });
  });
});