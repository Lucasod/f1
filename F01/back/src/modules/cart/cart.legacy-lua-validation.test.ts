import { describe, expect, it, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RedisCartRepository } from './cart.redis.repository';
import { Cart } from './cart.domain';

describe('effective Lua legacy validation', () => {
  it.each([
    ['nonempty object', '{"x":1}', undefined],
    ['invalid version', '[]', 'invalid'],
    ['fractional version', '[]', '1.5'],
    ['zero version', '[]', '0'],
  ])('rejects %s before modifying hash or TTL', async (label, items, version) => {
    const capture = vi.fn().mockResolvedValue(null);
    await new RedisCartRepository({ eval: capture } as any).findById('capture');
    const script = capture.mock.calls[0][0] as string;
    // ioredis-mock has no cjson; supply only the decoder values needed for these negative cases.
    const stub = `local cjson = {decode = function(s) if s == '{"x":1}' then return {x=1} else return {} end end, encode = function(_) return '{}' end}\n`;
    const redis = new RedisMock();
    const key = `cart:lua-validation-${label.replaceAll(' ', '-')}`;
    try {
      await redis.hset(key, 'items', items, 'updated_at', '2026-01-01T00:00:00.000Z');
      if (version !== undefined) await redis.hset(key, 'version', version);
      await redis.expire(key, 300);
      const before = await redis.hgetall(key);
      const beforeTtl = await redis.ttl(key);
      expect(await redis.eval(stub + script, 1, key, 'synthetic-generation')).toBe('CART_CONFLICT');
      expect(await redis.hgetall(key)).toEqual(before);
      const afterTtl = await redis.ttl(key);
      expect(afterTtl).toBeGreaterThan(0);
      expect(afterTtl).toBeLessThanOrEqual(beforeTtl);
    } finally { await redis.quit(); }
  });

  it.each(['[]', ' [ ] ', '{}', '{ }'])('accepts the supported empty legacy representation %s', async items => {
    const capture = vi.fn().mockResolvedValue(null);
    await new RedisCartRepository({ eval: capture } as any).findById('capture');
    const script = capture.mock.calls[0][0] as string;
    const stub = `local cjson = {decode = function(_) return {} end, encode = function(_) return '{}' end}\n`;
    const redis = new RedisMock();
    const key = `cart:lua-empty-${Buffer.from(items).toString('hex')}`;
    try {
      await redis.hset(key, 'items', items, 'updated_at', '2026-01-01T00:00:00.000Z');
      await redis.expire(key, 300);
      expect(await redis.eval(stub + script, 1, key, 'synthetic-generation')).not.toBe('CART_CONFLICT');
      expect(await redis.hget(key, 'items')).toBe(items);
      expect(String(await redis.hget(key, 'version'))).toBe('1');
      expect(await redis.hget(key, 'generation')).toBe('synthetic-generation');
      expect(await redis.ttl(key)).toBeGreaterThan(0);
    } finally { await redis.quit(); }
  });

  it.each([
    ['invalid item', `{product_id='p', vendor_id='v', quantity=-1, unit_price=1, added_at='2026-01-01T00:00:00.000Z'}`, '2026-01-01T00:00:00.000Z'],
    ['invalid item date', `{product_id='p', vendor_id='v', quantity=1, unit_price=1, added_at='invalid'}`, '2026-01-01T00:00:00.000Z'],
    ['invalid updated date', `{product_id='p', vendor_id='v', quantity=1, unit_price=1, added_at='2026-01-01T00:00:00.000Z'}`, 'invalid'],
  ])('validates %s inside Lua before metadata writes', async (label, item, updatedAt) => {
    const capture = vi.fn().mockResolvedValue(null);
    await new RedisCartRepository({ eval: capture } as any).findById('capture');
    const script = capture.mock.calls[0][0] as string;
    const stub = `local cjson = {decode = function(_) return {${item}} end, encode = function(_) return '{}' end}\n`;
    const redis = new RedisMock();
    const key = `cart:lua-item-${label.replaceAll(' ', '-')}`;
    try {
      await redis.hset(key, 'items', '[{}]', 'updated_at', updatedAt);
      await redis.expire(key, 300);
      const before = await redis.hgetall(key);
      const ttl = await redis.ttl(key);
      expect(await redis.eval(stub + script, 1, key, 'synthetic-generation')).toBe('CART_CONFLICT');
      expect(await redis.hgetall(key)).toEqual(before);
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      expect(await redis.ttl(key)).toBeLessThanOrEqual(ttl);
    } finally { await redis.quit(); }
  });

  it('rejects an earlier generation after delete and recreate even when bytes match', async () => {
    const capture = vi.fn().mockResolvedValue(null);
    await new RedisCartRepository({ eval: capture } as any).findById('capture');
    const script = capture.mock.calls[0][0] as string;
    const stub = `local cjson = {decode = function(_) return {} end, encode = function(_) return '{}' end}\n`;
    const redis = new RedisMock();
    const key = 'cart:lua-recovery-aba';
    try {
      await redis.hset(key, 'items', '[]', 'updated_at', '2026-01-01T00:00:00.000Z');
      await redis.eval(stub + script, 1, key, 'generation-old');
      await redis.del(key);
      await redis.hset(key, 'items', '[]', 'updated_at', '2026-01-01T00:00:00.000Z');
      await redis.eval(stub + script, 1, key, 'generation-new');
      const stale = Cart.reconstruct({ id: 'lua-recovery-aba', generation: 'generation-old', items: [], updatedAt: new Date('2026-01-01T00:00:00.000Z'), version: 1 });
      await expect(new RedisCartRepository(redis as any).update(stale)).rejects.toThrow('CART_CONFLICT');
      expect(await redis.hget(key, 'generation')).toBe('generation-new');
    } finally { await redis.quit(); }
  });
});
