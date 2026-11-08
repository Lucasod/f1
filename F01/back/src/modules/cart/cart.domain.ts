export enum CartError {
  CART_NOT_FOUND = 'CART_NOT_FOUND',
  CART_ALREADY_EXISTS = 'CART_ALREADY_EXISTS',
  CART_CONFLICT = 'CART_CONFLICT',
  CART_ITEM_NOT_FOUND = 'CART_ITEM_NOT_FOUND',
  INVALID_QUANTITY = 'INVALID_QUANTITY',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  STOCK_INSUFFICIENT = 'STOCK_INSUFFICIENT',
  PRODUCT_NOT_AVAILABLE = 'PRODUCT_NOT_AVAILABLE',
  CART_EMPTY = 'CART_EMPTY',
  GUEST_CART_ID_INVALID = 'GUEST_CART_ID_INVALID',
  VENDOR_SELF_ADDITION = 'VENDOR_SELF_ADDITION',
}

export interface CartItem {
  productId: string;
  vendorId: string;
  quantity: number;
  addedAt: Date;
  unitPrice: number;
}

export interface CartData {
  id: string;
  generation?: string;
  items: CartItem[];
  updatedAt: Date;
  version: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

const GUEST_CART_PREFIX = 'guest:';
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateGuestCartId(): string {
  return `${GUEST_CART_PREFIX}${crypto.randomUUID()}`;
}

export function isGuestCartId(id: string): boolean {
  return id.startsWith(GUEST_CART_PREFIX);
}

export function isValidGuestCartId(id: string): boolean {
  if (!isGuestCartId(id)) {
    return false;
  }
  const uuidPart = id.slice(GUEST_CART_PREFIX.length);
  return UUID_V4_REGEX.test(uuidPart);
}

export class Cart {
  public readonly id: string;
  public readonly generation?: string;
  public items: CartItem[];
  public updatedAt: Date;
  public version: number;

  private constructor(data: CartData) {
    this.id = data.id;
    this.generation = data.generation;
    this.items = (data.items || []).map(item => ({ ...item, addedAt: new Date(item.addedAt) }));
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
    this.version = data.version ?? 1;
  }

  static create(consumerId: string): Cart {
    if (!consumerId || consumerId.trim().length === 0) {
      throw new Error('CONSUMER_ID_REQUIRED');
    }
    return new Cart({
      id: consumerId,
      generation: crypto.randomUUID(),
      items: [],
      updatedAt: new Date(),
      version: 1,
    });
  }

  static reconstruct(data: CartData): Cart {
    return new Cart(data);
  }

  addItem(productId: string, vendorId: string, quantity: number, unitPrice: number): void {
    if (!productId || productId.trim().length === 0) {
      throw new Error(CartError.PRODUCT_NOT_FOUND);
    }
    if (!vendorId || vendorId.trim().length === 0) {
      throw new Error(CartError.VENDOR_NOT_FOUND);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(CartError.INVALID_QUANTITY);
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error('INVALID_UNIT_PRICE');
    }

    const existingItem = this.items.find(item => item.productId === productId);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      this.items.push({
        productId,
        vendorId,
        quantity,
        addedAt: new Date(),
        unitPrice,
      });
    }
    this.updateTimestamp();
  }

  updateItemQuantity(productId: string, quantity: number): void {
    if (!productId || productId.trim().length === 0) {
      throw new Error(CartError.PRODUCT_NOT_FOUND);
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error(CartError.INVALID_QUANTITY);
    }

    const itemIndex = this.items.findIndex(item => item.productId === productId);
    if (itemIndex === -1) {
      throw new Error(CartError.CART_ITEM_NOT_FOUND);
    }

    if (quantity === 0) {
      this.items.splice(itemIndex, 1);
    } else {
      this.items[itemIndex].quantity = quantity;
    }
    this.updateTimestamp();
  }

  removeItem(productId: string): void {
    if (!productId || productId.trim().length === 0) {
      throw new Error(CartError.PRODUCT_NOT_FOUND);
    }

    const itemIndex = this.items.findIndex(item => item.productId === productId);
    if (itemIndex === -1) {
      throw new Error(CartError.CART_ITEM_NOT_FOUND);
    }

    this.items.splice(itemIndex, 1);
    this.updateTimestamp();
  }

  getItems(): CartItem[] {
    return [...this.items];
  }

  getItem(productId: string): CartItem | undefined {
    if (!productId || productId.trim().length === 0) {
      return undefined;
    }
    return this.items.find(item => item.productId === productId);
  }

  clear(): void {
    this.items = [];
    this.updateTimestamp();
  }

  mergeGuestCart(guestCartItems: CartItem[]): void {
    if (!guestCartItems || guestCartItems.length === 0) {
      return;
    }

    for (const guestItem of guestCartItems) {
      const existingItem = this.items.find(item => item.productId === guestItem.productId);
      if (existingItem) {
        existingItem.quantity += guestItem.quantity;
      } else {
        this.items.push({
          productId: guestItem.productId,
          vendorId: guestItem.vendorId,
          quantity: guestItem.quantity,
          addedAt: guestItem.addedAt || new Date(),
          unitPrice: guestItem.unitPrice || 0,
        });
      }
    }
    this.incrementVersion();
  }

  incrementVersion(): void {
    this.version += 1;
    this.updateTimestamp();
  }

  updateTimestamp(): void {
    this.updatedAt = new Date();
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get totalItems(): number {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  toJSON(): CartData {
    return {
      id: this.id,
      generation: this.generation,
      items: this.items.map(item => ({ ...item, addedAt: new Date(item.addedAt) })),
      updatedAt: new Date(this.updatedAt),
      version: this.version,
    };
  }
}

export interface CartRepository {
  save(cart: Cart): Promise<Cart>;
  findById(id: string): Promise<Cart | null>;
  update(cart: Cart): Promise<Cart>;
  delete(id: string): Promise<void>;
  addItem(
    cartId: string,
    productId: string,
    vendorId: string,
    quantity: number,
    unitPrice: number,
    maxStock?: number
  ): Promise<Cart>;
  updateItemQuantity(cartId: string, productId: string, quantity: number, maxStock?: number): Promise<Cart>;
  removeItem(cartId: string, productId: string): Promise<Cart>;
  mergeGuestCart(guestId: string, userId: string, stockByProduct?: Record<string, number>): Promise<Cart>;
}

export class InMemoryCartRepository implements CartRepository {
  private carts: Map<string, Cart> = new Map();

  async save(cart: Cart): Promise<Cart> {
    if (this.carts.has(cart.id)) throw new Error(CartError.CART_ALREADY_EXISTS);
    if (!cart.generation || !Number.isSafeInteger(cart.version)) throw new Error(CartError.CART_CONFLICT);
    this.carts.set(cart.id, Cart.reconstruct(cart.toJSON()));
    return Cart.reconstruct(cart.toJSON());
  }

  async findById(id: string): Promise<Cart | null> {
    const cart = this.carts.get(id);
    return cart ? Cart.reconstruct(cart.toJSON()) : null;
  }

  async update(cart: Cart): Promise<Cart> {
    const existing = this.carts.get(cart.id);
    if (!existing) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    if (!existing.generation || !cart.generation || existing.generation !== cart.generation || existing.version !== cart.version) throw new Error(CartError.CART_CONFLICT);
    const updated = Cart.reconstruct(cart.toJSON());
    updated.incrementVersion();
    this.carts.set(cart.id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.carts.delete(id);
  }

  async addItem(
    cartId: string,
    productId: string,
    vendorId: string,
    quantity: number,
    unitPrice: number,
    maxStock = Number.MAX_SAFE_INTEGER
  ): Promise<Cart> {
    let cart = this.carts.get(cartId);
    const isNewCart = !cart;
    if (!cart) {
      cart = Cart.create(cartId);
    }
    if (!cart.generation || !Number.isSafeInteger(cart.version)) throw new Error(CartError.CART_CONFLICT);

    const combinedQuantity = (cart.getItem(productId)?.quantity ?? 0) + quantity;
    if (combinedQuantity > maxStock) {
      throw new Error(CartError.STOCK_INSUFFICIENT);
    }

    cart.addItem(productId, vendorId, quantity, unitPrice);
    if (!isNewCart) {
      cart.incrementVersion();
    }
    this.carts.set(cartId, cart);
    return Cart.reconstruct(cart.toJSON());
  }

  async updateItemQuantity(
    cartId: string,
    productId: string,
    quantity: number,
    maxStock = Number.MAX_SAFE_INTEGER
  ): Promise<Cart> {
    const cart = this.carts.get(cartId);
    if (!cart) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    if (!cart.generation || !Number.isSafeInteger(cart.version)) throw new Error(CartError.CART_CONFLICT);
    if (quantity > maxStock) {
      throw new Error(CartError.STOCK_INSUFFICIENT);
    }

    cart.updateItemQuantity(productId, quantity);
    cart.incrementVersion();
    return Cart.reconstruct(cart.toJSON());
  }

  async removeItem(cartId: string, productId: string): Promise<Cart> {
    const cart = this.carts.get(cartId);
    if (!cart) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    if (!cart.generation || !Number.isSafeInteger(cart.version)) throw new Error(CartError.CART_CONFLICT);
    cart.removeItem(productId);
    cart.incrementVersion();
    return Cart.reconstruct(cart.toJSON());
  }

  async mergeGuestCart(
    guestId: string,
    userId: string,
    stockByProduct: Record<string, number> = {}
  ): Promise<Cart> {
    const guestCart = this.carts.get(guestId);
    let userCart = this.carts.get(userId);

    if (guestCart && (!guestCart.generation || !Number.isSafeInteger(guestCart.version))) throw new Error(CartError.CART_CONFLICT);
    if (userCart && (!userCart.generation || !Number.isSafeInteger(userCart.version))) throw new Error(CartError.CART_CONFLICT);

    if (guestCart && !guestCart.isEmpty) {
      for (const guestItem of guestCart.getItems()) {
        const combinedQuantity = (userCart?.getItem(guestItem.productId)?.quantity ?? 0) + guestItem.quantity;
        const maxStock = stockByProduct[guestItem.productId];
        if (maxStock !== undefined && combinedQuantity > maxStock) {
          throw new Error(CartError.STOCK_INSUFFICIENT);
        }
      }
    }

    if (!userCart) {
      if (guestCart && !guestCart.isEmpty) {
        userCart = Cart.reconstruct({ ...guestCart.toJSON(), id: userId, generation: crypto.randomUUID() });
        this.carts.set(userId, userCart);
        this.carts.delete(guestId);
        return Cart.reconstruct(userCart.toJSON());
      } else {
        userCart = Cart.create(userId);
      }
      this.carts.set(userId, userCart);
    }

    if (guestCart && !guestCart.isEmpty) {
      userCart.mergeGuestCart(guestCart.getItems());
      this.carts.delete(guestId);
    }

    return Cart.reconstruct(userCart.toJSON());
  }

  clear(): void {
    this.carts.clear();
  }
}
