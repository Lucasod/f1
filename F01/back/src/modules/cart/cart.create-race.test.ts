import { expect, it, vi } from 'vitest';
import RedisMock from 'ioredis-mock';
import { Cart, CartError, InMemoryCartRepository } from './cart.domain';
import { RedisCartRepository } from './cart.redis.repository';
import { CartService } from './cart.service';
import { Product, ProductStatus } from '../product/product.domain';
import { config } from '../../config';

it('does not overwrite an item inserted between a stale existence check and creation', async () => {
  const redis = new RedisMock();
  const repo = new RedisCartRepository(redis as any);
  const key = 'cart:race';
  const item = { product_id: 'existing', vendor_id: 'vendor', quantity: 1, unit_price: 5, added_at: new Date().toISOString() };
  const inject = async () => { await redis.hset(key, 'items', JSON.stringify([item]), 'updated_at', new Date().toISOString(), 'version', '1'); };
  const realEval = redis.eval.bind(redis);
  vi.spyOn(redis, 'exists').mockImplementationOnce(async () => { await inject(); return 0; });
  vi.spyOn(redis, 'eval').mockImplementationOnce(async (...args: any[]) => { await inject(); return (realEval as any)(...args); });
  try {
    await expect(repo.save(Cart.create('race'))).rejects.toThrow(CartError.CART_ALREADY_EXISTS);
    expect(JSON.parse((await redis.hget(key, 'items'))!)).toEqual([item]);
  } finally {
    await redis.quit();
  }
});

it('accepts only one creation of a cart ID with a separate mocked Redis instance', async () => {
  const redis = new RedisMock();
  const repo = new RedisCartRepository(redis as any);
  try {
    const results = await Promise.allSettled([repo.save(Cart.create('same')), repo.save(Cart.create('same'))]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.message)).toEqual([CartError.CART_ALREADY_EXISTS]);
  } finally {
    await redis.quit();
  }
});

it('recovers a duplicate creation race and adds the requested item once', async () => {
  const carts = new InMemoryCartRepository();
  const originalSave = carts.save.bind(carts);
  vi.spyOn(carts, 'save').mockImplementationOnce(async cart => {
    await originalSave(Cart.create(cart.id));
    await carts.addItem(cart.id, 'prior', 'vendor', 1, 5, 10);
    throw new Error(CartError.CART_ALREADY_EXISTS);
  });
  const product = Product.create({ id: 'new', vendorId: 'vendor', categoryId: 'c', name: 'n', description: 'd', price: 5, quantity: 10, status: ProductStatus.ACTIVE });
  const service = new CartService(carts, { findById: vi.fn().mockResolvedValue(product) } as any,
    { findByPersonId: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue({ id: 'vendor' }) } as any, config);
  const cart = await service.addItem('consumer', 'new', 1);
  expect(cart.getItem('prior')?.quantity).toBe(1);
  expect(cart.getItem('new')?.quantity).toBe(1);
});

it('does not suppress storage errors or a duplicate without a readable cart', async () => {
  for (const error of [new Error('redis unavailable'), new Error(CartError.CART_ALREADY_EXISTS)]) {
    const carts = new InMemoryCartRepository();
    vi.spyOn(carts, 'save').mockRejectedValue(error);
    const add = vi.spyOn(carts, 'addItem');
    const product = Product.create({ vendorId: 'vendor', categoryId: 'c', name: 'n', description: 'd', price: 5, quantity: 1, status: ProductStatus.ACTIVE });
    const service = new CartService(carts, { findById: vi.fn().mockResolvedValue(product) } as any,
      { findByPersonId: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue({ id: 'vendor' }) } as any, config);
    await expect(service.addItem('consumer', 'new', 1)).rejects.toThrow(error.message);
    expect(add).not.toHaveBeenCalled();
  }
});

it('does not exceed available stock across concurrent requests to a new cart', async () => {
  const carts = new InMemoryCartRepository();
  const product = Product.create({ vendorId: 'vendor', categoryId: 'c', name: 'n', description: 'd', price: 5, quantity: 1, status: ProductStatus.ACTIVE });
  const service = new CartService(carts, { findById: vi.fn().mockResolvedValue(product) } as any,
    { findByPersonId: vi.fn().mockResolvedValue(null), findById: vi.fn().mockResolvedValue({ id: 'vendor' }) } as any, config);
  const results = await Promise.allSettled([service.addItem('consumer', 'new', 1), service.addItem('consumer', 'new', 1)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.message)).toEqual([CartError.STOCK_INSUFFICIENT]);
  expect((await carts.findById('consumer'))?.getItem('new')?.quantity).toBe(1);
});
