import dotenv from 'dotenv';
import path from 'path';
dotenv.config();

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function validateRequiredInProduction(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (isProduction() && (!trimmed || trimmed.length === 0)) {
    throw new Error(`Configuration error: ${name} is required in production but is empty or whitespace`);
  }
  return trimmed || '';
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function validateCorsOrigins(origins: string[]): void {
  if (isProduction()) {
    if (origins.length === 0) {
      throw new Error('Configuration error: CORS_ORIGIN is required in production and must contain at least one valid origin');
    }
    if (origins.includes('*')) {
      throw new Error('Configuration error: Wildcard (*) CORS origin is not allowed in production when credentials are enabled');
    }
  }
}

/**
 * Resolve the storage root path consistently across the application.
 * In Docker: /app/storage/uploads (mounted volume)
 * In development: project-relative path that works from anywhere
 * Reads STORAGE_ROOT env var at call time to allow test overrides.
 */
function getStorageRoot(): string {
  // If explicitly set via env, use it (for Docker and tests)
  if (process.env.STORAGE_ROOT) {
    return process.env.STORAGE_ROOT;
  }
  // Default: resolve from project root (where package.json is)
  // This file is at F01/back/src/config/index.ts, so go up 3 levels to F01/
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  return path.join(projectRoot, 'storage', 'uploads');
}

/**
 * Resolve the public URL base for uploaded files
 */
function getPublicUrlBase(): string {
  return process.env.STORAGE_PUBLIC_URL || '/api/v1/uploads';
}

const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
validateCorsOrigins(corsOrigins);

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: validateRequiredInProduction(process.env.MONGO_URI, 'MONGO_URI') || 'mongodb://localhost:27017/fs01_marketplace',
  mongoDbName: process.env.MONGO_DB_NAME || 'fs01_marketplace',
  redisUrl: validateRequiredInProduction(process.env.REDIS_URL, 'REDIS_URL') || 'redis://localhost:6379',
  elasticsearchUrl: validateRequiredInProduction(process.env.ELASTICSEARCH_URL, 'ELASTICSEARCH_URL') || 'http://localhost:9200',
  jwtSecret: validateRequiredInProduction(process.env.JWT_SECRET, 'JWT_SECRET') || 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  corsOrigins,
  isProduction: isProduction(),
  commissionPct: parseFloat(process.env.COMMISSION_PCT || '10'),
  get storageRoot() { return getStorageRoot(); },
  get storagePublicUrlBase() { return getPublicUrlBase(); },
};

export function validateConfig(): void {
  if (config.isProduction) {
    if (!config.mongoUri || config.mongoUri === 'mongodb://localhost:27017/fs01_marketplace') {
      throw new Error('Configuration error: MONGO_URI must be set to a production value');
    }
    if (!config.redisUrl || config.redisUrl === 'redis://localhost:6379') {
      throw new Error('Configuration error: REDIS_URL must be set to a production value');
    }
    if (!config.elasticsearchUrl || config.elasticsearchUrl === 'http://localhost:9200') {
      throw new Error('Configuration error: ELASTICSEARCH_URL must be set to a production value');
    }
    if (!config.jwtSecret || config.jwtSecret === 'dev-secret-change-in-production') {
      throw new Error('Configuration error: JWT_SECRET must be set to a production value');
    }
  }
}