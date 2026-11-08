import Redis from 'ioredis';
import { Cart, CartItem, CartError, CartRepository } from './cart.domain';
import { config } from '../../config';

const DEFAULT_CART_TTL_SECONDS = 2592000; // Existing 30-day implementation default, not a retention decision.

function validateCartTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || !Number.isSafeInteger(value * 1000 + Date.now())) {
    throw new Error('INVALID_CART_TTL');
  }
  return value;
}

function readCartTtl(): number {
  const raw = process.env.CART_TTL;
  if (raw === undefined) return validateCartTtl(DEFAULT_CART_TTL_SECONDS);
  if (!/^[0-9]+$/.test(raw)) throw new Error('INVALID_CART_TTL');
  return validateCartTtl(Number(raw));
}

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
  private readonly ttlSeconds: number;
  private readonly keyPrefix = 'cart:';

  constructor(redisClient?: Redis) {
    this.ttlSeconds = readCartTtl();
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
      createCart: `
        local ttl = tonumber(ARGV[4])
        if not string.match(ARGV[4], '^[1-9]%d*$') or not ttl or ttl <= 0 or ttl > 9007199254740 then
          return 'INVALID_CART_TTL'
        end
        if redis.call('EXISTS', KEYS[1]) == 1 then return 'CART_ALREADY_EXISTS' end
        if not ARGV[5] or ARGV[5] == '' then return 'CART_CONFLICT' end
        redis.call('HSET', KEYS[1], 'items', ARGV[1], 'updated_at', ARGV[2], 'version', ARGV[3], 'generation', ARGV[5])
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        return 'CREATED'
      `,
      updateCart: `
        if redis.call('EXISTS', KEYS[1]) == 0 then return 'CART_NOT_FOUND' end
        local current = tonumber(redis.call('HGET', KEYS[1], 'version'))
        local generation = redis.call('HGET', KEYS[1], 'generation')
        if not current or not generation or generation == '' or generation ~= ARGV[5] or current ~= tonumber(ARGV[3]) then return 'CART_CONFLICT' end
        local ttl = tonumber(ARGV[4])
        if not string.match(ARGV[4], '^[1-9]%d*$') or not ttl or ttl <= 0 or ttl > 9007199254740 then return 'INVALID_CART_TTL' end
        redis.call('HSET', KEYS[1], 'items', ARGV[1], 'updated_at', ARGV[2], 'version', current + 1)
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        return 'UPDATED'
      `,
      addItem: `
        local items_data = redis.call('HGET', KEYS[1], 'items')
        local generation = redis.call('HGET', KEYS[1], 'generation')
        local version = tonumber(redis.call('HGET', KEYS[1], 'version'))
        if not items_data or not generation or generation == '' or not version or generation ~= ARGV[9] then return 'CART_CONFLICT' end
        local items = {}
        if items_data then
          items = cjson.decode(items_data)
        end

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
          generation = generation,
          updated_at = ARGV[5],
          version = new_version
        })
      `,

      updateItemQuantity: `
        local items_data = redis.call('HGET', KEYS[1], 'items')
        if not items_data then return nil end
        local generation = redis.call('HGET', KEYS[1], 'generation')
        local version = tonumber(redis.call('HGET', KEYS[1], 'version'))
        if not generation or generation == '' or not version or generation ~= ARGV[6] then return 'CART_CONFLICT' end
        local items = cjson.decode(items_data)
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
          generation = generation,
          updated_at = ARGV[3],
          version = new_version
        })
      `,

      removeItem: `
        local items_data = redis.call('HGET', KEYS[1], 'items')
        if not items_data then return nil end
        local generation = redis.call('HGET', KEYS[1], 'generation')
        local version = tonumber(redis.call('HGET', KEYS[1], 'version'))
        if not generation or generation == '' or not version or generation ~= ARGV[4] then return 'CART_CONFLICT' end
        local items = cjson.decode(items_data)
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
          generation = generation,
          updated_at = ARGV[2],
          version = new_version
        })
      `,

      getCart: `
        local function is_canonical_date(value)
          if type(value) ~= 'string' then return false end
          local y, mo, d, h, mi, s = string.match(value, '^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)%.%d%d%dZ$')
          if not y then return false end
          y, mo, d, h, mi, s = tonumber(y), tonumber(mo), tonumber(d), tonumber(h), tonumber(mi), tonumber(s)
          if mo < 1 or mo > 12 or h > 23 or mi > 59 or s > 59 then return false end
          local days = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
          if y % 400 == 0 or (y % 4 == 0 and y % 100 ~= 0) then days[2] = 29 end
          return d >= 1 and d <= days[mo]
        end
        local items_data = redis.call('HGET', KEYS[1], 'items')
        if not items_data then return nil end
        local updated_at = redis.call('HGET', KEYS[1], 'updated_at')
        local raw_version = redis.call('HGET', KEYS[1], 'version')
        local version = 1
        if raw_version then
          if not string.match(raw_version, '^%d+$') then return 'CART_CONFLICT' end
          version = tonumber(raw_version)
        end
        local generation = redis.call('HGET', KEYS[1], 'generation')
        if not is_canonical_date(updated_at) or not version or version < 1 or version ~= math.floor(version) or version >= 9007199254740991 or generation == '' then return 'CART_CONFLICT' end
        local normalized_items = string.match(items_data, '^%s*(.-)%s*$')
        local array_shape = string.match(normalized_items, '^%[.*%]$')
        local legacy_empty_object = string.match(normalized_items, '^%{%s*%}$')
        if not array_shape and not legacy_empty_object then return 'CART_CONFLICT' end
        local valid, items = pcall(cjson.decode, items_data)
        if not valid or type(items) ~= 'table' then return 'CART_CONFLICT' end
        for _, item in ipairs(items) do
          if type(item) ~= 'table' or type(item.product_id) ~= 'string' or type(item.vendor_id) ~= 'string'
            or type(item.quantity) ~= 'number' or item.quantity ~= item.quantity or item.quantity <= 0
            or item.quantity == math.huge or item.quantity ~= math.floor(item.quantity)
            or type(item.unit_price) ~= 'number' or item.unit_price ~= item.unit_price
            or item.unit_price == math.huge or item.unit_price == -math.huge
            or not is_canonical_date(item.added_at) then return 'CART_CONFLICT' end
        end
        local missing_generation = not generation
        if missing_generation then generation = ARGV[1] end
        if not generation or generation == '' then return 'CART_CONFLICT' end
        if not raw_version and missing_generation then
          redis.call('HSET', KEYS[1], 'version', version, 'generation', generation)
        elseif not raw_version then
          redis.call('HSET', KEYS[1], 'version', version)
        elseif missing_generation then
          redis.call('HSET', KEYS[1], 'generation', generation)
        end
        if #items == 0 then
          items = setmetatable({}, {__jsontype='array'})
        end
        return cjson.encode({
          items = items,
          generation = generation,
          updated_at = updated_at,
          version = version
        })
      `,

      mergeGuestCart: `
        local guest_items_data = redis.call('HGET', KEYS[1], 'items')
        local user_items_data = redis.call('HGET', KEYS[2], 'items')

        if not guest_items_data then return 0 end
        if redis.call('EXISTS', KEYS[2]) == 1 and not user_items_data then return 'CART_CONFLICT' end
        local guest_generation = redis.call('HGET', KEYS[1], 'generation')
        local guest_version = tonumber(redis.call('HGET', KEYS[1], 'version'))
        if not guest_generation or guest_generation == '' or not guest_version or guest_generation ~= ARGV[5] then return 'CART_CONFLICT' end

        local guest_items = cjson.decode(guest_items_data)
        local user_items = user_items_data and cjson.decode(user_items_data) or {}
        local stock_by_product = cjson.decode(ARGV[3])
        local user_version = tonumber(redis.call('HGET', KEYS[2], 'version'))
        local user_generation = redis.call('HGET', KEYS[2], 'generation')
        if user_items_data and (not user_version or not user_generation or user_generation == '') then return 'CART_CONFLICT' end
        if (user_items_data and user_generation ~= ARGV[6]) or (not user_items_data and ARGV[6] ~= '') then return 'CART_CONFLICT' end
        if not user_items_data then user_version = 0; user_generation = ARGV[4] end

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

        redis.call('HSET', KEYS[2], 'items', cjson.encode(user_items), 'updated_at', ARGV[2], 'version', user_version + 1, 'generation', user_generation)
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
      generation: typeof data.generation === 'string' ? data.generation : undefined,
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

    const result = await this.redis.eval(this.getLuaScripts().createCart, 1, key,
      hashData.items, hashData.updated_at, String(hashData.version), String(validateCartTtl(this.ttlSeconds)), cart.generation || '');
    if (result === 'INVALID_CART_TTL') throw new Error('INVALID_CART_TTL');
    if (result === CartError.CART_ALREADY_EXISTS || result === CartError.CART_CONFLICT) {
      throw new Error(result);
    }
    if (result !== 'CREATED') throw new Error('CART_CREATE_FAILED');

    return cart;
  }

  async findById(id: string): Promise<Cart | null> {
    const key = this.getKey(id);
    const scripts = this.getLuaScripts();

    const result = await this.redis.eval(scripts.getCart, 1, key, crypto.randomUUID()) as string | null;
    if (!result) {
      return null;
    }

    if (result === CartError.CART_CONFLICT) throw new Error(CartError.CART_CONFLICT);

    const data = JSON.parse(result);
    const cart = this.parseCartData(data, id);
    return cart;
  }

  async update(cart: Cart): Promise<Cart> {
    const key = this.getKey(cart.id);
    const hashData = this.cartToHashData(cart);
    const ttlSeconds = validateCartTtl(this.ttlSeconds);

    const result = await this.redis.eval(this.getLuaScripts().updateCart, 1, key,
      hashData.items, hashData.updated_at, String(hashData.version), String(ttlSeconds), cart.generation || '');
    if (result === CartError.CART_NOT_FOUND || result === CartError.CART_CONFLICT || result === 'INVALID_CART_TTL') throw new Error(result);
    if (result !== 'UPDATED') throw new Error('CART_UPDATE_FAILED');
    return Cart.reconstruct({ ...cart.toJSON(), version: cart.version + 1 });
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
    const snapshot = await this.findById(consumerId);
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
      validateCartTtl(this.ttlSeconds).toString(),
      unitPrice.toString(),
      maxStock.toString(),
      snapshot?.generation || ''
    ) as string;

    if (result === CartError.STOCK_INSUFFICIENT || result === CartError.CART_CONFLICT) {
      throw new Error(result);
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
    const snapshot = await this.findById(consumerId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    const result = await this.redis.eval(
      scripts.updateItemQuantity,
      1,
      key,
      productId,
      quantity.toString(),
      now, // updated_at
      validateCartTtl(this.ttlSeconds).toString(),
      maxStock.toString(),
      snapshot?.generation || ''
    ) as string | null;

    if (!result) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    if (result === CartError.STOCK_INSUFFICIENT || result === CartError.CART_ITEM_NOT_FOUND || result === CartError.CART_CONFLICT) {
      throw new Error(result);
    }

    const data = JSON.parse(result);
    const cart = this.parseCartData({ ...data, version: data.version || 1 }, consumerId);
    return cart;
  }

  async removeItem(consumerId: string, productId: string): Promise<Cart> {
    const key = this.getKey(consumerId);
    const snapshot = await this.findById(consumerId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    const result = await this.redis.eval(
      scripts.removeItem,
      1,
      key,
      productId,
      now, // updated_at
      validateCartTtl(this.ttlSeconds).toString(),
      snapshot?.generation || ''
    ) as string | null;

    if (!result) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    if (result === CartError.CART_ITEM_NOT_FOUND || result === CartError.CART_CONFLICT) {
      throw new Error(result);
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
    const guestSnapshot = await this.findById(guestId);
    const userSnapshot = await this.findById(userId);
    const scripts = this.getLuaScripts();
    const now = new Date().toISOString();

    const result = await this.redis.eval(
      scripts.mergeGuestCart,
      2,
      guestKey,
      userKey,
      validateCartTtl(this.ttlSeconds).toString(),
      now, // updated_at
      JSON.stringify(stockByProduct),
      crypto.randomUUID(),
      guestSnapshot?.generation || '',
      userSnapshot?.generation || ''
    ) as string | number;

    if (result === CartError.STOCK_INSUFFICIENT || result === CartError.CART_CONFLICT) {
      throw new Error(result);
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
