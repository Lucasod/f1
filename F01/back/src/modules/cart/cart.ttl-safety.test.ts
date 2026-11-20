import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cart } from './cart.domain';
import { RedisCartRepository } from './cart.redis.repository';
import RedisMock from 'ioredis-mock';

describe('cart TTL safety', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['0', '-1', 'NaN', 'Infinity', '1.5', '10seconds', '', '9007199254740', '9007199254740992'])
    ('rejects invalid TTL %s before writing', value => {
      vi.stubEnv('CART_TTL', value);
      const evalScript = vi.fn();
      expect(() => new RedisCartRepository({ eval: evalScript } as any)).toThrow('INVALID_CART_TTL');
      expect(evalScript).not.toHaveBeenCalled();
    });

  it.each([['3600', '3600'], ['0003600', '3600'], [undefined, '2592000']])('sends a valid or existing default TTL to atomic creation', async (value, expected) => {
    vi.stubEnv('CART_TTL', value);
    const evalScript = vi.fn().mockResolvedValue('CREATED');
    const repo = new RedisCartRepository({ eval: evalScript } as any);
    await repo.save(Cart.create('test'));
    expect(evalScript.mock.calls[0][6]).toBe(expected);
  });

  it('accepts a canonical positive TTL in the Lua script', async () => {
    vi.stubEnv('CART_TTL', '3600');
    const capture = vi.fn().mockResolvedValue('CREATED');
    await new RedisCartRepository({ eval: capture } as any).save(Cart.create('test'));
    const redis = new RedisMock();
    try {
      expect(await redis.eval(capture.mock.calls[0][0], 1, 'cart:ttl-valid-canonical', '[]', new Date().toISOString(), '1', '3600', 'test-generation')).toBe('CREATED');
      expect(await redis.ttl('cart:ttl-valid-canonical')).toBeGreaterThan(0);
    } finally {
      await redis.quit();
    }
  });

  it.each(['0', '-1', 'NaN', '1.5', '9007199254741', '01', '0003600'])('rejects invalid Lua TTL %s before writing', async ttl => {
    vi.stubEnv('CART_TTL', '3600');
    const capture = vi.fn().mockResolvedValue('CREATED');
    await new RedisCartRepository({ eval: capture } as any).save(Cart.create('test'));
    const script = capture.mock.calls[0][0];
    const redis = new RedisMock();
    const key = `cart:ttl-test-${ttl}`;
    try {
      expect(await redis.eval(script, 1, key, '[]', new Date().toISOString(), '1', ttl)).toBe('INVALID_CART_TTL');
      expect(await redis.exists(key)).toBe(0);
    } finally {
      await redis.quit();
    }
  });

  it('revalidates the TTL immediately before invoking the creation script', async () => {
    vi.stubEnv('CART_TTL', '3600');
    const evalScript = vi.fn();
    const repo = new RedisCartRepository({ eval: evalScript } as any);
    (repo as unknown as { ttlSeconds: number }).ttlSeconds = 0;
    await expect(repo.save(Cart.create('test'))).rejects.toThrow('INVALID_CART_TTL');
    expect(evalScript).not.toHaveBeenCalled();
  });
});
