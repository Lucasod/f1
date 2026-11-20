import { describe, it, expect } from 'vitest';
import {
  assertMongoTestIsolation,
  guardedMongoConnect,
  MongoIsolationError,
} from './mongo-isolation-guard';

describe('mongo-isolation-guard (fail-closed)', () => {
  const isolated = {
    mongoUri: 'mongodb://localhost:27017/fs01_marketplace',
    mongoDbName: 'fs01_marketplace_test',
    nodeEnv: 'test',
  };

  it('passes for isolated local test db', () => {
    expect(() => assertMongoTestIsolation(isolated)).not.toThrow();
  });

  it('throws when db name lacks "test"', () => {
    expect(() =>
      assertMongoTestIsolation({ ...isolated, mongoDbName: 'fs01_marketplace' }),
    ).toThrow(MongoIsolationError);
  });

  it('throws when host is non-local', () => {
    expect(() =>
      assertMongoTestIsolation({
        ...isolated,
        mongoUri: 'mongodb://prod.example.com:27017/fs01_marketplace_test',
      }),
    ).toThrow(MongoIsolationError);
  });

  it('throws in production env', () => {
    expect(() =>
      assertMongoTestIsolation({ ...isolated, nodeEnv: 'production' }),
    ).toThrow(MongoIsolationError);
  });

  it('throws when db name empty', () => {
    expect(() =>
      assertMongoTestIsolation({ ...isolated, mongoDbName: '' }),
    ).toThrow(MongoIsolationError);
  });

  it('allowRealConnection opts in (except production)', () => {
    expect(() =>
      assertMongoTestIsolation({
        mongoUri: 'mongodb://prod.example.com:27017/x',
        mongoDbName: 'anything',
        nodeEnv: 'test',
        allowRealConnection: true,
      }),
    ).not.toThrow();
  });

  it('allowRealConnection still blocks production', () => {
    expect(() =>
      assertMongoTestIsolation({
        mongoUri: 'mongodb://localhost:27017/x',
        mongoDbName: 'anything',
        nodeEnv: 'production',
        allowRealConnection: true,
      }),
    ).toThrow(MongoIsolationError);
  });

  it('guardedMongoConnect does not invoke connect on failure', async () => {
    let called = false;
    await expect(
      guardedMongoConnect(
        { ...isolated, mongoDbName: 'nope' },
        async () => {
          called = true;
          return 'connected';
        },
      ),
    ).rejects.toBeInstanceOf(MongoIsolationError);
    expect(called).toBe(false);
  });

  it('guardedMongoConnect invokes connect on success and returns its value', async () => {
    let called = false;
    const result = await guardedMongoConnect(isolated, async () => {
      called = true;
      return 42;
    });
    expect(called).toBe(true);
    expect(result).toBe(42);
  });
});
