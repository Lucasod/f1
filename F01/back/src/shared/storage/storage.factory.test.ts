import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorageAdapter } from './storage.factory';
import { LocalStorageAdapter } from './local.adapter';

describe('storage factory configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses local storage only when both S3 bucket and region are absent', () => {
    vi.stubEnv('AWS_S3_BUCKET', '');
    vi.stubEnv('AWS_REGION', '');
    vi.stubEnv('AWS_DEFAULT_REGION', '');
    expect(createStorageAdapter()).toBeInstanceOf(LocalStorageAdapter);
  });

  it.each([
    ['bucket without region', 'bucket', ''],
    ['region without bucket', '', 'us-east-1'],
  ])('rejects %s', (_description, bucket, region) => {
    vi.stubEnv('AWS_S3_BUCKET', bucket);
    vi.stubEnv('AWS_REGION', region);
    vi.stubEnv('AWS_DEFAULT_REGION', '');
    expect(() => createStorageAdapter()).toThrow('Incomplete S3 configuration');
  });
});
