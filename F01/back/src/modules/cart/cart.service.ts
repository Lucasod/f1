import {
  Cart,
  CartItem,
  CartError,
  CartRepository
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

    // Validate stock sufficient
    if (product.quantity < quantity) {
      throw new Error(CartError.STOCK_INSUFFICIENT);
    }

    // Get vendorId from product
    const vendorId = product.vendorId;

    // Validate vendor exists
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new Error(CartError.VENDOR_NOT_FOUND);
    }

    // Get or create cart
    let cart = await this.cartRepo.findById(consumerId);
    const isNewCart = !cart;
    if (isNewCart) {
      cart = Cart.create(consumerId);
    }

    // Add item to cart
    cart!.addItem(productId, vendorId, quantity, product.price);

    // Save cart: use save() for new carts, update() for existing carts
    return isNewCart ? this.cartRepo.save(cart!) : this.cartRepo.update(cart!);
  }

  async updateItemQuantity(consumerId: string, productId: string, quantity: number): Promise<Cart> {
    // Validate quantity
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error(CartError.INVALID_QUANTITY);
    }

    // If quantity > 0, validate product exists and stock
    if (quantity > 0) {
      const product = await this.productRepo.findById(productId);
      if (!product) {
        throw new Error(CartError.PRODUCT_NOT_FOUND);
      }

      if (product.quantity < quantity) {
        throw new Error(CartError.STOCK_INSUFFICIENT);
      }
    }

    // Get cart
    const cart = await this.cartRepo.findById(consumerId);
    if (!cart) {
      throw new Error(CartError.CART_NOT_FOUND);
    }

    // Update item quantity
    cart.updateItemQuantity(productId, quantity);

    // Save cart
    return this.cartRepo.update(cart);
  }

  async removeItem(consumerId: string, productId: string): Promise<Cart> {
    // Get cart
    const cart = await this.cartRepo.findById(consumerId);
    if (!cart) {
      throw new Error(CartError.CART_NOT_FOUND);
    }

    // Remove item from cart
    cart.removeItem(productId);

    // Save cart
    return this.cartRepo.update(cart);
  }

  async getCart(consumerId: string): Promise<Cart> {
    let cart = await this.cartRepo.findById(consumerId);
    if (!cart) {
      cart = Cart.create(consumerId);
      await this.cartRepo.save(cart);
    }
    return cart;
  }

  async mergeGuestCart(guestId: string, userId: string): Promise<Cart> {
    // Get guest cart
    const guestCart = await this.cartRepo.findById(guestId);
    if (!guestCart || guestCart.isEmpty) {
      // No guest cart to merge, get or create user cart
      return this.getCart(userId);
    }

    // Get or create user cart
    let userCart = await this.cartRepo.findById(userId);
    const isNewUserCart = !userCart;
    if (isNewUserCart) {
      userCart = Cart.create(userId);
    }

    // Merge guest cart items into user cart
    userCart!.mergeGuestCart(guestCart.getItems());

    // Save user cart: use save() for new carts, update() for existing carts
    await (isNewUserCart ? this.cartRepo.save(userCart!) : this.cartRepo.update(userCart!));

    // Delete guest cart
    await this.cartRepo.delete(guestId);

    return userCart!;
  }

  async clearCart(consumerId: string): Promise<void> {
    const cart = await this.cartRepo.findById(consumerId);
    if (cart) {
      cart.clear();
      await this.cartRepo.update(cart);
    }
  }
}