import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { CartError } from './cart.domain';
import { RedisCartRepository } from './cart.redis.repository';

const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis('RedisCartRepository integration', () => {
  const suffix = randomUUID();
  const guestId = `guest:${suffix}`;
  const userId = `redis-integration:${suffix}`;
  const stockGuestId = `guest:stock-${suffix}`;
  const stockUserId = `redis-stock:${suffix}`;
  const redis = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const repository = new RedisCartRepository(redis);

  beforeAll(async () => {
    await repository.connect();
  });

  afterAll(async () => {
    await repository.delete(guestId);
    await repository.delete(userId);
    await repository.delete(stockGuestId);
    await repository.delete(stockUserId);
    await repository.disconnect();
  });

  it('persists guest carts, validates quantity, atomically merges once, and refreshes TTL', async () => {
    const guestCart = await repository.addItem(guestId, 'product-a', 'vendor-a', 2, 15, 5);
    expect(guestCart.getItem('product-a')?.quantity).toBe(2);
    await expect(repository.addItem(guestId, 'product-a', 'vendor-a', 4, 15, 5))
      .rejects.toThrow(CartError.STOCK_INSUFFICIENT);

    await repository.addItem(guestId, 'product-b', 'vendor-a', 1, 25, 5);
    await repository.addItem(userId, 'product-a', 'vendor-a', 1, 15, 5);

    await Promise.all([
      repository.mergeGuestCart(guestId, userId),
      repository.mergeGuestCart(guestId, userId),
    ]);

    const persistedCart = await repository.findById(userId);
    expect(persistedCart?.getItem('product-a')?.quantity).toBe(3);
    expect(persistedCart?.getItem('product-b')?.quantity).toBe(1);
    expect(await repository.findById(guestId)).toBeNull();

    const updatedCart = await repository.updateItemQuantity(userId, 'product-b', 2, 5);
    expect(updatedCart.getItem('product-b')?.quantity).toBe(2);
    await repository.removeItem(userId, 'product-b');
    expect((await repository.findById(userId))?.getItem('product-b')).toBeUndefined();

    const ttl = await redis.ttl(`cart:${userId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2_592_000);
  });

  it('rejects an over-stock merge atomically without deleting either cart', async () => {
    await repository.delete(stockGuestId);
    await repository.delete(stockUserId);
    const guestCart = (await repository.addItem(stockGuestId, 'limited-product', 'vendor-a', 2, 15, 5));
    const userCart = await repository.addItem(stockUserId, 'limited-product', 'vendor-a', 1, 15, 5);
    expect(guestCart.getItem('limited-product')?.quantity).toBe(2);
    expect(userCart.getItem('limited-product')?.quantity).toBe(1);

    await expect(repository.mergeGuestCart(stockGuestId, stockUserId, { 'limited-product': 2 }))
      .rejects.toThrow(CartError.STOCK_INSUFFICIENT);

    expect((await repository.findById(stockGuestId))?.getItem('limited-product')?.quantity).toBe(2);
    expect((await repository.findById(stockUserId))?.getItem('limited-product')?.quantity).toBe(1);
  });

  it('checks stock when merging into a user cart that does not exist', async () => {
    await repository.delete(stockGuestId);
    await repository.delete(stockUserId);
    await repository.addItem(stockGuestId, 'limited-product', 'vendor-a', 2, 15, 5);

    await expect(repository.mergeGuestCart(stockGuestId, stockUserId, { 'limited-product': 1 }))
      .rejects.toThrow(CartError.STOCK_INSUFFICIENT);

    expect((await repository.findById(stockGuestId))?.getItem('limited-product')?.quantity).toBe(2);
    expect(await repository.findById(stockUserId)).toBeNull();
  });
});
