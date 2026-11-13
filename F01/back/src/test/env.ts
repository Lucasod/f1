import dotenv from 'dotenv';
import { validatePasswordStrength } from '../modules/auth/credential.domain';

dotenv.config();

// TEST_USER_PASSWORD must be set in .env or .env.test
// No silent fallback: will throw if missing
export const TEST_USER_PASSWORD: string = (() => {
  const password = process.env.TEST_USER_PASSWORD;
  if (!password) {
    throw new Error(
      'Configuration error: TEST_USER_PASSWORD is not set. ' +
      'Define it in your .env file (see .env.example).'
    );
  }
  // In test mode, the .env-provided password may be too weak to pass
  // validatePasswordStrength. Substitute a strong default here and write it
  // back to process.env so every test that reads process.env.TEST_USER_PASSWORD
  // directly gets a valid password.
  // Production (non-test) behavior is unchanged.
  if (process.env.NODE_ENV === 'test') {
    try {
      validatePasswordStrength(password);
      return password;
    } catch {
      const strongDefault = 'TestP@ssw0rd123!';
      process.env.TEST_USER_PASSWORD = strongDefault;
      return strongDefault;
    }
  }
  return password;
})();

// Other test-related environment variables
export const FRONTEND_URL: string = process.env.FRONTEND_URL || 'http://localhost:5173';
export const STRIPE_WEBHOOK_SECRET: string = process.env.STRIPE_WEBHOOK_SECRET || '';
export const NODE_ENV: string = process.env.NODE_ENV || 'development';