import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository, Person } from '../person/person.domain';
import { InMemoryVendorRepository } from './vendor.domain';
import { AuthService } from '../auth/auth.service';
import { VendorService } from './vendor.service';
import { createVendorRoutes } from './vendor.routes';
import { createAuthRoutes } from '../auth/auth.routes';
import { PersonRole } from '../person/person.domain';
import { config } from '../../config';
import { hashPassword } from '../auth/credential.domain';

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

  // Global admin token for tests that need admin access
  let adminToken: string;

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
    
    // Login to get admin token
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@example.com',
        password: testPassword
      });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.tokens.accessToken;
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
      // Use global admin token (created in global beforeEach)
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

      // Login again to get fresh token with VENDOR role
      const vendorLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@vendor.com',
          password: testPassword
        });
      expect(vendorLogin.status).toBe(200);
      vendorToken = vendorLogin.body.tokens.accessToken;
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

    it('should return 404 for a consumer who does not yet have a vendor profile', async () => {
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

      // Login again to get fresh token with VENDOR role
      const vendorLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@vendor.com',
          password: testPassword
        });
      expect(vendorLogin.status).toBe(200);
      vendorToken = vendorLogin.body.tokens.accessToken;
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

    it('should return 403 for CONSUMER role (requires VENDOR role)', async () => {
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

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });
  });

  describe('PATCH /api/v1/vendor/vendors/:vendorId/suspend', () => {
    let vendorToken: string;
    let vendorId: string;

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

      // Onboard vendor
      const onboardResponse = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'John\'s Electronics',
          slug: 'johns-electronics'
        });
      expect(onboardResponse.status).toBe(201);
      vendorId = onboardResponse.body.vendor.id;

      // Login again to get fresh token with VENDOR role
      const vendorLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@vendor.com',
          password: testPassword
        });
      expect(vendorLogin.status).toBe(200);
      vendorToken = vendorLogin.body.tokens.accessToken;
    });

    it('should allow ADMIN to suspend a vendor and return 200 with suspended status', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.vendor).toBeDefined();
      expect(response.body.vendor.id).toBe(vendorId);
      expect(response.body.vendor.status).toBe('suspended');
      expect(response.body.vendor.storeName).toBe('John\'s Electronics');
      expect(response.body.vendor.slug).toBe('johns-electronics');
    });

    it('should return 403 for VENDOR role (not authorized to suspend)', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/suspend`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 403 for CONSUMER role (not authorized to suspend)', async () => {
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
        .patch(`/api/v1/vendor/vendors/${vendorId}/suspend`)
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 401 for missing token', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/suspend`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });

    it('should return 404 for non-existent vendorId', async () => {
      const response = await request(app)
        .patch('/api/v1/vendor/vendors/non-existent-id/suspend')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VENDOR_NOT_FOUND');
    });

    it('should use vendorId from path param and ignore body vendorId', async () => {
      // This test verifies vendorId is taken from path param, not body
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ vendorId: 'different-id' }); // body vendorId should be ignored

      expect(response.status).toBe(200);
      expect(response.body.vendor.id).toBe(vendorId); // Should use path param
    });
  });

  describe('PATCH /api/v1/vendor/vendors/:vendorId/activate', () => {
    let vendorToken: string;
    let vendorId: string;

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

      // Onboard vendor
      const onboardResponse = await request(app)
        .post('/api/v1/vendor/onboard')
        .set('Authorization', `Bearer ${vendorToken}`)
        .send({
          storeName: 'John\'s Electronics',
          slug: 'johns-electronics'
        });
      expect(onboardResponse.status).toBe(201);
      vendorId = onboardResponse.body.vendor.id;

      // Login again to get fresh token with VENDOR role
      const vendorLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@vendor.com',
          password: testPassword
        });
      expect(vendorLogin.status).toBe(200);
      vendorToken = vendorLogin.body.tokens.accessToken;

      // Suspend the vendor (using global adminToken)
      await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`);
    });

    it('should allow ADMIN to reactivate a suspended vendor and return 200 with active status', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.vendor).toBeDefined();
      expect(response.body.vendor.id).toBe(vendorId);
      expect(response.body.vendor.status).toBe('active');
      expect(response.body.vendor.storeName).toBe('John\'s Electronics');
      expect(response.body.vendor.slug).toBe('johns-electronics');
    });

    it('should return 403 for VENDOR role (not authorized to activate)', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/activate`)
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 403 for CONSUMER role (not authorized to activate)', async () => {
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
        .patch(`/api/v1/vendor/vendors/${vendorId}/activate`)
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should return 401 for missing token', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/activate`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });

    it('should return 404 for non-existent vendorId', async () => {
      const response = await request(app)
        .patch('/api/v1/vendor/vendors/non-existent-id/activate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('VENDOR_NOT_FOUND');
    });

    it('should return 400 for already active vendor', async () => {
      // First activate the vendor
      await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Try to activate again
      const response = await request(app)
        .patch(`/api/v1/vendor/vendors/${vendorId}/activate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('VENDOR_ALREADY_ACTIVE');
    });
  });
});