import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService, AuthError, JWTPayload } from './auth.service';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';
import { hashPassword } from '../auth/credential.domain';
const weakValue = 'weak';
const wrongValue = 'WrongPass123!';
const nextValue = 'NewSecurePass456!';
const invalidJwt = 'invalid-token';
const testKey = 'test-secret-key';

describe('Auth Service', () => {
  let repo: InMemoryPersonRepository;
  let authService: AuthService;
  const password = process.env.TEST_USER_PASSWORD!;
  let hashedPassword: string;

  beforeEach(async () => {
    repo = new InMemoryPersonRepository();
    authService = new AuthService(repo, testKey, '24h', '30d');
    hashedPassword = await hashPassword(password);
  });

  describe('register', () => {
    it('should register a new person as Consumer', async () => {
      const result = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: password,
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
        password: password,
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
        password: password,
        role: PersonRole.CONSUMER
      });

      await expect(authService.register({
        name: 'Jane Doe',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000181',
        email: 'john@example.com',
        password: password,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.EMAIL_ALREADY_EXISTS);
    });

    it('should reject registration with existing tax ID', async () => {
      await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: password,
        role: PersonRole.CONSUMER
      });

      await expect(authService.register({
        name: 'Jane Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'jane@example.com',
        password: password,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.TAX_ID_ALREADY_EXISTS);
    });

    it('should reject registration with weak password', async () => {
      await expect(authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: weakValue,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.CREDENTIAL_TOO_WEAK);
    });

    it('should reject registration with invalid email format', async () => {
      await expect(authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'invalid-email',
        password: password,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.INVALID_EMAIL);
    });

    it('should reject registration with invalid CPF', async () => {
      await expect(authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '12345678901',
        email: 'john@example.com',
        password: password,
        role: PersonRole.CONSUMER
      })).rejects.toThrow(AuthError.INVALID_TAX_ID);
    });

    it('should reject registration with invalid CNPJ', async () => {
      await expect(authService.register({
        name: 'Jane Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: '12345678000190',
        email: 'jane@vendor.com',
        password: password,
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
        password: password,
        role: PersonRole.CONSUMER
      });
    });

    it('should login with correct credentials', async () => {
      const result = await authService.login({
        email: 'john@example.com',
        password: password
      });

      expect(result.person).toBeDefined();
      expect(result.person.email).toBe('john@example.com');
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('should login case-insensitive email', async () => {
      const result = await authService.login({
        email: 'JOHN@EXAMPLE.COM',
        password: password
      });

      expect(result.person.email).toBe('john@example.com');
    });

    it('should reject login with wrong password', async () => {
      await expect(authService.login({
        email: 'john@example.com',
        password: wrongValue
      })).rejects.toThrow(AuthError.INVALID_CREDENTIALS);
    });

    it('should reject login with non-existent email', async () => {
      await expect(authService.login({
        email: 'nonexistent@example.com',
        password: password
      })).rejects.toThrow(AuthError.INVALID_CREDENTIALS);
    });

    it('should reject login with empty password', async () => {
      await expect(authService.login({
        email: 'john@example.com',
        password: ''
      })).rejects.toThrow(AuthError.INVALID_CREDENTIALS);
    });
  });

  describe('changePassword', () => {
    let personId: string;

    beforeEach(async () => {
      const result = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: password,
        role: PersonRole.CONSUMER
      });
      personId = result.person.id;
    });

    it('should replace the credential after verifying the current password', async () => {
      const nextValue = 'NewSecurePass456!';

      await authService.changePassword(personId, password, nextValue);

      await expect(authService.login({ email: 'john@example.com', password: nextValue }))
        .resolves.toBeDefined();
      await expect(authService.login({ email: 'john@example.com', password: password }))
        .rejects.toThrow(AuthError.INVALID_CREDENTIALS);
    });

    it('should reject an incorrect current password', async () => {
      await expect(authService.changePassword(personId, wrongValue, nextValue))
        .rejects.toThrow(AuthError.INVALID_CURRENT_CREDENTIAL);
    });

    it('should reject a weak new password without changing the existing credential', async () => {
      await expect(authService.changePassword(personId, password, weakValue))
        .rejects.toThrow(AuthError.CREDENTIAL_TOO_WEAK);

      await expect(authService.login({ email: 'john@example.com', password: password }))
        .resolves.toBeDefined();
    });
  });

  describe('refreshToken', () => {
    it('should generate new tokens with valid refresh token', async () => {
      const registerResult = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: password,
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
      await expect(authService.refreshToken(invalidJwt)).rejects.toThrow(AuthError.INVALID_SESSION);
    });

    it('should reject expired refresh token', async () => {
      // Create auth service with very short expiry for both access and refresh
      const shortExpiryAuth = new AuthService(repo, testKey, '1ms', '1ms');
      
      await shortExpiryAuth.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john2@example.com',
        password: password,
        role: PersonRole.CONSUMER
      });

      const loginResult = await shortExpiryAuth.login({
        email: 'john2@example.com',
        password: password
      });

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10));

      await expect(shortExpiryAuth.refreshToken(loginResult.tokens.refreshToken))
        .rejects.toThrow(AuthError.TOKEN_EXPIRED);
    });
  });

  describe('logout', () => {
    let registerResult: Awaited<ReturnType<typeof authService.register>>;

    beforeEach(async () => {
      registerResult = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: password,
        role: PersonRole.CONSUMER
      });
    });

    it('should revoke a refresh token so it can no longer be used to refresh', async () => {
      const refreshToken = registerResult.tokens.refreshToken;

      await authService.logout(refreshToken);

      await expect(authService.refreshToken(refreshToken)).rejects.toThrow(AuthError.INVALID_SESSION);
    });

    it('should reject logout with an invalid refresh token', async () => {
      await expect(authService.logout(invalidJwt)).rejects.toThrow(AuthError.INVALID_SESSION);
    });

    it('should not affect other valid refresh tokens', async () => {
      // Wait to ensure different iat
      await new Promise(resolve => setTimeout(resolve, 1100));
      const otherResult = await authService.register({
        name: 'Jane Doe',
        taxIdType: 'CPF',
        taxIdValue: '98765432100',
        email: 'jane@example.com',
        password: password,
        role: PersonRole.CONSUMER
      });

      await authService.logout(registerResult.tokens.refreshToken);

      // The other user's token should still work
      const result = await authService.refreshToken(otherResult.tokens.refreshToken);
      expect(result.accessToken).toBeDefined();

      // The revoked token should not work
      await expect(authService.refreshToken(registerResult.tokens.refreshToken))
        .rejects.toThrow(AuthError.INVALID_SESSION);
    });
  });

  describe('verifyToken', () => {
    it('should return payload for valid access token', async () => {
      const registerResult = await authService.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john@example.com',
        password: password,
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
      expect(() => authService.verifyToken(invalidJwt)).toThrow(AuthError.INVALID_SESSION);
    });

    it('should reject expired access token', async () => {
      const shortExpiryAuth = new AuthService(repo, testKey, '1ms', '30d');
      
      await shortExpiryAuth.register({
        name: 'John Doe',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email: 'john3@example.com',
        password: password,
        role: PersonRole.CONSUMER
      });

      const loginResult = await shortExpiryAuth.login({
        email: 'john3@example.com',
        password: password
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
        password: password,
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
    expect(AuthError.CREDENTIAL_TOO_WEAK).toBe('WEAK_PASSWORD');
    expect(AuthError.INVALID_EMAIL).toBe('INVALID_EMAIL');
    expect(AuthError.INVALID_TAX_ID).toBe('INVALID_TAX_ID');
    expect(AuthError.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS');
    expect(AuthError.INVALID_SESSION).toBe('INVALID_TOKEN');
    expect(AuthError.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
    expect(AuthError.PERSON_NOT_FOUND).toBe('PERSON_NOT_FOUND');
  });
});