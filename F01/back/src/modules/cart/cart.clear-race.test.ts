import { expect, it, vi } from 'vitest';
import { Cart, InMemoryCartRepository } from './cart.domain';
import RedisMock from 'ioredis-mock';
import { RedisCartRepository } from './cart.redis.repository';
import { CartService } from './cart.service';
import { config } from '../../config';

it('returns a conflict without losing an item added after the clear snapshot', async () => {
  const repo = new InMemoryCartRepository();
  const service = new CartService(repo, {} as any, {} as any, config);
    const initial = Cart.create('clear-race-owner');
    initial.addItem('original', 'vendor', 1, 10);
    await repo.save(initial);
    const other = Cart.create('clear-race-other');
    other.addItem('separate', 'vendor', 1, 10);
    await repo.save(other);
    const find = repo.findById.bind(repo);
    vi.spyOn(repo, 'findById').mockImplementationOnce(async id => {
      const stored = await find(id);
      return stored ? Cart.reconstruct(stored.toJSON()) : null;
    });
    const update = repo.update.bind(repo);
    vi.spyOn(repo, 'update').mockImplementationOnce(async snapshot => {
      await repo.addItem('clear-race-owner', 'concurrent', 'vendor', 1, 10, 10);
      return update(snapshot);
    });
    await expect(service.clearCart('clear-race-owner')).resolves.toBe('CART_CONFLICT');
    expect((await repo.findById('clear-race-owner'))?.getItems().map(item => item.productId)).toEqual(['original', 'concurrent']);
    expect((await repo.findById('clear-race-other'))?.getItems().map(item => item.productId)).toEqual(['separate']);
});

it('rejects a stale Redis snapshot without replacing concurrently written items', async () => {
  const redis = new RedisMock();
  const repo = new RedisCartRepository(redis as any);
  const original = Cart.create('clear-cas-redis');
  original.addItem('original', 'vendor', 1, 10);
  try {
    await repo.save(original);
    const stale = Cart.reconstruct(original.toJSON());
    stale.clear();
    const items = [{ product_id: 'concurrent', vendor_id: 'vendor', quantity: 1, unit_price: 10, added_at: new Date().toISOString() }];
    await redis.hset('cart:clear-cas-redis', 'items', JSON.stringify(items), 'version', '2');
    await expect(repo.update(stale)).rejects.toThrow('CART_CONFLICT');
    expect(JSON.parse((await redis.hget('cart:clear-cas-redis', 'items'))!)).toEqual(items);
  } finally {
    await redis.quit();
  }
});

it('propagates clear failures other than an explicit conflict', async () => {
  const repo = new InMemoryCartRepository();
  await repo.save(Cart.create('failure'));
  vi.spyOn(repo, 'update').mockRejectedValue(new Error('storage unavailable'));
  const service = new CartService(repo, {} as any, {} as any, config);
  await expect(service.clearCart('failure')).rejects.toThrow('storage unavailable');
});

it.each(['delete', 'simulated expiry'])('rejects an old snapshot after %s and recreation at the same version', async removal => {
  const redis = new RedisMock();
  const repo = new RedisCartRepository(redis as any);
  const cartId = removal === 'delete' ? 'aba-delete' : 'aba-expiry';
  try {
    const old = Cart.create(cartId);
    await repo.save(old);
    const stale = Cart.reconstruct(old.toJSON());
    stale.clear();
    if (removal === 'delete') await repo.delete(cartId);
    else await redis.del(`cart:${cartId}`); // Simulate Redis having expired the key; no time manipulation or server is used.
    const replacement = Cart.create(cartId);
    replacement.addItem('replacement', 'vendor', 1, 10);
    await repo.save(replacement);
    await expect(repo.update(stale)).rejects.toThrow('CART_CONFLICT');
    expect(JSON.parse((await redis.hget(`cart:${cartId}`, 'items'))!)[0].product_id).toBe('replacement');
  } finally { await redis.quit(); }
});

it('fails closed for legacy carts without generation and version', async () => {
  const redis = new RedisMock();
  const repo = new RedisCartRepository(redis as any);
  try {
    await redis.hset('cart:legacy-cas', 'items', '[]', 'updated_at', new Date().toISOString());
    const stale = Cart.reconstruct({ id: 'legacy-cas', items: [], version: 1, updatedAt: new Date() });
    await expect(repo.update(stale)).rejects.toThrow('CART_CONFLICT');
    expect(await redis.hget('cart:legacy-cas', 'version')).toBeNull();
  } finally { await redis.quit(); }
});

it.each(['missing-version', 'missing-generation'])('rejects a stale whole-cart update against legacy %s without changing it', async legacy => {
  const redis = new RedisMock();
  const repo = new RedisCartRepository(redis as any);
  const key = `cart:${legacy}`;
  const items = [{ product_id: 'existing', vendor_id: 'vendor', quantity: 1, unit_price: 10, added_at: new Date().toISOString() }];
  try {
    await redis.hset(key, 'items', JSON.stringify(items), 'updated_at', new Date().toISOString());
    if (legacy === 'missing-version') await redis.hset(key, 'generation', 'legacy-generation');
    else await redis.hset(key, 'version', '1');
    const before = await redis.hgetall(key);
    const snapshot = Cart.reconstruct({ id: legacy, items: [], updatedAt: new Date(), version: 1, generation: legacy === 'missing-version' ? 'legacy-generation' : undefined });
    await expect(repo.update(snapshot)).rejects.toThrow('CART_CONFLICT');
    expect(await redis.hgetall(key)).toEqual(before);
  } finally { await redis.quit(); }
});

it('keeps in-memory snapshots isolated and rejects a stale generation after recreation', async () => {
  const repo = new InMemoryCartRepository();
  const original = Cart.create('memory-aba');
  original.addItem('original', 'vendor', 1, 10);
  await repo.save(original);
  const snapshot = (await repo.findById('memory-aba'))!;
  const originalTimestamp = original.updatedAt.getTime();
  snapshot.updatedAt.setTime(0);
  snapshot.items[0].addedAt.setTime(0);
  expect((await repo.findById('memory-aba'))?.updatedAt.getTime()).toBe(originalTimestamp);
  expect((await repo.findById('memory-aba'))?.items[0].addedAt.getTime()).not.toBe(0);
  snapshot.clear();
  expect((await repo.findById('memory-aba'))?.getItem('original')).toBeDefined();
  await repo.delete('memory-aba');
  const replacement = Cart.create('memory-aba');
  replacement.addItem('replacement', 'vendor', 1, 10);
  await repo.save(replacement);
  await expect(repo.update(snapshot)).rejects.toThrow('CART_CONFLICT');
  expect((await repo.findById('memory-aba'))?.getItem('replacement')).toBeDefined();
});
