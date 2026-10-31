import Redis from 'ioredis';
import { Cart, CartItem, CartError, CartRepository } from './cart.domain';
import { config } from '../../config';

const CART_TTL_SECONDS = parseInt(process.env.CART_TTL || '2592000', 10); // 30 days default

export class RedisCartRepository implements CartRepository {
  private redis: Redis;
  private readonly keyPrefix = 'cart:';

  constructor(redisClient?: Redis) {
    this.redis = redisClient || new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });
  }

  private getKey(consumerId: string): string {
    return `${this.keyPrefix}${consumerId}`;
  }

  private getLuaScripts(): Record<string, string> {
    return {
      addItem: `
        local cart = redis.call('HGETALL', KEYS[1])
        local items = {}
        if #cart > 0 then
          items = cjson.decode(cart[2])
        end

        local found = false
        for i, item in ipairs(items) do
          if item.product_id == ARGV[1] then
            item.quantity = item.quantity + tonumber(ARGV[3])
            found = true
            break
          end
        end

        if not found then
          table.insert(items, {
            product_id = ARGV[1],
            vendor_id = ARGV[2],
            quantity = tonumber(ARGV[3]),
            added_at = ARGV[4],
            unit_price = tonumber(ARGV[7])
          })
        end

        local new_version = (tonumber(cart[4]) or 0) + 1
        redis.call('HSET', KEYS[1], 'items', cjson.encode(items), 'updated_at', ARGV[5], 'version', new_version)
        redis.call('EXPIRE', KEYS[1], ARGV[6])
        return cjson.encode({
          items = items,
          updated_at = ARGV[5],
          version = new_version
        })
      `,

      updateItemQuantity: `
        local cart = redis.call('HGETALL', KEYS[1])
        if #cart == 0 then return nil end
        local items = cjson.decode(cart[2])
        local new_items = {}
        for _, item in ipairs(items) do
          if item.product_id == ARGV[1] then
            local qty = tonumber(ARGV[2])
            if qty > 0 then
              item.quantity = qty
              table.insert(new_items, item)
            end
          else
            table.insert(new_items, item)
          end
        end
        local new_version = (tonumber(cart[4]) or 0) + 1
        redis.call('HSET', KEYS[1], 'items', cjson.encode(new_items), 'updated_at', ARGV[3], 'version', new_version)
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        return cjson.encode({
          items = new_items,
          updated_at = ARGV[3],
          version = new_version
        })
      `,

      removeItem: `
        local cart = redis.call('HGETALL', KEYS[1])
        if #cart == 0 then return nil end
        local items = cjson.decode(cart[2])
        local new_items = {}
        for _, item in ipairs(items) do
          if item.product_id ~= ARGV[1] then
            table.insert(new_items, item)
          end
        end
        local new_version = (tonumber(cart[4]) or 0) + 1
        redis.call('HSET', KEYS[1], 'items', cjson.encode(new_items), 'updated_at', ARGV[2], 'version', new_version)
        redis.call('EXPIRE', KEYS[1], ARGV[3])
        return cjson.encode({
          items = new_items,
          updated_at = ARGV[2],
          version = new_version
        })
      `,

      getCart: `
        local cart = redis.call('HGETALL', KEYS[1])
        if #cart == 0 then return nil end
        return cjson.encode({
          items = cjson.decode(cart[2]),
          updated_at = cart[4],
          version = tonumber(cart[6])
        })
      `,

      mergeGuestCart: `
        local guest_cart = redis.call('HGETALL', KEYS[1])
        local user_cart = redis.call('HGETALL', KEYS[2])

        if #guest_cart == 0 then return 0 end
        if #user_cart == 0 then
          redis.call('RENAME', KEYS[1], KEYS[2])
          redis.call('EXPIRE', KEYS[2], ARGV[1])
          return 1
        end

        local guest_items = cjson.decode(guest_cart[2])
        local user_items = cjson.decode(user_cart[2])

        for _, g_item in ipairs(guest_items) do
          local found = false
          for _, u_item in ipairs(user_items) do
            if u_item.product_id == g_item.product_id then
              u_item.quantity = u_item.quantity + g_item.quantity
              found = true
              break
            end
          end
          if not found then
            table.insert(user_items, g_item)
          end
        end

        redis.call('HSET', KEYS[2], 'items', cjson.encode(user_items), 'updated_at', ARGV[2], 'version', (tonumber(user_cart[6]) or 0) + 1)
        redis.call('EXPIRE', KEYS[2], ARGV[1])
        redis.call('DEL', KEYS[1])
        return 1
      `,

      deleteCart: `
        redis.call('DEL', KEYS[1])
        return 1
      `,
    };
  }

  async connect(): Promise<void> {
    if (this.redis.status === 'wait') {
      await this.redis.connect();
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }

  private parseCartData(data: {
    items: string;
    updated_at: string;
    version: number;
  }, id?: string): Cart {
    const items: CartItem[] = JSON.parse(data.items).map((item: {
      product_id: string;
      vendor_id: string;
      quantity: number;
      added_at: string;
      unit_price: number;
    }) => ({
      productId: item.product_id,
      vendorId: item.vendor_id,
      quantity: item.quantity,
      addedAt: new Date(item.added_at),
      unitPrice: item.unit_price,
    }));

    return Cart.reconstruct({
      id: id || '',
      items,
      updatedAt: new Date(data.updated_at),
      version: data.version,
    });
  }

  private cartToHashData(cart: Cart): { items: string; updated_at: string; version: number } {
    return {
      items: JSON.stringify(cart.items.map((item) => ({
        product_id: item.productId,
        vendor_id: item.vendorId,
        quantity: item.quantity,
        added_at: item.addedAt.toISOString(),
        unit_price: item.unitPrice,
      }))),
      updated_at: cart.updatedAt.toISOString(),
      version: cart.version,
    };
  }

  async save(cart: Cart): Promise<Cart> {
    const key = this.getKey(cart.id);
    const hashData = this.cartToHashData(cart);

    const exists = await this.redis.exists(key);
    if (exists) {
      throw new Error(CartError.CART_ALREADY_EXISTS);
    }

    await this.redis.hset(key, {
      items: hashData.items,
      updated_at: hashData.updated_at,
      version: hashData.version,
    });
    await this.redis.expire(key, CART_TTL_SECONDS);

    return cart;
  }

  async findById(id: string): Promise<Cart | null> {
    const key = this.getKey(id);
    const scripts = this.getLuaScripts();

    const result = await this.redis.eval(scripts.getCart, 1, key) as string | null;
    if (!result) {
      return null;
    }

    const data = JSON.parse(result);
    const cart = this.parseCartData(data, id);
    return cart;
  }

  async update(cart: Cart): Promise<Cart> {
    const key = this.getKey(cart.id);
    const hashData = this.cartToHashData(cart);

    const exists = await this.redis.exists(key);
    if (!exists) {
      throw new Error(CartError.CART_NOT_FOUND);
    }

    await this.redis.hset(key, {
      items: hashData.items,
      updated_at: hashData.updated_at,
      version: hashData.version,
    });
    await this.redis.expire(key, CART_TTL_SECONDS);

    return cart;
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);
    const scripts = this.getLuaScripts();
    await this.redis.eval(scripts.deleteCart, 1, key);
  }

  // Atomic operations using Lua scripts

  async addItem(consumerId: string, productId: string, vendorId: string, quantity: number, unitPrice: number): Promise<Cart> {
    const key = this.getKey(consumerId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    const result = await this.redis.eval(
      scripts.addItem,
      1,
      key,
      productId,
      vendorId,
      quantity.toString(),
      now, // added_at
      now, // updated_at
      CART_TTL_SECONDS.toString(),
      unitPrice.toString()
    ) as string;

    const data = JSON.parse(result);
    const cart = this.parseCartData({ ...data, version: data.version || 1 }, consumerId);
    return cart;
  }

  async updateItemQuantity(consumerId: string, productId: string, quantity: number): Promise<Cart> {
    const key = this.getKey(consumerId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    const result = await this.redis.eval(
      scripts.updateItemQuantity,
      1,
      key,
      productId,
      quantity.toString(),
      now, // updated_at
      CART_TTL_SECONDS.toString()
    ) as string | null;

    if (!result) {
      throw new Error(CartError.CART_NOT_FOUND);
    }

    const data = JSON.parse(result);
    const cart = this.parseCartData({ ...data, version: data.version || 1 }, consumerId);
    return cart;
  }

  async removeItem(consumerId: string, productId: string): Promise<Cart> {
    const key = this.getKey(consumerId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    const result = await this.redis.eval(
      scripts.removeItem,
      1,
      key,
      productId,
      now, // updated_at
      CART_TTL_SECONDS.toString()
    ) as string | null;

    if (!result) {
      throw new Error(CartError.CART_NOT_FOUND);
    }

    const data = JSON.parse(result);
    const cart = this.parseCartData({ ...data, version: data.version || 1 }, consumerId);
    return cart;
  }

  async mergeGuestCart(guestId: string, userId: string): Promise<Cart> {
    const guestKey = this.getKey(guestId);
    const userKey = this.getKey(userId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    await this.redis.eval(
      scripts.mergeGuestCart,
      2,
      guestKey,
      userKey,
      CART_TTL_SECONDS.toString(),
      now // updated_at
    );

    return this.findById(userId) as Promise<Cart>;
  }

  async getCart(consumerId: string): Promise<Cart | null> {
    return this.findById(consumerId);
  }
}