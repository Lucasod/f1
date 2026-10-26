import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPassword, verifyPassword, CredentialError } from './credential.domain';

describe('Credential Domain (Password Hashing)', () => {
  const validPassword = 'SecurePass123!';

  describe('hashPassword', () => {
    it('should return a hashed password that is not the original', async () => {
      const hashed = await hashPassword(validPassword);
      expect(hashed).not.toBe(validPassword);
      expect(hashed).toContain('$'); // bcrypt format
    });

    it('should produce different hashes for same password', async () => {
      const hash1 = await hashPassword(validPassword);
      const hash2 = await hashPassword(validPassword);
      expect(hash1).not.toBe(hash2);
    });

    it('should reject empty password', async () => {
      await expect(hashPassword('')).rejects.toThrow(CredentialError.EMPTY_PASSWORD);
    });

    it('should reject password shorter than 8 characters', async () => {
      await expect(hashPassword('Short1!')).rejects.toThrow(CredentialError.PASSWORD_TOO_SHORT);
    });

    it('should reject password without uppercase', async () => {
      await expect(hashPassword('securepass123!')).rejects.toThrow(CredentialError.PASSWORD_WEAK);
    });

    it('should reject password without lowercase', async () => {
      await expect(hashPassword('SECUREPASS123!')).rejects.toThrow(CredentialError.PASSWORD_WEAK);
    });

    it('should reject password without number', async () => {
      await expect(hashPassword('SecurePass!')).rejects.toThrow(CredentialError.PASSWORD_WEAK);
    });

    it('should reject password without special character', async () => {
      await expect(hashPassword('SecurePass123')).rejects.toThrow(CredentialError.PASSWORD_WEAK);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for correct password', async () => {
      const hashed = await hashPassword(validPassword);
      const result = await verifyPassword(validPassword, hashed);
      expect(result).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const hashed = await hashPassword(validPassword);
      const result = await verifyPassword('WrongPass123!', hashed);
      expect(result).toBe(false);
    });

    it('should return false for empty password', async () => {
      const hashed = await hashPassword(validPassword);
      const result = await verifyPassword('', hashed);
      expect(result).toBe(false);
    });

    it('should handle invalid hash gracefully', async () => {
      const result = await verifyPassword(validPassword, 'not-a-valid-hash');
      expect(result).toBe(false);
    });
  });
});

describe('CredentialError', () => {
  it('should have expected error codes', () => {
    expect(CredentialError.EMPTY_PASSWORD).toBe('EMPTY_PASSWORD');
    expect(CredentialError.PASSWORD_TOO_SHORT).toBe('PASSWORD_TOO_SHORT');
    expect(CredentialError.PASSWORD_WEAK).toBe('PASSWORD_WEAK');
    expect(CredentialError.HASH_FAILED).toBe('HASH_FAILED');
    expect(CredentialError.VERIFY_FAILED).toBe('VERIFY_FAILED');
  });
});