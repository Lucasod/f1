import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalEnv = process.env;

function setProductionEnv() {
  process.env.NODE_ENV = 'production';
  process.env.CORS_ORIGIN = 'https://example.com';
  process.env.MONGO_URI = 'mongodb://prod:27017/db';
  process.env.MONGO_DB_NAME = 'fs01_marketplace';
  process.env.REDIS_URL = 'redis://prod:6379';
  process.env.ELASTICSEARCH_URL = 'http://prod:9200';
  process.env.JWT_SECRET = 'production-secret-key';
}

describe('Config Validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.CORS_ORIGIN;
    delete process.env.MONGO_URI;
    delete process.env.MONGO_DB_NAME;
    delete process.env.REDIS_URL;
    delete process.env.ELASTICSEARCH_URL;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Development environment', () => {
    it('should use defaults when env vars are not set', async () => {
      const { config } = await import('./index');
      
      expect(config.port).toBe(3000);
      expect(config.nodeEnv).toBe('development');
      expect(config.mongoUri).toBe('mongodb://localhost:27017/fs01_marketplace');
      expect(config.mongoDbName).toBe('fs01_marketplace');
      expect(config.redisUrl).toBe('redis://localhost:6379');
      expect(config.elasticsearchUrl).toBe('http://localhost:9200');
      expect(config.jwtSecret).toBe('dev-secret-change-in-production');
      expect(config.jwtExpiresIn).toBe('24h');
      expect(config.corsOrigins).toEqual([]);
      expect(config.isProduction).toBe(false);
      expect(config.commissionPct).toBe(10);
    });

    it('should allow empty CORS_ORIGIN in development', async () => {
      process.env.CORS_ORIGIN = '';
      const { config } = await import('./index');
      
      expect(config.corsOrigins).toEqual([]);
    });

    it('should parse multiple CORS origins in development', async () => {
      process.env.CORS_ORIGIN = 'http://localhost:3000, http://localhost:5173';
      const { config } = await import('./index');
      
      expect(config.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:5173']);
    });

    it('should allow wildcard CORS origin in development', async () => {
      process.env.CORS_ORIGIN = '*';
      const { config } = await import('./index');
      
      expect(config.corsOrigins).toEqual(['*']);
    });

    it('should accept whitespace-only values in development', async () => {
      process.env.MONGO_URI = '   ';
      const { config } = await import('./index');
      
      expect(config.mongoUri).toBe('mongodb://localhost:27017/fs01_marketplace');
    });

    it('should use custom COMMISSION_PCT from env', async () => {
      process.env.COMMISSION_PCT = '15.5';
      const { config } = await import('./index');
      
      expect(config.commissionPct).toBe(15.5);
    });
  });

  describe('Production environment', () => {
    beforeEach(() => {
      setProductionEnv();
    });

    it('should throw when MONGO_URI is empty in production', async () => {
      process.env.MONGO_URI = '';
      await expect(import('./index')).rejects.toThrow('MONGO_URI is required in production but is empty or whitespace');
    });

    it('should throw when MONGO_URI is whitespace in production', async () => {
      process.env.MONGO_URI = '   ';
      await expect(import('./index')).rejects.toThrow('MONGO_URI is required in production but is empty or whitespace');
    });

    it('should throw when REDIS_URL is empty in production', async () => {
      process.env.REDIS_URL = '';
      await expect(import('./index')).rejects.toThrow('REDIS_URL is required in production but is empty or whitespace');
    });

    it('should throw when ELASTICSEARCH_URL is empty in production', async () => {
      process.env.ELASTICSEARCH_URL = '';
      await expect(import('./index')).rejects.toThrow('ELASTICSEARCH_URL is required in production but is empty or whitespace');
    });

    it('should throw when JWT_SECRET is empty in production', async () => {
      process.env.JWT_SECRET = '';
      await expect(import('./index')).rejects.toThrow('JWT_SECRET is required in production but is empty or whitespace');
    });

    it('should throw when CORS_ORIGIN is missing in production', async () => {
      delete process.env.CORS_ORIGIN;
      await expect(import('./index')).rejects.toThrow('CORS_ORIGIN is required in production and must contain at least one valid origin');
    });

    it('should throw when CORS_ORIGIN is empty in production', async () => {
      process.env.CORS_ORIGIN = '';
      await expect(import('./index')).rejects.toThrow('CORS_ORIGIN is required in production and must contain at least one valid origin');
    });

    it('should throw when CORS_ORIGIN is only whitespace in production', async () => {
      process.env.CORS_ORIGIN = '   ';
      await expect(import('./index')).rejects.toThrow('CORS_ORIGIN is required in production and must contain at least one valid origin');
    });

    it('should throw when CORS_ORIGIN is only separators in production', async () => {
      process.env.CORS_ORIGIN = ', , ,';
      await expect(import('./index')).rejects.toThrow('CORS_ORIGIN is required in production and must contain at least one valid origin');
    });

    it('should throw when CORS_ORIGIN contains wildcard in production', async () => {
      process.env.CORS_ORIGIN = '*';
      await expect(import('./index')).rejects.toThrow('Wildcard (*) CORS origin is not allowed in production when credentials are enabled');
    });

    it('should throw when CORS_ORIGIN contains wildcard among valid origins in production', async () => {
      process.env.CORS_ORIGIN = 'https://example.com, *';
      await expect(import('./index')).rejects.toThrow('Wildcard (*) CORS origin is not allowed in production when credentials are enabled');
    });

    it('should accept valid CORS origins in production', async () => {
      process.env.CORS_ORIGIN = 'https://example.com, https://app.example.com';
      
      const { config } = await import('./index');
      
      expect(config.corsOrigins).toEqual(['https://example.com', 'https://app.example.com']);
      expect(config.mongoUri).toBe('mongodb://prod:27017/db');
      expect(config.redisUrl).toBe('redis://prod:6379');
      expect(config.elasticsearchUrl).toBe('http://prod:9200');
      expect(config.jwtSecret).toBe('production-secret-key');
    });

    it('should reject default development values in production via validateConfig', async () => {
      process.env.MONGO_URI = 'mongodb://localhost:27017/fs01_marketplace';
      process.env.REDIS_URL = 'redis://localhost:6379';
      process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
      process.env.JWT_SECRET = 'dev-secret-change-in-production';
      process.env.CORS_ORIGIN = 'https://example.com';
      
      const { validateConfig } = await import('./index');
      
      expect(() => validateConfig()).toThrow('MONGO_URI must be set to a production value');
    });
  });

  describe('validateConfig function', () => {
    it('should not throw in development', async () => {
      const { validateConfig } = await import('./index');
      
      expect(() => validateConfig()).not.toThrow();
    });

    it('should throw for default MONGO_URI in production', async () => {
      setProductionEnv();
      process.env.MONGO_URI = 'mongodb://localhost:27017/fs01_marketplace';
      
      const { validateConfig } = await import('./index');
      
      expect(() => validateConfig()).toThrow('MONGO_URI must be set to a production value');
    });

    it('should throw for default REDIS_URL in production', async () => {
      setProductionEnv();
      process.env.REDIS_URL = 'redis://localhost:6379';
      
      const { validateConfig } = await import('./index');
      
      expect(() => validateConfig()).toThrow('REDIS_URL must be set to a production value');
    });

    it('should throw for default ELASTICSEARCH_URL in production', async () => {
      setProductionEnv();
      process.env.ELASTICSEARCH_URL = 'http://localhost:9200';
      
      const { validateConfig } = await import('./index');
      
      expect(() => validateConfig()).toThrow('ELASTICSEARCH_URL must be set to a production value');
    });

    it('should throw for default JWT_SECRET in production', async () => {
      setProductionEnv();
      process.env.JWT_SECRET = 'dev-secret-change-in-production';
      
      const { validateConfig } = await import('./index');
      
      expect(() => validateConfig()).toThrow('JWT_SECRET must be set to a production value');
    });
  });
});