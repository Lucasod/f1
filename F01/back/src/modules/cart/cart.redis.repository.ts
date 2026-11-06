import Redis from 'ioredis';
import { Cart, CartItem, CartError, CartRepository } from './cart.domain';
import { config } from '../../config';

const CART_TTL_SECONDS = parseInt(process.env.CART_TTL || '2592000', 10); // 30 days default

interface StoredCartItem {
  product_id: string;
  vendor_id: string;
  quantity: number;
  added_at: string;
  unit_price: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredCartItem(value: unknown): value is StoredCartItem {
  return isRecord(value)
    && typeof value.product_id === 'string'
    && typeof value.vendor_id === 'string'
    && typeof value.quantity === 'number'
    && Number.isInteger(value.quantity)
    && value.quantity > 0
    && typeof value.added_at === 'string'
    && Number.isFinite(Date.parse(value.added_at))
    && typeof value.unit_price === 'number'
    && Number.isFinite(value.unit_price);
}

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
        local items_data = redis.call('HGET', KEYS[1], 'items')
        local items = {}
        if items_data then
          items = cjson.decode(items_data)
        end

        local version = tonumber(redis.call('HGET', KEYS[1], 'version')) or 0
        local quantity = tonumber(ARGV[3])
        local max_stock = tonumber(ARGV[8]) or math.huge
        local found = false
        for i, item in ipairs(items) do
          if item.product_id == ARGV[1] then
            if item.quantity + quantity > max_stock then
              return 'STOCK_INSUFFICIENT'
            end
            item.quantity = item.quantity + quantity
            found = true
            break
          end
        end

        if not found and quantity > max_stock then
          return 'STOCK_INSUFFICIENT'
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

        -- Guard: if items table is empty, force it as JSON array []
        if #items == 0 then
          items = setmetatable({}, {__jsontype='array'})
        end

        local new_version = version + 1
        redis.call('HSET', KEYS[1], 'items', cjson.encode(items), 'updated_at', ARGV[5], 'version', new_version)
        redis.call('EXPIRE', KEYS[1], ARGV[6])
        return cjson.encode({
          items = items,
          updated_at = ARGV[5],
          version = new_version
        })
      `,

      updateItemQuantity: `
        local items_data = redis.call('HGET', KEYS[1], 'items')
        if not items_data then return nil end
        local items = cjson.decode(items_data)
        local version = tonumber(redis.call('HGET', KEYS[1], 'version')) or 0
        local new_items = {}
        local found = false
        local quantity = tonumber(ARGV[2])
        local max_stock = tonumber(ARGV[5]) or math.huge
        if quantity > max_stock then return 'STOCK_INSUFFICIENT' end
        for _, item in ipairs(items) do
          if item.product_id == ARGV[1] then
            found = true
            if quantity > 0 then
              item.quantity = quantity
              table.insert(new_items, item)
            end
          else
            table.insert(new_items, item)
          end
        end
        if not found then return 'CART_ITEM_NOT_FOUND' end
        local new_version = version + 1
        -- Force empty new_items to be serialized as JSON array []
        if #new_items == 0 then
          new_items = setmetatable({}, {__jsontype='array'})
        end
        -- Use '[]' for storage when empty, otherwise cjson.encode
        local items_to_store = #new_items == 0 and '[]' or cjson.encode(new_items)
        redis.call('HSET', KEYS[1], 'items', items_to_store, 'updated_at', ARGV[3], 'version', new_version)
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        -- Use '[]' for return when empty, otherwise cjson.encode
        local return_items = #new_items == 0 and '[]' or cjson.encode(new_items)
        return cjson.encode({
          items = return_items,
          updated_at = ARGV[3],
          version = new_version
        })
      `,

      removeItem: `
        local items_data = redis.call('HGET', KEYS[1], 'items')
        if not items_data then return nil end
        local items = cjson.decode(items_data)
        local version = tonumber(redis.call('HGET', KEYS[1], 'version')) or 0
        local new_items = {}
        local found = false
        for _, item in ipairs(items) do
          if item.product_id == ARGV[1] then
            found = true
          else
            table.insert(new_items, item)
          end
        end
        if not found then return 'CART_ITEM_NOT_FOUND' end
        local new_version = version + 1
        -- Force empty new_items to be serialized as JSON array []
        if #new_items == 0 then
          new_items = setmetatable({}, {__jsontype='array'})
        end
        -- Use '[]' for storage when empty, otherwise cjson.encode
        local items_to_store = #new_items == 0 and '[]' or cjson.encode(new_items)
        redis.call('HSET', KEYS[1], 'items', items_to_store, 'updated_at', ARGV[2], 'version', new_version)
        redis.call('EXPIRE', KEYS[1], ARGV[3])
        -- Use '[]' for return when empty, otherwise cjson.encode
        local return_items = #new_items == 0 and '[]' or cjson.encode(new_items)
        return cjson.encode({
          items = return_items,
          updated_at = ARGV[2],
          version = new_version
        })
      `,

      getCart: `
        local items_data = redis.call('HGET', KEYS[1], 'items')
        if not items_data then return nil end
        local updated_at = redis.call('HGET', KEYS[1], 'updated_at')
        local version = tonumber(redis.call('HGET', KEYS[1], 'version')) or 1
        local items = cjson.decode(items_data)
        if #items == 0 then
          items = setmetatable({}, {__jsontype='array'})
        end
        return cjson.encode({
          items = items,
          updated_at = updated_at,
          version = version
        })
      `,

      mergeGuestCart: `
        local guest_items_data = redis.call('HGET', KEYS[1], 'items')
        local user_items_data = redis.call('HGET', KEYS[2], 'items')

        if not guest_items_data then return 0 end

        local guest_items = cjson.decode(guest_items_data)
        local user_items = user_items_data and cjson.decode(user_items_data) or {}
        local stock_by_product = cjson.decode(ARGV[3])
        local user_version = tonumber(redis.call('HGET', KEYS[2], 'version')) or 0

        for _, g_item in ipairs(guest_items) do
          local found = false
          for _, u_item in ipairs(user_items) do
            if u_item.product_id == g_item.product_id then
              local max_stock = tonumber(stock_by_product[g_item.product_id])
              if max_stock and u_item.quantity + g_item.quantity > max_stock then
                return 'STOCK_INSUFFICIENT'
              end
              u_item.quantity = u_item.quantity + g_item.quantity
              found = true
              break
            end
          end
          if not found then
            local max_stock = tonumber(stock_by_product[g_item.product_id])
            if max_stock and g_item.quantity > max_stock then
              return 'STOCK_INSUFFICIENT'
            end
            table.insert(user_items, g_item)
          end
        end

        redis.call('HSET', KEYS[2], 'items', cjson.encode(user_items), 'updated_at', ARGV[2], 'version', user_version + 1)
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

  private parseCartData(data: unknown, id?: string): Cart {
    if (!isRecord(data) || typeof data.updated_at !== 'string'
      || typeof data.version !== 'number' || !Number.isInteger(data.version)
      || typeof data.items !== 'string' && !Array.isArray(data.items) && !isRecord(data.items)) {
      throw new Error('INVALID_CART_DATA');
    }

    let storedItems: unknown;
    if (typeof data.items === 'string') {
      try {
        storedItems = JSON.parse(data.items);
      } catch {
        throw new Error('INVALID_CART_DATA');
      }
    } else {
      storedItems = data.items;
    }

    if (Array.isArray(storedItems)) {
      if (!storedItems.every(isStoredCartItem)) {
        throw new Error('INVALID_CART_DATA');
      }
    } else if (isRecord(storedItems) && Object.keys(storedItems).length === 0) {
      storedItems = [];
    } else {
      throw new Error('INVALID_CART_DATA');
    }

    if (!Number.isFinite(Date.parse(data.updated_at))) {
      throw new Error('INVALID_CART_DATA');
    }

const items: CartItem[] = (storedItems as StoredCartItem[]).map((item) => ({
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

  async addItem(
    consumerId: string,
    productId: string,
    vendorId: string,
    quantity: number,
    unitPrice: number,
    maxStock = Number.MAX_SAFE_INTEGER
  ): Promise<Cart> {
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
      unitPrice.toString(),
      maxStock.toString()
    ) as string;

    if (result === CartError.STOCK_INSUFFICIENT) {
      throw new Error(CartError.STOCK_INSUFFICIENT);
    }

    const data = JSON.parse(result);
    const cart = this.parseCartData({ ...data, version: data.version || 1 }, consumerId);
    return cart;
  }

  async updateItemQuantity(
    consumerId: string,
    productId: string,
    quantity: number,
    maxStock = Number.MAX_SAFE_INTEGER
  ): Promise<Cart> {
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
      CART_TTL_SECONDS.toString(),
      maxStock.toString()
    ) as string | null;

    if (!result) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    if (result === CartError.STOCK_INSUFFICIENT || result === CartError.CART_ITEM_NOT_FOUND) {
      throw new Error(result);
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
    if (result === CartError.CART_ITEM_NOT_FOUND) {
      throw new Error(CartError.CART_ITEM_NOT_FOUND);
    }

    const data = JSON.parse(result);
    const cart = this.parseCartData({ ...data, version: data.version || 1 }, consumerId);
    return cart;
  }

  async mergeGuestCart(
    guestId: string,
    userId: string,
    stockByProduct: Record<string, number> = {}
  ): Promise<Cart> {
    const guestKey = this.getKey(guestId);
    const userKey = this.getKey(userId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    const result = await this.redis.eval(
      scripts.mergeGuestCart,
      2,
      guestKey,
      userKey,
      CART_TTL_SECONDS.toString(),
      now, // updated_at
      JSON.stringify(stockByProduct)
    ) as string | number;

    if (result === CartError.STOCK_INSUFFICIENT) {
      throw new Error(CartError.STOCK_INSUFFICIENT);
    }

    const cart = await this.findById(userId);
    if (!cart) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    return cart;
  }

  async getCart(consumerId: string): Promise<Cart | null> {
    return this.findById(consumerId);
  }
}