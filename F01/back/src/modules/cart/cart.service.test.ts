import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CartService } from './cart.service';
import { Cart, CartError, InMemoryCartRepository, CartItem, generateGuestCartId, isValidGuestCartId } from './cart.domain';
import { Product, ProductStatus, InMemoryProductRepository } from '../product/product.domain';
import { Vendor, VendorStatus, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { config } from '../../config';

describe('Cart Service', () => {
  let cartRepo: InMemoryCartRepository;
  let productRepo: InMemoryProductRepository;
  let vendorRepo: InMemoryVendorRepository;
  let cartService: CartService;
  let mockProductRepo: { findById: ReturnType<typeof vi.fn> };
  let mockVendorRepo: { findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cartRepo = new InMemoryCartRepository();
    productRepo = new InMemoryProductRepository();
    vendorRepo = new InMemoryVendorRepository();

    // Create mock repositories for product and vendor to control test scenarios
    mockProductRepo = {
      findById: vi.fn(),
    };
    mockVendorRepo = {
      findById: vi.fn(),
    };

    cartService = new CartService(
      cartRepo,
      mockProductRepo as any,
      mockVendorRepo as any,
      config
    );
  });

  describe('addItem', () => {
    const consumerId = 'consumer-1';
    const productId = 'product-1';
    const vendorId = 'vendor-1';
    const quantity = 2;
    const price = 100;

    const validProduct = Product.create({
      vendorId,
      categoryId: 'category-1',
      name: 'Test Product',
      description: 'Test Description',
      price,
      quantity: 10,
      status: ProductStatus.ACTIVE,
    });
    validProduct.id = productId;

    const validVendor = Vendor.create({
      personId: 'person-1',
      storeName: 'Test Store',
      slug: 'test-store',
      commissionPct: 10,
    });
    validVendor.id = vendorId;

    it('should add item to cart successfully', async () => {
      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      const cart = await cartService.addItem(consumerId, productId, quantity);

      expect(cart).toBeDefined();
      expect(cart.id).toBe(consumerId);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].productId).toBe(productId);
      expect(cart.items[0].vendorId).toBe(vendorId);
      expect(cart.items[0].quantity).toBe(quantity);
      expect(cart.items[0].unitPrice).toBe(price);
    });

    it('should create new cart if none exists', async () => {
      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      const cart = await cartService.addItem(consumerId, productId, quantity);

      expect(cart.id).toBe(consumerId);
      expect(cart.totalItems).toBe(quantity);
    });

    it('should add item to existing cart', async () => {
      // Pre-create cart with an item
      const existingCart = Cart.create(consumerId);
      existingCart.addItem('product-2', 'vendor-2', 1, 50);
      await cartRepo.save(existingCart);

      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      const cart = await cartService.addItem(consumerId, productId, quantity);

      expect(cart.items).toHaveLength(2);
      expect(cart.totalItems).toBe(3); // 1 + 2
    });

    it('should increment quantity if product already in cart', async () => {
      // Pre-create cart with same product
      const existingCart = Cart.create(consumerId);
      existingCart.addItem(productId, vendorId, 1, price);
      await cartRepo.save(existingCart);

      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      const cart = await cartService.addItem(consumerId, productId, quantity);

      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].quantity).toBe(3); // 1 + 2
    });

    it('should reject additions that would exceed available stock', async () => {
      const existingCart = Cart.create(consumerId);
      existingCart.addItem(productId, vendorId, 9, price);
      await cartRepo.save(existingCart);

      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.addItem(consumerId, productId, 2))
        .rejects.toThrow(CartError.STOCK_INSUFFICIENT);
    });

    it('should throw PRODUCT_NOT_FOUND when product does not exist', async () => {
      mockProductRepo.findById.mockResolvedValue(null);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.addItem(consumerId, productId, quantity))
        .rejects.toThrow(CartError.PRODUCT_NOT_FOUND);
    });

    it('should throw STOCK_INSUFFICIENT when product quantity is less than requested', async () => {
      const lowStockProduct = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Low Stock Product',
        description: 'Test Description',
        price,
        quantity: 1, // Less than requested quantity (2)
        status: ProductStatus.ACTIVE,
      });
      lowStockProduct.id = productId;

      mockProductRepo.findById.mockResolvedValue(lowStockProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.addItem(consumerId, productId, quantity))
        .rejects.toThrow(CartError.STOCK_INSUFFICIENT);
    });

    it('should throw INVALID_QUANTITY when quantity is not a positive integer', async () => {
      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.addItem(consumerId, productId, 0))
        .rejects.toThrow(CartError.INVALID_QUANTITY);

      await expect(cartService.addItem(consumerId, productId, -1))
        .rejects.toThrow(CartError.INVALID_QUANTITY);

      await expect(cartService.addItem(consumerId, productId, 1.5))
        .rejects.toThrow(CartError.INVALID_QUANTITY);
    });

    it('should throw VENDOR_NOT_FOUND when vendor does not exist', async () => {
      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(null);

      await expect(cartService.addItem(consumerId, productId, quantity))
        .rejects.toThrow(CartError.VENDOR_NOT_FOUND);
    });
  });

  describe('updateItemQuantity', () => {
    const consumerId = 'consumer-1';
    const productId = 'product-1';
    const vendorId = 'vendor-1';
    const price = 100;

    const validProduct = Product.create({
      vendorId,
      categoryId: 'category-1',
      name: 'Test Product',
      description: 'Test Description',
      price,
      quantity: 10,
      status: ProductStatus.ACTIVE,
    });
    validProduct.id = productId;

    const validVendor = Vendor.create({
      personId: 'person-1',
      storeName: 'Test Store',
      slug: 'test-store',
      commissionPct: 10,
    });
    validVendor.id = vendorId;

    it('should update item quantity successfully', async () => {
      // Pre-create cart with item
      const cart = Cart.create(consumerId);
      cart.addItem(productId, vendorId, 1, price);
      await cartRepo.save(cart);

      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      const updatedCart = await cartService.updateItemQuantity(consumerId, productId, 5);

      expect(updatedCart.items[0].quantity).toBe(5);
    });

    it('should remove item when quantity is set to 0', async () => {
      // Pre-create cart with item
      const cart = Cart.create(consumerId);
      cart.addItem(productId, vendorId, 1, price);
      await cartRepo.save(cart);

      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      const updatedCart = await cartService.updateItemQuantity(consumerId, productId, 0);

      expect(updatedCart.items).toHaveLength(0);
    });

    it('should validate stock when quantity > 0', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem(productId, vendorId, 1, price);
      await cartRepo.save(cart);

      const lowStockProduct = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Low Stock Product',
        description: 'Test Description',
        price,
        quantity: 3, // Less than requested 5
        status: ProductStatus.ACTIVE,
      });
      lowStockProduct.id = productId;

      mockProductRepo.findById.mockResolvedValue(lowStockProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.updateItemQuantity(consumerId, productId, 5))
        .rejects.toThrow(CartError.STOCK_INSUFFICIENT);
    });

    it('should throw PRODUCT_NOT_FOUND when product does not exist (quantity > 0)', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem(productId, vendorId, 1, price);
      await cartRepo.save(cart);

      mockProductRepo.findById.mockResolvedValue(null);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.updateItemQuantity(consumerId, productId, 5))
        .rejects.toThrow(CartError.PRODUCT_NOT_FOUND);
    });

    it('should throw INVALID_QUANTITY when quantity is negative', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem(productId, vendorId, 1, price);
      await cartRepo.save(cart);

      await expect(cartService.updateItemQuantity(consumerId, productId, -1))
        .rejects.toThrow(CartError.INVALID_QUANTITY);
    });

    it('should throw CART_NOT_FOUND when cart does not exist', async () => {
      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.updateItemQuantity('non-existent-consumer', productId, 5))
        .rejects.toThrow(CartError.CART_NOT_FOUND);
    });

    it('should throw CART_ITEM_NOT_FOUND when item not in cart', async () => {
      const cart = Cart.create(consumerId);
      await cartRepo.save(cart);

      mockProductRepo.findById.mockResolvedValue(validProduct);
      mockVendorRepo.findById.mockResolvedValue(validVendor);

      await expect(cartService.updateItemQuantity(consumerId, productId, 5))
        .rejects.toThrow(CartError.CART_ITEM_NOT_FOUND);
    });
  });

  describe('removeItem', () => {
    const consumerId = 'consumer-1';
    const productId = 'product-1';
    const vendorId = 'vendor-1';
    const price = 100;

    it('should remove item from cart successfully', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem(productId, vendorId, 2, price);
      await cartRepo.save(cart);

      const updatedCart = await cartService.removeItem(consumerId, productId);

      expect(updatedCart.items).toHaveLength(0);
    });

    it('should throw CART_NOT_FOUND when cart does not exist', async () => {
      await expect(cartService.removeItem('non-existent-consumer', productId))
        .rejects.toThrow(CartError.CART_NOT_FOUND);
    });

    it('should throw CART_ITEM_NOT_FOUND when item not in cart', async () => {
      const cart = Cart.create(consumerId);
      await cartRepo.save(cart);

      await expect(cartService.removeItem(consumerId, productId))
        .rejects.toThrow(CartError.CART_ITEM_NOT_FOUND);
    });
  });

  describe('getCart', () => {
    const consumerId = 'consumer-1';

    it('should return existing cart', async () => {
      const existingCart = Cart.create(consumerId);
      existingCart.addItem('product-1', 'vendor-1', 2, 100);
      await cartRepo.save(existingCart);

      const cart = await cartService.getCart(consumerId);

      expect(cart.id).toBe(consumerId);
      expect(cart.items).toHaveLength(1);
    });

    it('should create and return empty cart if none exists', async () => {
      const cart = await cartService.getCart(consumerId);

      expect(cart).toBeDefined();
      expect(cart.id).toBe(consumerId);
      expect(cart.isEmpty).toBe(true);
      expect(cart.totalItems).toBe(0);
    });

    it('should persist the newly created empty cart', async () => {
      await cartService.getCart(consumerId);

      const savedCart = await cartRepo.findById(consumerId);
      expect(savedCart).not.toBeNull();
      expect(savedCart!.isEmpty).toBe(true);
    });
  });

  describe('mergeGuestCart', () => {
    const guestId = 'guest-1';
    const userId = 'user-1';
    const vendorId = 'vendor-1';
    const price = 100;

    beforeEach(() => {
      mockProductRepo.findById.mockImplementation(async (id: string) => {
        const product = Product.create({
          vendorId,
          categoryId: 'category-1',
          name: 'Test Product',
          description: 'Test Description',
          price,
          quantity: 20,
          status: ProductStatus.ACTIVE,
        });
        product.id = id;
        return product;
      });
    });

    it('should merge guest cart into user cart', async () => {
      // Create guest cart with items
      const guestCart = Cart.create(guestId);
      guestCart.addItem('product-1', vendorId, 2, price);
      guestCart.addItem('product-2', vendorId, 1, 50);
      await cartRepo.save(guestCart);

      // Create user cart with one overlapping item
      const userCart = Cart.create(userId);
      userCart.addItem('product-1', vendorId, 1, price);
      await cartRepo.save(userCart);

      const mergedCart = await cartService.mergeGuestCart(guestId, userId);

      expect(mergedCart.id).toBe(userId);
      expect(mergedCart.items).toHaveLength(2);
      // product-1 quantities merged: 1 + 2 = 3
      expect(mergedCart.getItem('product-1')!.quantity).toBe(3);
      expect(mergedCart.getItem('product-2')!.quantity).toBe(1);
      expect(mergedCart.totalItems).toBe(4);
    });

    it('should create user cart if none exists', async () => {
      const guestCart = Cart.create(guestId);
      guestCart.addItem('product-1', vendorId, 2, price);
      await cartRepo.save(guestCart);

      const mergedCart = await cartService.mergeGuestCart(guestId, userId);

      expect(mergedCart.id).toBe(userId);
      expect(mergedCart.items).toHaveLength(1);
      expect(mergedCart.getItem('product-1')!.quantity).toBe(2);
    });

    it('should handle empty guest cart (return user cart)', async () => {
      const userCart = Cart.create(userId);
      userCart.addItem('product-1', vendorId, 1, price);
      await cartRepo.save(userCart);

      const mergedCart = await cartService.mergeGuestCart(guestId, userId);

      expect(mergedCart.id).toBe(userId);
      expect(mergedCart.items).toHaveLength(1);
    });

    it('should return empty user cart when guest cart is empty and user cart does not exist', async () => {
      const emptyGuestCart = Cart.create(guestId);
      await cartRepo.save(emptyGuestCart);

      const mergedCart = await cartService.mergeGuestCart(guestId, userId);

      expect(mergedCart.id).toBe(userId);
      expect(mergedCart.isEmpty).toBe(true);
    });

    it('should delete guest cart after merge', async () => {
      const guestCart = Cart.create(guestId);
      guestCart.addItem('product-1', vendorId, 2, price);
      await cartRepo.save(guestCart);

      await cartService.mergeGuestCart(guestId, userId);

      const deletedGuestCart = await cartRepo.findById(guestId);
      expect(deletedGuestCart).toBeNull();
    });

    it('should preserve vendorId and unitPrice from guest cart items', async () => {
      const guestCart = Cart.create(guestId);
      guestCart.addItem('product-1', vendorId, 2, price);
      guestCart.addItem('product-2', 'vendor-2', 1, 200);
      await cartRepo.save(guestCart);

      const mergedCart = await cartService.mergeGuestCart(guestId, userId);

      expect(mergedCart.getItem('product-1')!.vendorId).toBe(vendorId);
      expect(mergedCart.getItem('product-1')!.unitPrice).toBe(price);
      expect(mergedCart.getItem('product-2')!.vendorId).toBe('vendor-2');
      expect(mergedCart.getItem('product-2')!.unitPrice).toBe(200);
    });

    it('should reject a merge that exceeds current stock without changing either cart', async () => {
      const guestCart = Cart.create(guestId);
      guestCart.addItem('product-1', vendorId, 2, price);
      await cartRepo.save(guestCart);

      const userCart = Cart.create(userId);
      userCart.addItem('product-1', vendorId, 1, price);
      await cartRepo.save(userCart);

      const lowStockProduct = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Low Stock Product',
        description: 'Test Description',
        price,
        quantity: 2,
        status: ProductStatus.ACTIVE,
      });
      lowStockProduct.id = 'product-1';
      mockProductRepo.findById.mockResolvedValue(lowStockProduct);

      await expect(cartService.mergeGuestCart(guestId, userId))
        .rejects.toThrow(CartError.STOCK_INSUFFICIENT);

      expect((await cartRepo.findById(guestId))?.getItem('product-1')?.quantity).toBe(2);
      expect((await cartRepo.findById(userId))?.getItem('product-1')?.quantity).toBe(1);
    });

    it('rechecks the combined quantity atomically if the user cart changes during merge', async () => {
      const guestCart = Cart.create(guestId);
      guestCart.addItem('product-1', vendorId, 2, price);
      await cartRepo.save(guestCart);

      const userCart = Cart.create(userId);
      userCart.addItem('product-1', vendorId, 1, price);
      await cartRepo.save(userCart);

      const merge = cartRepo.mergeGuestCart.bind(cartRepo);
      vi.spyOn(cartRepo, 'mergeGuestCart').mockImplementation(async (sourceId, destinationId, stockByProduct) => {
        await cartRepo.addItem(destinationId, 'product-1', vendorId, 1, price);
        return merge(sourceId, destinationId, stockByProduct);
      });

      const lowStockProduct = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Low Stock Product',
        description: 'Test Description',
        price,
        quantity: 3,
        status: ProductStatus.ACTIVE,
      });
      lowStockProduct.id = 'product-1';
      mockProductRepo.findById.mockResolvedValue(lowStockProduct);

      await expect(cartService.mergeGuestCart(guestId, userId))
        .rejects.toThrow(CartError.STOCK_INSUFFICIENT);

      expect((await cartRepo.findById(guestId))?.getItem('product-1')?.quantity).toBe(2);
      expect((await cartRepo.findById(userId))?.getItem('product-1')?.quantity).toBe(2);
    });

    it('should merge a guest cart only once when two login requests race', async () => {
      const guestCart = Cart.create(guestId);
      guestCart.addItem('product-1', vendorId, 2, price);
      await cartRepo.save(guestCart);

      const userCart = Cart.create(userId);
      userCart.addItem('product-1', vendorId, 1, price);
      await cartRepo.save(userCart);

      await Promise.all([
        cartService.mergeGuestCart(guestId, userId),
        cartService.mergeGuestCart(guestId, userId),
      ]);

      expect((await cartRepo.findById(userId))?.getItem('product-1')?.quantity).toBe(3);
    });
  });

  describe('clearCart', () => {
    const consumerId = 'consumer-1';
    const vendorId = 'vendor-1';
    const price = 100;

    it('should clear cart items', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem('product-1', vendorId, 2, price);
      cart.addItem('product-2', vendorId, 1, 50);
      await cartRepo.save(cart);

      await cartService.clearCart(consumerId);

      const clearedCart = await cartRepo.findById(consumerId);
      expect(clearedCart).not.toBeNull();
      expect(clearedCart!.isEmpty).toBe(true);
      expect(clearedCart!.totalItems).toBe(0);
    });

    it('should do nothing if cart does not exist', async () => {
      // Should not throw
      await expect(cartService.clearCart('non-existent-consumer'))
        .resolves.toBeUndefined();
    });

    it('should update cart timestamp', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem('product-1', vendorId, 2, price);
      const originalUpdatedAt = cart.updatedAt;
      await cartRepo.save(cart);

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      await cartService.clearCart(consumerId);

      const clearedCart = await cartRepo.findById(consumerId);
      expect(clearedCart!.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('getOrCreateGuestCart', () => {
    it('should create new guest cart when no ID provided', async () => {
      const cart = await cartService.getOrCreateGuestCart();

      expect(cart).toBeDefined();
      expect(cart.id).toMatch(/^guest:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(cart.isEmpty).toBe(true);
      expect(cart.totalItems).toBe(0);
    });

    it('should create new guest cart when valid ID provided', async () => {
      const guestId = generateGuestCartId();
      const cart = await cartService.getOrCreateGuestCart(guestId);

      expect(cart).toBeDefined();
      expect(cart.id).toBe(guestId);
      expect(cart.isEmpty).toBe(true);
    });

    it('should return existing guest cart when valid ID provided', async () => {
      const guestId = generateGuestCartId();
      const existingCart = Cart.create(guestId);
      existingCart.addItem('product-1', 'vendor-1', 2, 100);
      await cartRepo.save(existingCart);

      const cart = await cartService.getOrCreateGuestCart(guestId);

      expect(cart.id).toBe(guestId);
      expect(cart.items).toHaveLength(1);
      expect(cart.totalItems).toBe(2);
    });

    it('should throw GUEST_CART_ID_INVALID when invalid guest ID format provided', async () => {
      await expect(cartService.getOrCreateGuestCart('invalid-id'))
        .rejects.toThrow(CartError.GUEST_CART_ID_INVALID);

      await expect(cartService.getOrCreateGuestCart('guest:not-a-uuid'))
        .rejects.toThrow(CartError.GUEST_CART_ID_INVALID);

      await expect(cartService.getOrCreateGuestCart('user:12345678-1234-4123-8123-123456789abc'))
        .rejects.toThrow(CartError.GUEST_CART_ID_INVALID);
    });

    it('should throw GUEST_CART_ID_INVALID when empty string provided', async () => {
      await expect(cartService.getOrCreateGuestCart(''))
        .rejects.toThrow(CartError.GUEST_CART_ID_INVALID);
    });

    it('should persist newly created guest cart', async () => {
      const cart = await cartService.getOrCreateGuestCart();

      const savedCart = await cartRepo.findById(cart.id);
      expect(savedCart).not.toBeNull();
      expect(savedCart!.isEmpty).toBe(true);
    });
  });
});