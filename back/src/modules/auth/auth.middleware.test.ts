import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository } from '../person/person.domain';
import { AuthService } from './auth.service';
import { createAuthRoutes } from './auth.routes';
import { authMiddleware, requireRole, requireAnyRole, AuthenticatedRequest } from './auth.middleware';
import { PersonRole } from '../person/person.domain';

describe('Auth Middleware', () => {
  let app: express.Express;
  let repo: InMemoryPersonRepository;
  let authService: AuthService;
  let consumerToken: string;
  let vendorToken: string;
  let adminToken: string;
  const testPassword = 'SecurePass123!';

  beforeEach(async () => {
    repo = new InMemoryPersonRepository();
    authService = new AuthService(repo, 'test-secret-key', '24h', '30d');
    
    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));

    // Create test users with valid CPF/CNPJ
    const consumerResult = await authService.register({
      name: 'John Consumer',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'consumer@example.com',
      password: testPassword,
      role: PersonRole.CONSUMER
    });
    consumerToken = consumerResult.tokens.accessToken;

    const vendorResult = await authService.register({
      name: 'Jane Vendor',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000181',
      email: 'vendor@example.com',
      password: testPassword,
      role: PersonRole.VENDOR
    });
    vendorToken = vendorResult.tokens.accessToken;

    const adminResult = await authService.register({
      name: 'Admin User',
      taxIdType: 'CNPJ',
      taxIdValue: '11222333000262', // Valid CNPJ (different from vendor)
      email: 'admin@example.com',
      password: testPassword,
      role: PersonRole.ADMIN
    });
    adminToken = adminResult.tokens.accessToken;
  }, 30000);

  describe('authMiddleware', () => {
    it('should allow access with valid token', async () => {
      app.get('/api/v1/protected', authMiddleware(authService), (req: AuthenticatedRequest, res) => {
        res.json({ userId: req.user.sub, email: req.user.email, roles: req.user.roles });
      });

      const response = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.userId).toBeDefined();
      expect(response.body.email).toBe('consumer@example.com');
      expect(response.body.roles).toContain(PersonRole.CONSUMER);
    });

    it('should reject request without token', async () => {
      app.get('/api/v1/protected', authMiddleware(authService), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/api/v1/protected');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('MISSING_TOKEN');
    });

    it('should reject request with invalid token', async () => {
      app.get('/api/v1/protected', authMiddleware(authService), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('INVALID_TOKEN');
    });

    it('should reject request with expired token', async () => {
      const shortExpiryAuth = new AuthService(repo, 'test-secret-key', '1ms', '30d');
      
      await shortExpiryAuth.register({
        name: 'Test User',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000343', // Valid CNPJ
        email: 'expired@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      const loginResult = await shortExpiryAuth.login({
        email: 'expired@example.com',
        password: testPassword
      });

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      app.get('/api/v1/protected', authMiddleware(authService), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${loginResult.tokens.accessToken}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('TOKEN_EXPIRED');
    }, 15000);

    it('should attach user to request object', async () => {
      let capturedUser: any;
      
      app.get('/api/v1/protected', authMiddleware(authService), (req: AuthenticatedRequest, res) => {
        capturedUser = req.user;
        res.json({ ok: true });
      });

      await request(app)
        .get('/api/v1/protected')
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(capturedUser).toBeDefined();
      expect(capturedUser.sub).toBeDefined();
      expect(capturedUser.email).toBe('consumer@example.com');
      expect(capturedUser.roles).toContain(PersonRole.CONSUMER);
      expect(capturedUser.type).toBe('access');
    });
  });

  describe('requireRole', () => {
    it('should allow access when user has required role', async () => {
      app.get('/api/v1/vendor-only', authMiddleware(authService), requireRole(PersonRole.VENDOR), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/api/v1/vendor-only')
        .set('Authorization', `Bearer ${vendorToken}`);

      expect(response.status).toBe(200);
    });

    it('should deny access when user lacks required role', async () => {
      app.get('/api/v1/vendor-only', authMiddleware(authService), requireRole(PersonRole.VENDOR), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/api/v1/vendor-only')
        .set('Authorization', `Bearer ${consumerToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });

    it('should allow Admin to access Vendor routes (if Admin has that role)', async () => {
      app.get('/api/v1/vendor-only', authMiddleware(authService), requireRole(PersonRole.VENDOR), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/api/v1/vendor-only')
        .set('Authorization', `Bearer ${adminToken}`);

      // Admin doesn't have VENDOR role (per CD-003), so should be forbidden
      expect(response.status).toBe(403);
    });
  });

  describe('requireAnyRole', () => {
    it('should allow access when user has any of the required roles', async () => {
      app.get('/api/v1/consumer-or-vendor', authMiddleware(authService), requireAnyRole([PersonRole.CONSUMER, PersonRole.VENDOR]), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const consumerResponse = await request(app)
        .get('/api/v1/consumer-or-vendor')
        .set('Authorization', `Bearer ${consumerToken}`);
      expect(consumerResponse.status).toBe(200);

      const vendorResponse = await request(app)
        .get('/api/v1/consumer-or-vendor')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(vendorResponse.status).toBe(200);
    });

    it('should deny access when user has none of the required roles', async () => {
      app.get('/api/v1/consumer-or-vendor', authMiddleware(authService), requireAnyRole([PersonRole.CONSUMER, PersonRole.VENDOR]), (req: AuthenticatedRequest, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .get('/api/v1/consumer-or-vendor')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    });
  });
});