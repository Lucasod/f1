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
      if (script.includes("return 'UPDATED'")) {
        const existing = this.data.get(keys[0]) as Record<string, string> | undefined;
        if (!existing) return 'CART_NOT_FOUND';
        if (!existing.generation || !existing.version || !Number.isFinite(Number(existing.version)) || existing.generation !== argv[4] || Number(existing.version) !== Number(argv[2])) return 'CART_CONFLICT';
        if (!/^[1-9]\d*$/.test(argv[3]) || Number(argv[3]) > 9007199254740) return 'INVALID_CART_TTL';
        this.setCartData(keys[0], JSON.parse(argv[0]), argv[1], Number(existing.version) + 1, Number(argv[3]));
        return 'UPDATED';
      }
      if (script.includes("return 'CREATED'")) {
        if (!/^[1-9]\d*$/.test(argv[3]) || Number(argv[3]) > 9007199254740) return 'INVALID_CART_TTL';
        if (this.data.has(keys[0])) return 'CART_ALREADY_EXISTS';
        if (!argv[4]) return 'CART_CONFLICT';
        this.setCartData(keys[0], JSON.parse(argv[0]), argv[1], Number(argv[2]), Number(argv[3]), argv[4]);
        return 'CREATED';
      }
      if (script.includes('unit_price = tonumber(ARGV[7])')) {
        return this.handleAddItem(keys[0], argv);
      }
      if (script.includes('local max_stock = tonumber(ARGV[5])') && script.includes('local new_items = {}')) {
        return this.handleUpdateItemQuantity(keys[0], argv);
      }
      if (script.includes('local new_items = {}') && script.includes('local found = false')) {
        return this.handleRemoveItem(keys[0], argv);
      }
      if (script.includes('pcall(cjson.decode, items_data)') && script.includes('updated_at = updated_at')) {
        return this.handleGetCart(keys[0], argv);
      }
      if (script.includes('guest_items_data') && script.includes('user_items_data')) {
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

  private getCartData(key: string): { items: any[]; updated_at: string; version: number; validVersion: boolean; generation?: string } | null {
    const data = this.data.get(key);
    if (!data || typeof data !== 'object') return null;
    const hash = data as Record<string, string>;
    if (hash.items === undefined) return null;
    const itemsStr = hash.items;
    return {
      items: JSON.parse(itemsStr),
      updated_at: hash.updated_at || new Date().toISOString(),
      version: parseInt(hash.version || '1', 10),
      validVersion: hash.version !== undefined && Number.isFinite(Number(hash.version)),
      generation: hash.generation,
    };
  }

  private setCartData(key: string, items: any[], updated_at: string, version: number, ttl: number, generation?: string): void {
    // Use originalHset to properly store hash fields in RedisMock's internal format
    this.originalHset(key, 'items', JSON.stringify(items), 'updated_at', updated_at, 'version', version.toString());
    if (generation) this.originalHset(key, 'generation', generation);
    this.pexpire(key, ttl * 1000);
  }

private handleAddItem(key: string, argv: string[]): string {
    const [productId, vendorId, quantityStr, addedAt, updatedAt, ttlStr, unitPriceStr] = argv;
    const quantity = parseInt(quantityStr, 10);
    const unitPrice = parseFloat(unitPriceStr);
    const ttl = parseInt(ttlStr, 10);
    const maxStock = parseInt(argv[7] || Number.MAX_SAFE_INTEGER.toString(), 10);

    let cartData = this.getCartData(key);
    if (!cartData?.generation || !cartData.validVersion || cartData.generation !== argv[8]) return 'CART_CONFLICT';
    let items = cartData?.items || [];
    let version = cartData?.version || 0;

    const foundIndex = items.findIndex((item: any) => item.product_id === productId);
    if (foundIndex >= 0) {
      if (items[foundIndex].quantity + quantity > maxStock) {
        return 'STOCK_INSUFFICIENT';
      }
      items[foundIndex].quantity += quantity; // Merge: add to existing quantity
    } else {
      if (quantity > maxStock) {
        return 'STOCK_INSUFFICIENT';
      }
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

    return JSON.stringify({ items: JSON.stringify(items), updated_at: updatedAt, version, generation: cartData?.generation });
  }

  private handleUpdateItemQuantity(key: string, argv: string[]): string | null {
    const [productId, quantityStr, updatedAt, ttlStr] = argv;
    const quantity = parseInt(quantityStr, 10);
    const ttl = parseInt(ttlStr, 10);
    const maxStock = parseInt(argv[4] || Number.MAX_SAFE_INTEGER.toString(), 10);

    const cartData = this.getCartData(key);
    if (!cartData) return null;
    if (!cartData.generation || !cartData.validVersion || cartData.generation !== argv[5]) return 'CART_CONFLICT';
    if (quantity > maxStock) return 'STOCK_INSUFFICIENT';
    if (!cartData.items.some((item: any) => item.product_id === productId)) return 'CART_ITEM_NOT_FOUND';

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

   return JSON.stringify({ items: newItems.length === 0 ? {} : JSON.stringify(newItems), updated_at: updatedAt, version, generation: cartData.generation });
  }

  private handleRemoveItem(key: string, argv: string[]): string | null {
    const [productId, updatedAt, ttlStr] = argv;
    const ttl = parseInt(ttlStr, 10);

    const cartData = this.getCartData(key);
    if (!cartData) return null;
    if (!cartData.generation || !cartData.validVersion || cartData.generation !== argv[3]) return 'CART_CONFLICT';
    if (!cartData.items.some((item: any) => item.product_id === productId)) return 'CART_ITEM_NOT_FOUND';

    const items = cartData.items.filter((item: any) => item.product_id !== productId);
    const version = cartData.version + 1;
    this.setCartData(key, items, updatedAt, version, ttl);

    return JSON.stringify({ items: items.length === 0 ? {} : JSON.stringify(items), updated_at: updatedAt, version, generation: cartData.generation });
  }

  private handleGetCart(key: string, argv: string[]): string | null {
    let cartData;
    try { cartData = this.getCartData(key); } catch { return 'CART_CONFLICT'; }
    if (!cartData) return null;
    const hash = this.data.get(key) as Record<string, string>;
    const canonicalDate = (value: unknown): boolean => typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    if (!canonicalDate(hash.updated_at)) return 'CART_CONFLICT';
    if (hash.version !== undefined && (!/^\d+$/.test(hash.version) || !cartData.validVersion || !Number.isInteger(Number(hash.version)) || Number(hash.version) < 1 || Number(hash.version) >= Number.MAX_SAFE_INTEGER)) return 'CART_CONFLICT';
    if (!Array.isArray(cartData.items) && !(cartData.items && typeof cartData.items === 'object' && Object.keys(cartData.items).length === 0)) return 'CART_CONFLICT';
    if (Array.isArray(cartData.items) && !cartData.items.every(item => item && typeof item === 'object'
      && typeof item.product_id === 'string' && typeof item.vendor_id === 'string'
      && typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity > 0
      && typeof item.unit_price === 'number' && Number.isFinite(item.unit_price) && canonicalDate(item.added_at))) return 'CART_CONFLICT';
    if (hash.generation === '') return 'CART_CONFLICT';
    if (hash.version === undefined) this.originalHset(key, 'version', '1');
    if (hash.generation === undefined) this.originalHset(key, 'generation', argv[0]);
    cartData.generation = hash.generation || argv[0];

    const items = cartData.items.length === 0 ? {} : JSON.stringify(cartData.items);
    return JSON.stringify({
      items,
      updated_at: cartData.updated_at,
      version: cartData.version,
      generation: cartData.generation,
    });
  }

  private handleMergeGuestCart(guestKey: string, userKey: string, argv: string[]): number | string {
    const [ttlStr, updatedAt] = argv;
    const ttl = parseInt(ttlStr, 10);

    const guestData = this.getCartData(guestKey);
    if (!guestData) return 0;
    if (!guestData.generation || !guestData.validVersion || guestData.generation !== argv[4]) return 'CART_CONFLICT';

    const userData = this.getCartData(userKey);
    if (!userData && this.data.has(userKey)) return 'CART_CONFLICT';
    if (userData && (!userData.generation || !userData.validVersion || userData.generation !== argv[5])) return 'CART_CONFLICT';
    if (!userData && argv[5] !== '') return 'CART_CONFLICT';

    // Merge items
    const userItems = [...(userData?.items || [])];
    const stockByProduct = JSON.parse(argv[2]);
    for (const guestItem of guestData.items) {
      const foundIndex = userItems.findIndex((u: any) => u.product_id === guestItem.product_id);
      if (foundIndex >= 0) {
        if (stockByProduct[guestItem.product_id] !== undefined && userItems[foundIndex].quantity + guestItem.quantity > stockByProduct[guestItem.product_id]) return 'STOCK_INSUFFICIENT';
        userItems[foundIndex].quantity += guestItem.quantity;
      } else {
        if (stockByProduct[guestItem.product_id] !== undefined && guestItem.quantity > stockByProduct[guestItem.product_id]) return 'STOCK_INSUFFICIENT';
        userItems.push(guestItem);
      }
    }

    const version = (userData?.version || 0) + 1;
    this.setCartData(userKey, userItems, updatedAt, version, ttl, userData?.generation || argv[3]);
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
    it('recovers a legacy hash on read without losing items or existing version', async () => {
      const items = [{ product_id: 'legacy-item', vendor_id: 'vendor', quantity: 1, unit_price: 5, added_at: new Date().toISOString() }];
      await redis.hset('cart:legacy-read', 'items', JSON.stringify(items), 'updated_at', new Date().toISOString(), 'version', '7');
      const recovered = await repo.findById('legacy-read');
      expect(recovered?.generation).toMatch(/^[0-9a-f-]{36}$/);
      expect(recovered?.version).toBe(7);
      expect(recovered?.getItem('legacy-item')?.quantity).toBe(1);
      expect(await redis.hget('cart:legacy-read', 'generation')).toBe(recovered?.generation);
    });

    it('recovers a missing legacy version once and rejects its snapshot after recreation', async () => {
      const items = [{ product_id: 'legacy', vendor_id: 'vendor', quantity: 1, unit_price: 5, added_at: new Date().toISOString() }];
      await redis.hset('cart:legacy-aba', 'items', JSON.stringify(items), 'updated_at', new Date().toISOString());
      const [first, second] = await Promise.all([repo.findById('legacy-aba'), repo.findById('legacy-aba')]);
      expect(first?.generation).toBe(second?.generation);
      expect(first?.version).toBe(1);
      expect((await redis.hget('cart:legacy-aba', 'items'))).toBe(JSON.stringify(items));
      await repo.delete('legacy-aba');
      const replacement = Cart.create('legacy-aba');
      replacement.addItem('new', 'vendor', 1, 5);
      await repo.save(replacement);
      await expect(repo.update(first!)).rejects.toThrow('CART_CONFLICT');
      expect((await repo.findById('legacy-aba'))?.getItem('new')).toBeDefined();
    });

    it('preserves an existing generation when the legacy version is absent', async () => {
      await redis.hset('cart:legacy-version', 'items', '[]', 'updated_at', new Date().toISOString(), 'generation', 'existing-generation');
      const cart = await repo.findById('legacy-version');
      expect(cart?.generation).toBe('existing-generation');
      expect(cart?.version).toBe(1);
      expect(await redis.hget('cart:legacy-version', 'generation')).toBe('existing-generation');
    });

    it('fails closed on malformed legacy version without changing metadata', async () => {
      await redis.hset('cart:legacy-bad-version', 'items', '[]', 'updated_at', new Date().toISOString(), 'version', 'invalid');
      await expect(repo.findById('legacy-bad-version')).rejects.toThrow('CART_CONFLICT');
      expect(await redis.hget('cart:legacy-bad-version', 'version')).toBe('invalid');
      expect(await redis.hget('cart:legacy-bad-version', 'generation')).toBeNull();
    });

    it('rejects nonempty legacy object without changing hash or TTL', async () => {
      const key = 'cart:legacy-invalid-object';
      await redis.hset(key, 'items', '{"x":1}', 'updated_at', '2026-01-01T00:00:00.000Z');
      await redis.expire(key, 300);
      const before = await redis.hgetall(key);
      const ttl = await redis.ttl(key);
      await expect(repo.findById('legacy-invalid-object')).rejects.toThrow('CART_CONFLICT');
      expect(await redis.hgetall(key)).toEqual(before);
      expect(await redis.ttl(key)).toBeLessThanOrEqual(ttl);
      expect(await redis.ttl(key)).toBeGreaterThan(0);
    });

    it.each([
      ['invalid item', '[{"product_id":"item","vendor_id":"vendor","quantity":-1,"unit_price":5,"added_at":"2026-01-01T00:00:00.000Z"}]', '2026-01-01T00:00:00.000Z'],
      ['invalid updated timestamp', '[]', 'invalid-date'],
      ['invalid item timestamp', '[{"product_id":"item","vendor_id":"vendor","quantity":1,"unit_price":5,"added_at":"bad-date"}]', '2026-01-01T00:00:00.000Z'],
    ])('rejects %s before metadata writes and preserves hash and TTL', async (label, items, updatedAt) => {
      const id = `legacy-invalid-${label.replaceAll(' ', '-')}`;
      const key = `cart:${id}`;
      await redis.hset(key, 'items', items, 'updated_at', updatedAt);
      await redis.expire(key, 300);
      const before = await redis.hgetall(key);
      const beforeTtl = await redis.ttl(key);
      await expect(repo.findById(id)).rejects.toThrow();
      expect(await redis.hgetall(key)).toEqual(before);
      expect(await redis.ttl(key)).toBeGreaterThan(0);
      expect(await redis.ttl(key)).toBeLessThanOrEqual(beforeTtl);
    });

    it('validates the current hash when it changes immediately before atomic recovery', async () => {
      const key = 'cart:legacy-interleaving';
      await redis.hset(key, 'items', '[]', 'updated_at', '2026-01-01T00:00:00.000Z');
      const run = redis.eval.bind(redis);
      vi.spyOn(redis, 'eval').mockImplementationOnce(async (...args: any[]) => {
        await redis.hset(key, 'items', '[{"quantity":-1}]');
        return (run as any)(...args);
      });
      try {
        await expect(repo.findById('legacy-interleaving')).rejects.toThrow('CART_CONFLICT');
        expect(await redis.hget(key, 'items')).toBe('[{"quantity":-1}]');
        expect(await redis.hget(key, 'generation')).toBeNull();
        expect(await redis.hget(key, 'version')).toBeNull();
      } finally { vi.restoreAllMocks(); }
    });

    it('accepts the explicitly supported empty legacy object without rewriting its bytes', async () => {
      const key = 'cart:legacy-empty-object';
      await redis.hset(key, 'items', '{ }', 'updated_at', '2026-01-01T00:00:00.000Z');
      const cart = await repo.findById('legacy-empty-object');
      expect(cart?.items).toEqual([]);
      expect(cart?.generation).toBeTruthy();
      expect(await redis.hget(key, 'items')).toBe('{ }');
    });

    it.each(['add', 'update', 'remove'] as const)('recovers a legacy cart before direct %s operations', async operation => {
      const id = `legacy-direct-${operation}`;
      const items = [{ product_id: 'item', vendor_id: 'vendor', quantity: 1, unit_price: 5, added_at: new Date().toISOString() }];
      await redis.hset(`cart:${id}`, 'items', JSON.stringify(items), 'updated_at', new Date().toISOString());
      const cart = operation === 'add' ? await repo.addItem(id, 'item', 'vendor', 1, 5, 3)
        : operation === 'update' ? await repo.updateItemQuantity(id, 'item', 2, 3)
        : await repo.removeItem(id, 'item');
      expect(cart.generation).toMatch(/^[0-9a-f-]{36}$/);
      expect(cart.version).toBe(2);
      expect(cart.getItem('item')?.quantity).toBe(operation === 'remove' ? undefined : 2);
    });

    it('rejects item mutation if the recovered cart is replaced before the write', async () => {
      const cart = Cart.create('recovered-aba');
      cart.addItem('original', 'vendor', 1, 5);
      await repo.save(cart);
      const read = repo.findById.bind(repo);
      vi.spyOn(repo, 'findById').mockImplementationOnce(async id => {
        const snapshot = await read(id);
        await repo.delete(id);
        const replacement = Cart.create(id);
        replacement.addItem('replacement', 'vendor', 1, 5);
        await repo.save(replacement);
        return snapshot;
      });
      await expect(repo.addItem('recovered-aba', 'new', 'vendor', 1, 5, 5)).rejects.toThrow('CART_CONFLICT');
      expect((await read('recovered-aba'))?.getItem('replacement')).toBeDefined();
      vi.restoreAllMocks();
    });

    it('merges into a new destination with a fresh generation and checks stock', async () => {
      const guest = Cart.create('guest-generation');
      guest.addItem('item', 'vendor', 2, 5);
      await repo.save(guest);
      await expect(repo.mergeGuestCart('guest-generation', 'user-generation', { item: 1 })).rejects.toThrow('STOCK_INSUFFICIENT');
      expect((await repo.findById('guest-generation'))?.getItem('item')?.quantity).toBe(2);
      const merged = await repo.mergeGuestCart('guest-generation', 'user-generation', { item: 2 });
      expect(merged.generation).toBeTruthy();
      expect(merged.generation).not.toBe(guest.generation);
      expect(merged.version).toBe(1);
    });
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
    it('updates an unchanged snapshot and increments its version atomically', async () => {
      const cart = Cart.create('consumer-4');
      cart.addItem('prod-1', 'vendor-1', 1, 10);
      await repo.save(cart);

      // The snapshot version is the expected version; the repository increments it.
      cart.addItem('prod-2', 'vendor-2', 2, 20);
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

    it('should atomically reject additions above the current stock limit', async () => {
      const cart = Cart.create('consumer-stock');
      cart.addItem('prod-stock', 'vendor-1', 2, 15);
      await repo.save(cart);

      await expect(repo.addItem('consumer-stock', 'prod-stock', 'vendor-1', 3, 15, 4))
        .rejects.toThrow(CartError.STOCK_INSUFFICIENT);
      expect((await repo.findById('consumer-stock'))?.getItem('prod-stock')?.quantity).toBe(2);
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
