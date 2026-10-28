import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository } from '../person/person.domain';
import { AuthService } from './auth.service';
import { createAuthRoutes } from './auth.routes';
import { PersonRole } from '../person/person.domain';

describe('Auth Routes', () => {
  let app: express.Express;
  let repo: InMemoryPersonRepository;
  let authService: AuthService;
  const testPassword = 'SecurePass123!';

  beforeEach(async () => {
    repo = new InMemoryPersonRepository();
    authService = new AuthService(repo, 'test-secret-key', '24h', '30d');
    
    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new Consumer and return 201', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'john@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      expect(response.status).toBe(201);
      expect(response.body.person).toBeDefined();
      expect(response.body.person.name).toBe('John Doe');
      expect(response.body.person.email).toBe('john@example.com');
      expect(response.body.person.roles).toContain(PersonRole.CONSUMER);
      expect(response.body.tokens).toBeDefined();
      expect(response.body.tokens.accessToken).toBeDefined();
      expect(response.body.tokens.refreshToken).toBeDefined();
    });

    it('should register with VENDOR role defaulting to CONSUMER and return 201', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Vendor',
          taxIdType: 'CNPJ',
          taxIdValue: '11222333000181',
          email: 'jane@vendor.com',
          password: testPassword,
          role: PersonRole.VENDOR
        });

      expect(response.status).toBe(201);
      expect(response.body.person.roles).toContain(PersonRole.CONSUMER);
      expect(response.body.person.roles).not.toContain(PersonRole.VENDOR);
    });

    it('should reject ADMIN role registration with 403', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Admin User',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'admin@example.com',
          password: testPassword,
          role: PersonRole.ADMIN
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN_ROLE');
    });

    it('should return 400 for missing fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          // missing taxIdType, taxIdValue, email, password, role
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('MISSING_FIELDS');
    });

    it('should return 400 for invalid role', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'john@example.com',
          password: testPassword,
          role: 'INVALID_ROLE'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_ROLE');
    });

    it('should return 409 for duplicate email', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'john@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          taxIdType: 'CNPJ',
          taxIdValue: '11222333000181',
          email: 'john@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('should return 409 for duplicate tax ID', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'john@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'jane@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('TAX_ID_ALREADY_EXISTS');
    });

    it('should return 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'john@example.com',
          password: 'weak',
          role: PersonRole.CONSUMER
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('WEAK_PASSWORD');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'invalid-email',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_EMAIL');
    });

    it('should return 400 for invalid CPF', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '12345678901',
          email: 'john@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_TAX_ID');
    });

    it('should return 400 for invalid CNPJ', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Vendor',
          taxIdType: 'CNPJ',
          taxIdValue: '12345678000190',
          email: 'jane@vendor.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('INVALID_TAX_ID');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'john@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });
    });

    it('should login with correct credentials and return 200', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@example.com',
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.person).toBeDefined();
      expect(response.body.person.email).toBe('john@example.com');
      expect(response.body.tokens).toBeDefined();
      expect(response.body.tokens.accessToken).toBeDefined();
      expect(response.body.tokens.refreshToken).toBeDefined();
    });

    it('should login with case-insensitive email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'JOHN@EXAMPLE.COM',
          password: testPassword
        });

      expect(response.status).toBe(200);
      expect(response.body.person.email).toBe('john@example.com');
    });

    it('should return 401 for wrong password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@example.com',
          password: 'WrongPass123!'
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('should return 401 for non-existent email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: testPassword
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('should return 400 for missing credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('MISSING_CREDENTIALS');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const registerResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'John Doe',
          taxIdType: 'CPF',
          taxIdValue: '52998224725',
          email: 'john@example.com',
          password: testPassword,
          role: PersonRole.CONSUMER
        });
      refreshToken = registerResponse.body.tokens.refreshToken;
    });

    it('should generate new tokens with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(response.body.tokens).toBeDefined();
      expect(response.body.tokens.accessToken).toBeDefined();
      expect(response.body.tokens.refreshToken).toBeDefined();
    });

    it('should return 401 for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('INVALID_TOKEN');
    });

    it('should return 400 for missing refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('MISSING_REFRESH_TOKEN');
    });
  });
});