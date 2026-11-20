/**
 * Fail-closed pre-connection guard for Mongo test isolation.
 *
 * This module MUST NOT read .env files, perform network I/O, or touch a real
 * Mongo instance. All inputs are injected so the guard stays deterministic and
 * unit-testable with fakes.
 */

export class MongoIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MongoIsolationError';
  }
}

export interface MongoIsolationInput {
  mongoUri: string;
  mongoDbName: string;
  nodeEnv?: string;
  allowRealConnection?: boolean;
}

function extractHost(uri: string): string {
  if (!uri) return '';
  // Normalize mongo schemes to something URL() can parse.
  const normalized = uri
    .replace(/^mongodb\+srv:\/\//i, 'https://')
    .replace(/^mongodb:\/\//i, 'http://');
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1']);

/**
 * Fail-closed: throws MongoIsolationError unless the configuration is provably
 * isolated for tests. Explicit allowRealConnection opts in (still blocks prod).
 */
export function assertMongoTestIsolation(input: MongoIsolationInput): void {
  const env = (input.nodeEnv ?? '').toLowerCase().trim();

  // Never allow tests to run against production.
  if (env === 'production') {
    throw new MongoIsolationError('production environment is not allowed for Mongo test connections');
  }

  // Explicit, deliberate opt-in for a real (non-isolated) connection.
  if (input.allowRealConnection === true) {
    return;
  }

  const dbName = (input.mongoDbName ?? '').trim();
  if (dbName.length === 0) {
    throw new MongoIsolationError('mongoDbName is required for test isolation');
  }
  if (!/test/i.test(dbName)) {
    throw new MongoIsolationError('mongoDbName must contain "test" for isolated test connections');
  }

  const host = extractHost(input.mongoUri ?? '');
  if (!LOCAL_HOSTS.has(host)) {
    throw new MongoIsolationError(`non-local Mongo host "${host}" is not allowed without allowRealConnection`);
  }
}

/**
 * Pre-connection guard wrapper. Runs the isolation check first; only invokes
 * the (injected) connect function when the check passes.
 */
export async function guardedMongoConnect<T>(
  input: MongoIsolationInput,
  connect: () => Promise<T>,
): Promise<T> {
  assertMongoTestIsolation(input);
  return connect();
}

export default assertMongoTestIsolation;
