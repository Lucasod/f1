import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService, AuthError, JWTPayload } from './auth.service';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';
import { hashPassword } from '../auth/credential.domain';

describe('Auth Service', () => {
  let repo: InMemoryPersonRepository;
  let authService: AuthService;
  const testPassword = 'SecurePass123!';
  let hashedPassword: string;

  beforeEach(async () => {
    repo = new InMemoryPersonRepository();
    authService = new AuthService(repo, 'test-secret-key', '24h', '30d');
    hashedPassword = await hashPassword(testPassword);
  });

  describe('register', () => {
    it('should register a new person as Consumer', async () => {
      const result = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      expect(result.person).toBeDefined();
      expect(result.person.name).toBe('John Doe');
      expect(result.person.email).toBe('john@example.com');
      expect(result.person.roles).toContain(PersonRole.CONSUMER);
      expect(result.person.credential).toBeDefined();
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('should register a new person as Vendor', async () => {
      const result = await authService.register({
        name: 'Jane Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000181',
        email: 'jane@vendor.com',
        password: testPassword,
        role: PersonRole.VENDOR
      });

      expect(result.person.roles).toContain(PersonRole.VENDOR);
    });

    it('should reject registration with existing email', async () => {
      await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      await expect(authService.register({
        name: 'Jane Doe',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000181',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.EMAIL_ALREADY_EXISTS);
    });

    it('should reject registration with existing tax ID', async () => {
      await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      await expect(authService.register({
        name: 'Jane Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'jane@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.TAX_ID_ALREADY_EXISTS);
    });

    it('should reject registration with weak password', async () => {
      await expect(authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: 'weak',
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.WEAK_PASSWORD);
    });

    it('should reject registration with invalid email format', async () => {
      await expect(authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'invalid-email',
        password: testPassword,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.INVALID_EMAIL);
    });

    it('should reject registration with invalid CPF', async () => {
      await expect(authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '12345678901',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.INVALID_TAX_ID);
    });

    it('should reject registration with invalid CNPJ', async () => {
      await expect(authService.register({
        name: 'Jane Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: '12345678000190',
        email: 'jane@vendor.com',
        password: testPassword,
        role: PersonRole.VENDOR
      })).rejects.toThrow(AuthError.INVALID_TAX_ID);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });
    });

    it('should login with correct credentials', async () => {
      const result = await authService.login({
        email: 'john@example.com',
        password: testPassword
      });

      expect(result.person).toBeDefined();
      expect(result.person.email).toBe('john@example.com');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('should login case-insensitive email', async () => {
      const result = await authService.login({
        email: 'JOHN@EXAMPLE.COM',
        password: testPassword
      });

      expect(result.person.email).toBe('john@example.com');
    });

    it('should reject login with wrong password', async () => {
      await expect(authService.login({
        email: 'john@example.com',
        password: 'WrongPass123!'
      })).rejects.toThrow(AuthError.INVALID_CREDENTIALS);
    });

    it('should reject login with non-existent email', async () => {
      await expect(authService.login({
        email: 'nonexistent@example.com',
        password: testPassword
      })).rejects.toThrow(AuthError.INVALID_CREDENTIALS);
    });

    it('should reject login with empty password', async () => {
      await expect(authService.login({
        email: 'john@example.com',
        password: ''
      })).rejects.toThrow(AuthError.INVALID_CREDENTIALS);
    });
  });

  describe('refreshToken', () => {
    it('should generate new tokens with valid refresh token', async () => {
      const registerResult = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      // Wait for at least 1 second to ensure different JWT timestamp (iat is in seconds)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result = await authService.refreshToken(registerResult.tokens.refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.accessToken).not.toBe(registerResult.tokens.accessToken);
    });

    it('should reject invalid refresh token', async () => {
      await expect(authService.refreshToken('invalid-token')).rejects.toThrow(AuthError.INVALID_TOKEN);
    });

    it('should reject expired refresh token', async () => {
      // Create auth service with very short expiry for both access and refresh
      const shortExpiryAuth = new AuthService(repo, 'test-secret-key', '1ms', '1ms');
      
      await shortExpiryAuth.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john2@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      const loginResult = await shortExpiryAuth.login({
        email: 'john2@example.com',
        password: testPassword
      });

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      await expect(shortExpiryAuth.refreshToken(loginResult.tokens.refreshToken))
        .rejects.toThrow(AuthError.TOKEN_EXPIRED);
    });
  });

  describe('verifyToken', () => {
    it('should return payload for valid access token', async () => {
      const registerResult = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      const payload = authService.verifyToken(registerResult.tokens.accessToken);

      expect(payload).toBeDefined();
      expect(payload.sub).toBe(registerResult.person.id);
      expect(payload.email).toBe('john@example.com');
      expect(payload.roles).toContain(PersonRole.CONSUMER);
      expect(payload.type).toBe('access');
    });

    it('should reject invalid token', () => {
      expect(() => authService.verifyToken('invalid-token')).toThrow(AuthError.INVALID_TOKEN);
    });

    it('should reject expired access token', async () => {
      const shortExpiryAuth = new AuthService(repo, 'test-secret-key', '1ms', '30d');
      
      await shortExpiryAuth.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john3@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      const loginResult = await shortExpiryAuth.login({
        email: 'john3@example.com',
        password: testPassword
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(() => shortExpiryAuth.verifyToken(loginResult.tokens.accessToken))
        .toThrow(AuthError.TOKEN_EXPIRED);
    });
  });

  describe('JWTPayload', () => {
    it('should include required fields', async () => {
      const registerResult = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });

      const payload = authService.verifyToken(registerResult.tokens.accessToken) as JWTPayload;

      expect(payload.sub).toBeDefined();
      expect(payload.email).toBe('john@example.com');
      expect(payload.roles).toBeDefined();
      expect(payload.type).toBe('access');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });
  });
});

describe('AuthError', () => {
  it('should have expected error codes', () => {
    expect(AuthError.EMAIL_ALREADY_EXISTS).toBe('EMAIL_ALREADY_EXISTS');
    expect(AuthError.TAX_ID_ALREADY_EXISTS).toBe('TAX_ID_ALREADY_EXISTS');
    expect(AuthError.WEAK_PASSWORD).toBe('WEAK_PASSWORD');
    expect(AuthError.INVALID_EMAIL).toBe('INVALID_EMAIL');
    expect(AuthError.INVALID_TAX_ID).toBe('INVALID_TAX_ID');
    expect(AuthError.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
    expect(AuthError.INVALID_TOKEN).toBe('INVALID_TOKEN');
    expect(AuthError.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
    expect(AuthError.PERSON_NOT_FOUND).toBe('PERSON_NOT_FOUND');
  });
});