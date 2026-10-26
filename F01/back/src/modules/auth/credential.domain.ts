import bcrypt from 'bcryptjs';

export enum CredentialError {
  EMPTY_PASSWORD = 'EMPTY_PASSWORD',
  PASSWORD_TOO_SHORT = 'PASSWORD_TOO_SHORT',
  PASSWORD_WEAK = 'PASSWORD_WEAK',
  HASH_FAILED = 'HASH_FAILED',
  VERIFY_FAILED = 'VERIFY_FAILED'
}

const MIN_PASSWORD_LENGTH = 8;
// Use fewer rounds in test environment for faster tests
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

function validatePasswordStrength(password: string): void {
  if (!password || password.length === 0) {
    throw new Error(CredentialError.EMPTY_PASSWORD);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(CredentialError.PASSWORD_TOO_SHORT);
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (!(hasUppercase && hasLowercase && hasNumber && hasSpecial)) {
    throw new Error(CredentialError.PASSWORD_WEAK);
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordStrength(password);

  try {
    return await bcrypt.hash(password, BCRYPT_ROUNDS);
  } catch {
    throw new Error(CredentialError.HASH_FAILED);
  }
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
