import dotenv from 'dotenv';

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
  return password;
})();

// Other test-related environment variables
export const FRONTEND_URL: string = process.env.FRONTEND_URL || 'http://localhost:5173';
export const STRIPE_WEBHOOK_SECRET: string = process.env.STRIPE_WEBHOOK_SECRET || '';
export const NODE_ENV: string = process.env.NODE_ENV || 'development';