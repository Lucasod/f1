import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { Cart, CartError, CartRepository } from './cart.domain';
import { RedisCartRepository } from './cart.redis.repository';

// Custom Redis mock that handles Lua scripts in JavaScript
class TestRedisClient extends RedisMock {
  private scripts: Map<string, string> = new Map();
  private originalHset: (key: string, ...args: any[]) => Promise<number>;

  constructor() {
    super();

    // Store original hset for internal use
    this.originalHset = this.hset.bind(this);

    // Override hset to handle object-style arguments (real ioredis supports this)
    this.hset = async (key: string, ...args: any[]) => {
      if (args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])) {
        // Object-style: hset(key, { field1: value1, field2: value2 })
        const obj = args[0];
        return this.originalHset(key, ...Object.entries(obj).flat());
      }
      // Variadic-style: hset(key, field1, value1, field2, value2, ...)
      return this.originalHset(key, ...args);
    };

    // Override eval to handle our specific Lua scripts
    this.eval = async (script: string, numKeys: number, ...args: string[]) => {
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);

      // Identify which script by checking for unique patterns in the Lua code
      if (script.includes('unit_price = tonumber(ARGV[7])')) {
        return this.handleAddItem(keys[0], argv);
      }
      if (script.includes('local qty = tonumber(ARGV[2])') && script.includes('if qty > 0')) {
        return this.handleUpdateItemQuantity(keys[0], argv);
      }
      if (script.includes('product_id ~= ARGV[1]')) {
        return this.handleRemoveItem(keys[0], argv);
      }
      if (script.includes('return cjson.encode({') && script.includes('items = cjson.decode(cart[2])') && script.includes('version = tonumber(cart[6])')) {
        return this.handleGetCart(keys[0]);
      }
      if (script.includes('guest_cart') && script.includes('user_cart')) {
        return this.handleMergeGuestCart(keys[0], keys[1], argv);
      }
      if (script.includes('redis.call(\'DEL\'') || script.includes('redis.call("DEL"')) {
        return this.handleDeleteCart(keys[0]);
      }
      return null;
    };

    // Also override evalsha for script caching
    this.evalsha = this.eval;
  }

  private getCartData(key: string): { items: any[]; updated_at: string; version: number } | null {
    const data = this.data.get(key);
    if (!data || typeof data !== 'object') return null;
    const hash = data as Record<string, string>;
    const itemsStr = hash.items || '[]';
    return {
      items: JSON.parse(itemsStr),
      updated_at: hash.updated_at || new Date().toISOString(),
      version: parseInt(hash.version || '1', 10),
    };
  }

  private setCartData(key: string, items: any[], updated_at: string, version: number, ttl: number): void {
    // Use originalHset to properly store hash fields in RedisMock's internal format
    this.originalHset(key, 'items', JSON.stringify(items), 'updated_at', updated_at, 'version', version.toString());
    this.pexpire(key, ttl * 1000);
  }

private handleAddItem(key: string, argv: string[]): string {
    const [productId, vendorId, quantityStr, addedAt, updatedAt, ttlStr, unitPriceStr] = argv;
    const quantity = parseInt(quantityStr, 10);
    const unitPrice = parseFloat(unitPriceStr);
    const ttl = parseInt(ttlStr, 10);

    let cartData = this.getCartData(key);
    let items = cartData?.items || [];
    let version = cartData?.version || 0;

    const foundIndex = items.findIndex((item: any) => item.product_id === productId);
    if (foundIndex >= 0) {
      items[foundIndex].quantity += quantity; // Merge: add to existing quantity
    } else {
      items.push({
        product_id: productId,
        vendor_id: vendorId,
        quantity,
        added_at: addedAt,
        unit_price: unitPrice,
      });
    }

    version += 1;
    this.setCartData(key, items, updatedAt, version, ttl);

    return JSON.stringify({ items: JSON.stringify(items), updated_at: updatedAt, version });
  }

  private handleUpdateItemQuantity(key: string, argv: string[]): string | null {
    const [productId, quantityStr, updatedAt, ttlStr] = argv;
    const quantity = parseInt(quantityStr, 10);
    const ttl = parseInt(ttlStr, 10);

    const cartData = this.getCartData(key);
    if (!cartData) return null;

    let items = cartData.items;
    const newItems = items
      .map((item: any) => {
        if (item.product_id === productId) {
          if (quantity > 0) {
            return { ...item, quantity };
          }
          return null; // Remove item
        }
        return item;
      })
      .filter(Boolean);

    const version = cartData.version + 1;
    this.setCartData(key, newItems, updatedAt, version, ttl);

    return JSON.stringify({ items: JSON.stringify(newItems), updated_at: updatedAt, version });
  }

  private handleRemoveItem(key: string, argv: string[]): string | null {
    const [productId, updatedAt, ttlStr] = argv;
    const ttl = parseInt(ttlStr, 10);

    const cartData = this.getCartData(key);
    if (!cartData) return null;

    const items = cartData.items.filter((item: any) => item.product_id !== productId);
    const version = cartData.version + 1;
    this.setCartData(key, items, updatedAt, version, ttl);

    return JSON.stringify({ items: JSON.stringify(items), updated_at: updatedAt, version });
  }

  private handleGetCart(key: string): string | null {
    const cartData = this.getCartData(key);
    if (!cartData) return null;

    return JSON.stringify({
      items: JSON.stringify(cartData.items), // Double-encode items to match Lua script behavior
      updated_at: cartData.updated_at,
      version: cartData.version,
    });
  }

  private handleMergeGuestCart(guestKey: string, userKey: string, argv: string[]): number {
    const [ttlStr, updatedAt] = argv;
    const ttl = parseInt(ttlStr, 10);

    const guestData = this.getCartData(guestKey);
    if (!guestData) return 0;

    const userData = this.getCartData(userKey);
    if (!userData) {
      // RENAME guest to user
      this.data.set(userKey, this.data.get(guestKey)!);
      this.pexpire(userKey, ttl * 1000);
      this.data.delete(guestKey);
      return 1;
    }

    // Merge items
    const userItems = [...userData.items];
    for (const guestItem of guestData.items) {
      const foundIndex = userItems.findIndex((u: any) => u.product_id === guestItem.product_id);
      if (foundIndex >= 0) {
        userItems[foundIndex].quantity += guestItem.quantity;
      } else {
        userItems.push(guestItem);
      }
    }

    const version = userData.version + 1;
    this.setCartData(userKey, userItems, updatedAt, version, ttl);
    this.data.delete(guestKey);

    return 1;
  }

  private handleDeleteCart(key: string): number {
    this.data.delete(key);
    return 1;
  }
}

describe('RedisCartRepository', () => {
  let redis: TestRedisClient;
  let repo: CartRepository;

  beforeAll(() => {
    redis = new TestRedisClient();
  });

  afterAll(async () => {
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear all keys before each test
    const keys = await redis.keys('cart:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    repo = new RedisCartRepository(redis as any);
    await repo.connect();
  });

  describe('save()', () => {
    it('should create new cart with unitPrice, version=1, TTL set', async () => {
      const cart = Cart.create('consumer-1');
      cart.addItem('prod-1', 'vendor-1', 2, 29.99);

      const saved = await repo.save(cart);

      expect(saved.id).toBe('consumer-1');
      expect(saved.version).toBe(1);
      expect(saved.items).toHaveLength(1);
      expect(saved.items[0].unitPrice).toBe(29.99);

      // Verify TTL is set (at least 1 second remaining)
      const ttl = await redis.ttl('cart:consumer-1');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(2592000); // 30 days default
    });

    it('should throw CART_ALREADY_EXISTS for existing cart', async () => {
      const cart = Cart.create('consumer-2');
      cart.addItem('prod-1', 'vendor-1', 1, 10);
      await repo.save(cart);

      // Try to save again with same ID
      const cart2 = Cart.create('consumer-2');
      cart2.addItem('prod-2', 'vendor-2', 1, 20);

      await expect(repo.save(cart2)).rejects.toThrow(CartError.CART_ALREADY_EXISTS);
    });
  });

  describe('findById()', () => {
    it('should return null for non-existent cart', async () => {
      const found = await repo.findById('non-existent');
      expect(found).toBeNull();
    });

    it('should return cart with items for existing cart', async () => {
      const cart = Cart.create('consumer-3');
      cart.addItem('prod-1', 'vendor-1', 2, 29.99);
      cart.addItem('prod-2', 'vendor-2', 1, 49.99);
      await repo.save(cart);

      const found = await repo.findById('consumer-3');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('consumer-3');
      expect(found!.version).toBe(1);
      expect(found!.items).toHaveLength(2);
      expect(found!.items[0].productId).toBe('prod-1');
      expect(found!.items[0].quantity).toBe(2);
      expect(found!.items[0].unitPrice).toBe(29.99);
      expect(found!.items[1].productId).toBe('prod-2');
      expect(found!.items[1].quantity).toBe(1);
      expect(found!.items[1].unitPrice).toBe(49.99);
    });
  });

  describe('update()', () => {
    it('should update existing cart preserving version from cart', async () => {
      const cart = Cart.create('consumer-4');
      cart.addItem('prod-1', 'vendor-1', 1, 10);
      await repo.save(cart);

      // Update cart with new item - caller should increment version
      cart.addItem('prod-2', 'vendor-2', 2, 20);
      cart.incrementVersion(); // Caller increments version
      const updated = await repo.update(cart);

      expect(updated.version).toBe(2);
      expect(updated.items).toHaveLength(2);
      expect(updated.totalItems).toBe(3);

      // Verify persistence
      const found = await repo.findById('consumer-4');
      expect(found!.version).toBe(2);
      expect(found!.items).toHaveLength(2);
    });

    it('should throw CART_NOT_FOUND for non-existent cart', async () => {
      const cart = Cart.create('non-existent');
      cart.addItem('prod-1', 'vendor-1', 1, 10);

      await expect(repo.update(cart)).rejects.toThrow(CartError.CART_NOT_FOUND);
    });
  });

  describe('delete()', () => {
    it('should remove cart', async () => {
      const cart = Cart.create('consumer-5');
      cart.addItem('prod-1', 'vendor-1', 1, 10);
      await repo.save(cart);

      await repo.delete('consumer-5');

      const found = await repo.findById('consumer-5');
      expect(found).toBeNull();
    });
  });

  describe('addItem() - atomic operation', () => {
    it('should atomically add item with unitPrice, increment version, reset TTL', async () => {
      // Create cart first via save
      const cart = Cart.create('consumer-6');
      cart.addItem('prod-1', 'vendor-1', 1, 10);
      await repo.save(cart);

      // Use atomic addItem
      const updated = await repo.addItem('consumer-6', 'prod-2', 'vendor-2', 2, 20);

      expect(updated.version).toBe(2);
      expect(updated.items).toHaveLength(2);
      expect(updated.getItem('prod-2')!.quantity).toBe(2);
      expect(updated.getItem('prod-2')!.unitPrice).toBe(20);

      // Verify TTL is reset
      const ttl = await redis.ttl('cart:consumer-6');
      expect(ttl).toBeGreaterThan(0);
    });

    it('should merge quantity for existing product, preserve unitPrice', async () => {
      const cart = Cart.create('consumer-7');
      cart.addItem('prod-1', 'vendor-1', 2, 15);
      await repo.save(cart);

      // Add same product again with different unitPrice - should preserve original
      const updated = await repo.addItem('consumer-7', 'prod-1', 'vendor-1', 3, 99);

      expect(updated.items).toHaveLength(1);
      expect(updated.items[0].quantity).toBe(5); // 2 + 3
      expect(updated.items[0].unitPrice).toBe(15); // Original unitPrice preserved
    });
  });

  describe('updateItemQuantity()', () => {
    it('should update quantity, preserve unitPrice, increment version', async () => {
      const cart = Cart.create('consumer-8');
      cart.addItem('prod-1', 'vendor-1', 2, 25);
      await repo.save(cart);

      const updated = await repo.updateItemQuantity('consumer-8', 'prod-1', 5);

      expect(updated.version).toBe(2);
      expect(updated.items).toHaveLength(1);
      expect(updated.items[0].quantity).toBe(5);
      expect(updated.items[0].unitPrice).toBe(25);
    });

    it('should remove item when quantity = 0', async () => {
      const cart = Cart.create('consumer-9');
      cart.addItem('prod-1', 'vendor-1', 2, 25);
      cart.addItem('prod-2', 'vendor-2', 1, 30);
      await repo.save(cart);

      const updated = await repo.updateItemQuantity('consumer-9', 'prod-1', 0);

      expect(updated.version).toBe(2);
      expect(updated.items).toHaveLength(1);
      expect(updated.items[0].productId).toBe('prod-2');
      expect(updated.items[0].quantity).toBe(1);
    });

    it('should throw CART_NOT_FOUND for non-existent cart', async () => {
      await expect(repo.updateItemQuantity('non-existent', 'prod-1', 5))
        .rejects.toThrow(CartError.CART_NOT_FOUND);
    });
  });

  describe('removeItem()', () => {
    it('should remove item and increment version', async () => {
      const cart = Cart.create('consumer-10');
      cart.addItem('prod-1', 'vendor-1', 2, 25);
      cart.addItem('prod-2', 'vendor-2', 1, 30);
      await repo.save(cart);

      const updated = await repo.removeItem('consumer-10', 'prod-1');

      expect(updated.version).toBe(2);
      expect(updated.items).toHaveLength(1);
      expect(updated.items[0].productId).toBe('prod-2');
    });

    it('should throw CART_NOT_FOUND for non-existent cart', async () => {
      await expect(repo.removeItem('non-existent', 'prod-1'))
        .rejects.toThrow(CartError.CART_NOT_FOUND);
    });
  });

  describe('mergeGuestCart()', () => {
    it('should merge guest cart into user cart, sum quantities, preserve unitPrice', async () => {
      // Guest cart
      const guestCart = Cart.create('guest-1');
      guestCart.addItem('prod-1', 'vendor-1', 2, 100);
      guestCart.addItem('prod-2', 'vendor-2', 1, 50);
      await repo.save(guestCart);

      // User cart with overlapping product
      const userCart = Cart.create('user-1');
      userCart.addItem('prod-1', 'vendor-1', 1, 100);
      await repo.save(userCart);

      const merged = await repo.mergeGuestCart('guest-1', 'user-1');

      expect(merged.id).toBe('user-1');
      expect(merged.items).toHaveLength(2);
      // Quantities merged: 1 + 2 = 3
      expect(merged.getItem('prod-1')!.quantity).toBe(3);
      expect(merged.getItem('prod-1')!.unitPrice).toBe(100);
      expect(merged.getItem('prod-2')!.quantity).toBe(1);
      expect(merged.getItem('prod-2')!.unitPrice).toBe(50);
      expect(merged.totalItems).toBe(4);
    });

    it('should handle empty guest cart (return user cart unchanged)', async () => {
      const userCart = Cart.create('user-2');
      userCart.addItem('prod-1', 'vendor-1', 1, 100);
      await repo.save(userCart);

      // Empty guest cart
      const emptyGuest = Cart.create('guest-2');
      await repo.save(emptyGuest);

      const merged = await repo.mergeGuestCart('guest-2', 'user-2');

      expect(merged.id).toBe('user-2');
      expect(merged.items).toHaveLength(1);
      expect(merged.getItem('prod-1')!.quantity).toBe(1);
    });

    it('should handle empty user cart (RENAME guest cart to user)', async () => {
      // Guest cart with items
      const guestCart = Cart.create('guest-3');
      guestCart.addItem('prod-1', 'vendor-1', 2, 100);
      guestCart.addItem('prod-2', 'vendor-2', 1, 50);
      await repo.save(guestCart);

      // User cart does not exist
      const merged = await repo.mergeGuestCart('guest-3', 'user-3');

      expect(merged.id).toBe('user-3');
      expect(merged.items).toHaveLength(2);
      expect(merged.getItem('prod-1')!.quantity).toBe(2);
      expect(merged.getItem('prod-1')!.unitPrice).toBe(100);
      expect(merged.getItem('prod-2')!.quantity).toBe(1);
      expect(merged.getItem('prod-2')!.unitPrice).toBe(50);
      expect(merged.totalItems).toBe(3);

      // Guest cart should be deleted
      const guestFound = await repo.findById('guest-3');
      expect(guestFound).toBeNull();
    });
  });

  describe('getCart()', () => {
    it('should return cart with correct items, version, updatedAt', async () => {
      const cart = Cart.create('consumer-11');
      cart.addItem('prod-1', 'vendor-1', 2, 29.99);
      cart.addItem('prod-2', 'vendor-2', 1, 49.99);
      await repo.save(cart);

      const found = await repo.getCart('consumer-11');

      expect(found).not.toBeNull();
      expect(found!.id).toBe('consumer-11');
      expect(found!.version).toBe(1);
      expect(found!.items).toHaveLength(2);
      expect(found!.items[0].productId).toBe('prod-1');
      expect(found!.items[0].quantity).toBe(2);
      expect(found!.items[0].unitPrice).toBe(29.99);
      expect(found!.items[1].productId).toBe('prod-2');
      expect(found!.items[1].quantity).toBe(1);
      expect(found!.items[1].unitPrice).toBe(49.99);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent cart', async () => {
      const found = await repo.getCart('non-existent');
      expect(found).toBeNull();
    });
  });
});