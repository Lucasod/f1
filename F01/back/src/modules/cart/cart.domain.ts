export enum CartError {
  CART_NOT_FOUND = 'CART_NOT_FOUND',
  CART_ITEM_NOT_FOUND = 'CART_ITEM_NOT_FOUND',
  INVALID_QUANTITY = 'INVALID_QUANTITY',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  STOCK_INSUFFICIENT = 'STOCK_INSUFFICIENT',
  CART_EMPTY = 'CART_EMPTY',
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
  items: CartItem[];
  updatedAt: Date;
  version: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export class Cart {
  public readonly id: string;
  public items: CartItem[];
  public updatedAt: Date;
  public version: number;

  private constructor(data: CartData) {
    this.id = data.id;
    this.items = data.items || [];
    this.updatedAt = data.updatedAt || new Date();
    this.version = data.version || 1;
  }

  static create(consumerId: string): Cart {
    if (!consumerId || consumerId.trim().length === 0) {
      throw new Error('CONSUMER_ID_REQUIRED');
    }
    return new Cart({
      id: consumerId,
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
    this.updateTimestamp();
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
      items: this.items.map(item => ({ ...item })),
      updatedAt: this.updatedAt,
      version: this.version,
    };
  }
}

export interface CartRepository {
  save(cart: Cart): Promise<Cart>;
  findById(id: string): Promise<Cart | null>;
  update(cart: Cart): Promise<Cart>;
  delete(id: string): Promise<void>;
}

export class InMemoryCartRepository implements CartRepository {
  private carts: Map<string, Cart> = new Map();

  async save(cart: Cart): Promise<Cart> {
    this.carts.set(cart.id, cart);
    return cart;
  }

  async findById(id: string): Promise<Cart | null> {
    return this.carts.get(id) || null;
  }

  async update(cart: Cart): Promise<Cart> {
    const existing = this.carts.get(cart.id);
    if (!existing) {
      throw new Error(CartError.CART_NOT_FOUND);
    }
    this.carts.set(cart.id, cart);
    return cart;
  }

  async delete(id: string): Promise<void> {
    this.carts.delete(id);
  }

  clear(): void {
    this.carts.clear();
  }
}