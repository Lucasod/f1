import {
  Cart,
  CartItem,
  CartError,
  CartRepository,
  generateGuestCartId,
  isValidGuestCartId,
  isGuestCartId
} from './cart.domain';
import { ProductRepository } from '../product/product.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { config } from '../../config';

export class CartService {
  private readonly cartRepo: CartRepository;
  private readonly productRepo: ProductRepository;
  private readonly vendorRepo: VendorRepository;

  constructor(
    cartRepo: CartRepository,
    productRepo: ProductRepository,
    vendorRepo: VendorRepository,
    _config: typeof config
  ) {
    this.cartRepo = cartRepo;
    this.productRepo = productRepo;
    this.vendorRepo = vendorRepo;
  }

  async addItem(consumerId: string, productId: string, quantity: number): Promise<Cart> {
    // Validate quantity
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(CartError.INVALID_QUANTITY);
    }

    // Validate product exists
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(CartError.PRODUCT_NOT_FOUND);
    }

    if (!product.isAvailable) {
      throw new Error(CartError.PRODUCT_NOT_AVAILABLE);
    }

    // Get vendorId from product
    const vendorId = product.vendorId;

    // Check if current user is a vendor trying to add their own product to the cart
    // (CD-059: Vendor self-addition prevention)
    // A vendor cannot add products from their own store to the cart
    // If the current user has an associated vendor record and the product
    // belongs to their own store, block the operation
    // If the user has no vendor record (consumer or admin), allow the operation
    const personVendor = await this.vendorRepo.findByPersonId(consumerId);
    if (personVendor && product.vendorId === personVendor.id) {
      throw new Error(CartError.VENDOR_SELF_ADDITION);
    }

    // Validate vendor exists

    // Validate vendor exists
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new Error(CartError.VENDOR_NOT_FOUND);
    }

    // Ensure cart exists - auto-create if missing (consistent with repository and getCart)
    let cart = await this.cartRepo.findById(consumerId);
    if (!cart) {
      cart = Cart.create(consumerId);
      await this.cartRepo.save(cart);
    }

    return this.cartRepo.addItem(
      consumerId,
      productId,
      vendorId,
      quantity,
      product.price,
      product.quantity
    );
  }

  async updateItemQuantity(consumerId: string, productId: string, quantity: number): Promise<Cart> {
    // Validate quantity
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error(CartError.INVALID_QUANTITY);
    }

    let maxStock = Number.MAX_SAFE_INTEGER;
    if (quantity > 0) {
      const product = await this.productRepo.findById(productId);
      if (!product) {
        throw new Error(CartError.PRODUCT_NOT_FOUND);
      }

      if (!product.isAvailable) {
        throw new Error(CartError.PRODUCT_NOT_AVAILABLE);
      }

      maxStock = product.quantity;
    }

    return this.cartRepo.updateItemQuantity(consumerId, productId, quantity, maxStock);
  }

  async removeItem(consumerId: string, productId: string): Promise<Cart> {
    return this.cartRepo.removeItem(consumerId, productId);
  }

  async getCart(consumerId: string): Promise<Cart> {
    // Validate guest cart ID format if it's a guest cart
    if (isGuestCartId(consumerId) && !isValidGuestCartId(consumerId)) {
      throw new Error(CartError.GUEST_CART_ID_INVALID);
    }
    
    let cart = await this.cartRepo.findById(consumerId);
    if (!cart) {
      cart = Cart.create(consumerId);
    }
    return cart;
  }

  async mergeGuestCart(guestId: string, userId: string): Promise<Cart> {
    const guestCart = await this.cartRepo.findById(guestId);
    if (!guestCart || guestCart.isEmpty) {
      return this.getCart(userId);
    }

    const userCart = await this.cartRepo.findById(userId);
    const stockByProduct: Record<string, number> = {};
    for (const guestItem of guestCart.getItems()) {
      const product = await this.productRepo.findById(guestItem.productId);
      if (!product) {
        throw new Error(CartError.PRODUCT_NOT_FOUND);
      }
      if (!product.isAvailable) {
        throw new Error(CartError.PRODUCT_NOT_AVAILABLE);
      }

      const currentQuantity = userCart?.getItem(guestItem.productId)?.quantity ?? 0;
      if (currentQuantity + guestItem.quantity > product.quantity) {
        throw new Error(CartError.STOCK_INSUFFICIENT);
      }
      stockByProduct[guestItem.productId] = product.quantity;
    }

    return this.cartRepo.mergeGuestCart(guestId, userId, stockByProduct);
  }

  async clearCart(consumerId: string): Promise<void> {
    const cart = await this.cartRepo.findById(consumerId);
    if (cart) {
      cart.clear();
      await this.cartRepo.update(cart);
    }
  }

  async getOrCreateGuestCart(guestId?: string): Promise<Cart> {
    let resolvedGuestId: string;

    if (guestId !== undefined && guestId !== null) {
      if (guestId == null || guestId.trim().length === 0 || !isGuestCartId(guestId) || !isValidGuestCartId(guestId)) {
        throw new Error(CartError.GUEST_CART_ID_INVALID);
      }
      resolvedGuestId = guestId;
    } else {
      resolvedGuestId = generateGuestCartId();
    }

    let cart = await this.cartRepo.findById(resolvedGuestId);
    if (!cart) {
      cart = Cart.create(resolvedGuestId);
      try {
        await this.cartRepo.save(cart);
      } catch (saveError) {
        // If save fails (e.g., duplicate key race), retry findById
        const existingCart = await this.cartRepo.findById(resolvedGuestId);
        if (existingCart) {
          return existingCart;
        }
        // If still not found, re-throw the original error
        throw saveError;
      }
    }
    return cart;
  }
}