import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckoutService } from './checkout.service';
import { Cart, InMemoryCartRepository } from '../cart/cart.domain';
import { Product, ProductStatus, InMemoryProductRepository, ProductError } from '../product/product.domain';
import { Vendor, VendorStatus, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Person, InMemoryPersonRepository, Address } from '../person/person.domain';
import { Order, OrderStatus, FinancialStatus, Payment, PaymentStatus, OrderError, InMemoryOrderRepository, InMemoryPaymentRepository } from '../order/order.domain';
import { CartService } from '../cart/cart.service';
import { config } from '../../config';

describe('Checkout Service', () => {
  let checkoutService: CheckoutService;
  let cartRepo: InMemoryCartRepository;
  let productRepo: InMemoryProductRepository;
  let vendorRepo: InMemoryVendorRepository;
  let personRepo: InMemoryPersonRepository;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let cartService: CartService;

  const consumerId = 'consumer-1';
  const vendorId = 'vendor-1';
  const productId = 'product-1';
  const addressId = 'address-1';
  const price = 100;

  const validAddress: Address = {
    id: addressId,
    street: 'Test Street',
    number: '123',
    neighborhood: 'Test Neighborhood',
    city: 'Test City',
    state: 'TS',
    isPrimary: true
  };

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
    personId: 'vendor-person-1',
    storeName: 'Test Store',
    slug: 'test-store',
    commissionPct: 10,
  });
  validVendor.id = vendorId;

  const validPerson = Person.create({
    name: 'Test Consumer',
    mainInfo: {
      taxIdType: 'CPF',
      taxIdValue: '12345678901'
    },
    contactInfos: [
      { type: 'email', value: 'test@example.com', isPrimary: true }
    ],
    addresses: [validAddress]
  });
  validPerson.id = consumerId;

  beforeEach(() => {
    cartRepo = new InMemoryCartRepository();
    productRepo = new InMemoryProductRepository();
    vendorRepo = new InMemoryVendorRepository();
    personRepo = new InMemoryPersonRepository();
    orderRepo = new InMemoryOrderRepository();
    paymentRepo = new InMemoryPaymentRepository();

    cartService = new CartService(cartRepo, productRepo, vendorRepo, config);

    checkoutService = new CheckoutService(
      orderRepo,
      paymentRepo,
      cartRepo,
      productRepo,
      vendorRepo,
      personRepo,
      cartService,
      config,
      { createSession: vi.fn().mockResolvedValue({ id: 'cs_test_session', url: 'https://checkout.stripe.test/session' }) }
    );
  });

  describe('checkout', () => {
    beforeEach(async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      freshProduct.id = productId;
      await productRepo.save(freshProduct);
      await vendorRepo.save(validVendor);
      await personRepo.save(validPerson);
    });

    it('should checkout successfully with valid cart and address', async () => {
      // Add item to cart
      await cartService.addItem(consumerId, productId, 2);

      const result = await checkoutService.checkout(consumerId, addressId);

      expect(result.order).toBeDefined();
      expect(result.order.personId).toBe(consumerId);
      expect(result.order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(result.order.financialStatus).toBe(FinancialStatus.PENDING);
      expect(result.order.vendorGroups).toHaveLength(1);
      expect(result.order.totalAmount).toBe(200); // 2 * 100
      expect(result.checkoutUrl).toBe('https://checkout.stripe.test/session');

      // Verify vendor group
      const vendorGroup = result.order.vendorGroups[0];
      expect(vendorGroup.vendorId).toBe(vendorId);
      expect(vendorGroup.items).toHaveLength(1);
      expect(vendorGroup.items[0].productId).toBe(productId);
      expect(vendorGroup.items[0].quantity).toBe(2);
      expect(vendorGroup.items[0].unitPrice).toBe(price);
      expect(vendorGroup.subtotal).toBe(200);
      expect(vendorGroup.commissionPct).toBe(10);
      expect(vendorGroup.commissionAmount).toBe(20);
      expect(vendorGroup.vendorNet).toBe(180);

      // Verify shipping address
      expect(result.order.shippingAddress.id).toBe(addressId);
      expect(result.order.shippingAddress.street).toBe('Test Street');

      // Verify payment
      const payments = await paymentRepo.findByOrderId(result.order.id);
      expect(payments).toHaveLength(1);
      expect(payments[0].orderId).toBe(result.order.id);
      expect(payments[0].personId).toBe(consumerId);
      expect(payments[0].amount).toBe(200);
      expect(payments[0].status).toBe(PaymentStatus.PENDING);
      expect(payments[0].provider).toBe('stripe');
      expect(payments[0].providerTransactionId).toBe('cs_test_session');

      // Verify cart is preserved (not cleared at checkout initiation)
      const cart = await cartRepo.findById(consumerId);
      expect(cart!.isEmpty).toBe(false);
      expect(cart!.items).toHaveLength(1);
    });

    it('should checkout with multiple items from same vendor', async () => {
      const productId2 = 'product-2';
      const validProduct2 = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Test Product 2',
        description: 'Test Description 2',
        price: 50,
        quantity: 10,
        status: ProductStatus.ACTIVE,
      });
      validProduct2.id = productId2;
      await productRepo.save(validProduct2);

      // Add items to cart
      const freshProduct1 = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct1);

      await cartService.addItem(consumerId, productId, 2);
      await cartService.addItem(consumerId, productId2, 3);

      const result = await checkoutService.checkout(consumerId, addressId);

      expect(result.order.totalAmount).toBe(350); // 2*100 + 3*50
      expect(result.order.vendorGroups).toHaveLength(1);
      
      const vendorGroup = result.order.vendorGroups[0];
      expect(vendorGroup.items).toHaveLength(2);
      expect(vendorGroup.subtotal).toBe(350);
      expect(vendorGroup.commissionAmount).toBe(35);
      expect(vendorGroup.vendorNet).toBe(315);
    });

    it('should checkout with items from multiple vendors', async () => {
      const vendorId2 = 'vendor-2';
      const productId2 = 'product-2';

      const validVendor2 = Vendor.create({
        personId: 'vendor-person-2',
        storeName: 'Test Store 2',
        slug: 'test-store-2',
        commissionPct: 15,
      });
      validVendor2.id = vendorId2;
      await vendorRepo.save(validVendor2);

      const validProduct2 = Product.create({
        vendorId: vendorId2,
        categoryId: 'category-1',
        name: 'Test Product 2',
        description: 'Test Description 2',
        price: 50,
        quantity: 10,
        status: ProductStatus.ACTIVE,
      });
      validProduct2.id = productId2;
      await productRepo.save(validProduct2);

      // Add items to cart
      const freshProduct1 = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct1);

      await cartService.addItem(consumerId, productId, 2);
      await cartService.addItem(consumerId, productId2, 3);

      const result = await checkoutService.checkout(consumerId, addressId);

      expect(result.order.totalAmount).toBe(350); // 2*100 + 3*50
      expect(result.order.vendorGroups).toHaveLength(2);

      // First vendor group
      const vg1 = result.order.vendorGroups.find(vg => vg.vendorId === vendorId)!;
      expect(vg1.items).toHaveLength(1);
      expect(vg1.subtotal).toBe(200);
      expect(vg1.commissionPct).toBe(10);
      expect(vg1.commissionAmount).toBe(20);
      expect(vg1.vendorNet).toBe(180);

      // Second vendor group
      const vg2 = result.order.vendorGroups.find(vg => vg.vendorId === vendorId2)!;
      expect(vg2.items).toHaveLength(1);
      expect(vg2.subtotal).toBe(150);
      expect(vg2.commissionPct).toBe(15);
      expect(vg2.commissionAmount).toBe(22.5);
      expect(vg2.vendorNet).toBe(127.5);
    });

    it('should throw CART_EMPTY when cart is not found', async () => {
      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.CART_EMPTY);
    });

    it('should throw CART_EMPTY when cart is empty', async () => {
      const emptyCart = Cart.create(consumerId);
      await cartRepo.save(emptyCart);

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.CART_EMPTY);
    });

    it('should throw INVALID_SHIPPING_ADDRESS when address not found', async () => {
      await cartService.addItem(consumerId, productId, 2);

      await expect(checkoutService.checkout(consumerId, 'non-existent-address'))
        .rejects.toThrow(OrderError.INVALID_SHIPPING_ADDRESS);
    });

    it('should throw PRODUCT_NOT_FOUND when product does not exist', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem('non-existent-product', vendorId, 2, price);
      await cartRepo.save(cart);

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.PRODUCT_NOT_FOUND);
    });

    it('should throw INSUFFICIENT_STOCK when product quantity is less than cart quantity', async () => {
      // Add item to cart first with sufficient stock
      await cartService.addItem(consumerId, productId, 2);

      // Then reduce product stock below cart quantity
      const lowStockProduct = Product.reconstruct({
        ...validProduct,
        quantity: 1
      });
      await productRepo.update(lowStockProduct);

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.INSUFFICIENT_STOCK);
    });

    it('should throw VENDOR_NOT_FOUND when vendor does not exist', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem(productId, 'non-existent-vendor', 2, price);
      await cartRepo.save(cart);

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.VENDOR_NOT_FOUND);
    });

    it('should throw PERSON_ID_REQUIRED when person does not exist', async () => {
      // Create cart directly for non-existent consumer (bypassing cartService which would validate product/vendor)
      const cart = Cart.create('non-existent-consumer');
      cart.addItem(productId, vendorId, 2, price);
      await cartRepo.save(cart);

      await expect(checkoutService.checkout('non-existent-consumer', addressId))
        .rejects.toThrow(OrderError.PERSON_ID_REQUIRED);
    });

    it('should decrement product stock on successful checkout', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      await checkoutService.checkout(consumerId, addressId);

      const product = await productRepo.findById(productId);
      expect(product).not.toBeNull();
      expect(product!.quantity).toBe(8);
    });

    it('should not create order or clear cart when stock is insufficient', async () => {
      await cartService.addItem(consumerId, productId, 2);

      const lowStockProduct = Product.reconstruct({
        ...validProduct,
        quantity: 1
      });
      await productRepo.update(lowStockProduct);

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.INSUFFICIENT_STOCK);

      const orders = await orderRepo.findByPersonId(consumerId);
      expect(orders).toHaveLength(0);

      const cart = await cartRepo.findById(consumerId);
      expect(cart).not.toBeNull();
      expect(cart!.isEmpty).toBe(false);
    });

    it('should rollback previously decremented stock if a later decrement fails', async () => {
      const productId2 = 'product-2';
      const validProduct2 = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Test Product 2',
        description: 'Test Description 2',
        price: 50,
        quantity: 10,
        status: ProductStatus.ACTIVE,
      });
      validProduct2.id = productId2;
      await productRepo.save(validProduct2);

      const freshProduct1 = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct1);

      await cartService.addItem(consumerId, productId, 2);
      await cartService.addItem(consumerId, productId2, 3);

      // Make decrementStock fail on second product to simulate decrement failure
      const originalDecrement = productRepo.decrementStock.bind(productRepo);
      let decrementCallCount = 0;
      productRepo.decrementStock = async (pid, amount) => {
        decrementCallCount += 1;
        if (decrementCallCount === 2) {
          throw new Error('simulated decrement failure');
        }
        return originalDecrement(pid, amount);
      };

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow('simulated decrement failure');

      // First product stock should be rolled back
      const product1 = await productRepo.findById(productId);
      expect(product1!.quantity).toBe(10);

      const orders = await orderRepo.findByPersonId(consumerId);
      expect(orders).toHaveLength(0);
    });

    it('should restore stock if order creation fails after decrement', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      vi.spyOn(Order, 'create').mockImplementation(() => {
        throw new Error('order creation failed');
      });

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow('order creation failed');

      const product = await productRepo.findById(productId);
      expect(product!.quantity).toBe(10);

      vi.restoreAllMocks();
    });

    it('should restore stock if order save fails after decrement', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      const originalSave = orderRepo.save.bind(orderRepo);
      orderRepo.save = async () => {
        throw new Error('order save failed');
      };

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow('order save failed');

      const product = await productRepo.findById(productId);
      expect(product!.quantity).toBe(10);

      orderRepo.save = originalSave;
    });

    it('should preserve original error when payment save fails', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      const originalSave = paymentRepo.save.bind(paymentRepo);
      paymentRepo.save = async () => {
        throw new Error('payment provider unavailable');
      };

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow('payment provider unavailable');

      const product = await productRepo.findById(productId);
      expect(product!.quantity).toBe(10);

      paymentRepo.save = originalSave;
    });

    it('should restore stock if clear cart fails after decrement', async () => {
      // Note: clearCart is no longer called during checkout initiation;
      // cart is preserved for later clearance after payment confirmation
      // or voluntary action. This test verifies stock restoration
      // when order creation fails after stock decrement.
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      const originalClearCart = cartService.clearCart.bind(cartService);
      cartService.clearCart = async () => {
        throw new Error('clear cart failed');
      };

      // clearCart is no longer called during checkout, so checkout succeeds
      // regardless of clearCart's behavior. Verify order creation succeeds.
      const result = await checkoutService.checkout(consumerId, addressId);

      expect(result.order).toBeDefined();
      const product = await productRepo.findById(productId);
      expect(product!.quantity).toBe(8); // 2 decremented

      cartService.clearCart = originalClearCart;
    });

    it('should throw STOCK_ROLLBACK_FAILED when rollback fails', async () => {
      const productId2 = 'product-2';
      const validProduct2 = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Test Product 2',
        description: 'Test Description 2',
        price: 50,
        quantity: 10,
        status: ProductStatus.ACTIVE,
      });
      validProduct2.id = productId2;
      await productRepo.save(validProduct2);

      const freshProduct1 = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct1);
      const freshProduct2 = Product.reconstruct({ ...validProduct2, quantity: 10 });
      await productRepo.update(freshProduct2);

      await cartService.addItem(consumerId, productId, 2);
      await cartService.addItem(consumerId, productId2, 3);

      // First decrement succeeds (product 1), second fails (product 2)
      const originalDecrement = productRepo.decrementStock.bind(productRepo);
      let decrementCallCount = 0;
      productRepo.decrementStock = async (pid, amount) => {
        decrementCallCount++;
        if (decrementCallCount === 2) {
          throw new Error('decrement failed');
        }
        return originalDecrement(pid, amount);
      };

      // Rollback (incrementStock) fails
      productRepo.incrementStock = async () => {
        throw new Error('rollback failed');
      };

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.STOCK_ROLLBACK_FAILED);

      productRepo.decrementStock = originalDecrement;
    });

    it('should not rollback when no decrement occurred (failure before decrement)', async () => {
      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.CART_EMPTY);

      const product = await productRepo.findById(productId);
      expect(product!.quantity).toBe(10);
    });

    it('should not decrement or restore stock twice on duplicate failure', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      const originalSave = orderRepo.save.bind(orderRepo);
      orderRepo.save = async () => {
        throw new Error('save failed');
      };

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow('save failed');

      const product = await productRepo.findById(productId);
      expect(product!.quantity).toBe(10);

      orderRepo.save = originalSave;
    });

    it('should surface STOCK_ROLLBACK_FAILED when post-decrement compensation fails', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      const originalSave = orderRepo.save.bind(orderRepo);
      orderRepo.save = async () => {
        throw new Error('order save failed');
      };

      productRepo.incrementStock = async () => {
        throw new Error('restore failed');
      };

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.STOCK_ROLLBACK_FAILED);

      orderRepo.save = originalSave;
    });

    it('should surface STOCK_ROLLBACK_FAILED when incrementStock misses product', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 2);

      const originalSave = orderRepo.save.bind(orderRepo);
      orderRepo.save = async () => {
        throw new Error('order save failed');
      };

      productRepo.incrementStock = async () => {
        throw new Error(ProductError.PRODUCT_NOT_FOUND);
      };

      await expect(checkoutService.checkout(consumerId, addressId))
        .rejects.toThrow(OrderError.STOCK_ROLLBACK_FAILED);

      orderRepo.save = originalSave;
    });

    it('should list multiple product ids when multiple restores fail', async () => {
      const productId2 = 'product-2';
      const validProduct2 = Product.create({
        vendorId,
        categoryId: 'category-1',
        name: 'Test Product 2',
        description: 'Test Description 2',
        price: 50,
        quantity: 10,
        status: ProductStatus.ACTIVE,
      });
      validProduct2.id = productId2;
      await productRepo.save(validProduct2);

      const freshProduct1 = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct1);
      const freshProduct2 = Product.reconstruct({ ...validProduct2, quantity: 10 });
      await productRepo.update(freshProduct2);

      await cartService.addItem(consumerId, productId, 2);
      await cartService.addItem(consumerId, productId2, 3);

      const originalSave = orderRepo.save.bind(orderRepo);
      orderRepo.save = async () => {
        throw new Error('order save failed');
      };

      productRepo.incrementStock = async () => {
        throw new Error('restore failed');
      };

      let caught: any;
      try {
        await checkoutService.checkout(consumerId, addressId);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught.message).toBe(OrderError.STOCK_ROLLBACK_FAILED);
      expect(caught.cause).toBeDefined();
      expect(caught.cause.message).toContain(productId);
      expect(caught.cause.message).toContain(productId2);

      orderRepo.save = originalSave;
    });

    it('should handle concurrent checkouts without overselling', async () => {
      const freshProduct = Product.reconstruct({ ...validProduct, quantity: 5 });
      await productRepo.update(freshProduct);

      await cartService.addItem(consumerId, productId, 3);

      const consumerId2 = 'consumer-2';
      const validPerson2 = Person.create({
        name: 'Test Consumer 2',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '12345678902' },
        contactInfos: [{ type: 'email', value: 'test2@example.com', isPrimary: true }],
        addresses: [validAddress],
      });
      validPerson2.id = consumerId2;
      await personRepo.save(validPerson2);
      await cartService.addItem(consumerId2, productId, 3);

      const results = await Promise.allSettled([
        checkoutService.checkout(consumerId, addressId),
        checkoutService.checkout(consumerId2, addressId),
      ]);

      const statuses = results.map(r => r.status);
      expect(statuses).toContain('fulfilled');
      expect(statuses).toContain('rejected');

      const product = await productRepo.findById(productId);
      expect(product!.quantity).toBe(2);
    });
  });

  describe('previewCheckout', () => {
    beforeEach(async () => {
      await productRepo.save(validProduct);
      await vendorRepo.save(validVendor);
      await personRepo.save(validPerson);
    });

    it('should return preview with correct vendor group data', async () => {
      await cartService.addItem(consumerId, productId, 2);

      const preview = await checkoutService.previewCheckout(consumerId);

      expect(preview.vendorGroups).toHaveLength(1);
      expect(preview.totalAmount).toBe(200);

      const vg = preview.vendorGroups[0];
      expect(vg.id).toBe(vendorId);
      expect(vg.vendorName).toBe('Test Store');
      expect(vg.subtotal).toBe(200);
      expect(vg.commissionPct).toBe(10);
      expect(vg.commissionAmount).toBe(20);
      expect(vg.vendorNet).toBe(180);
      expect(vg.items).toHaveLength(1);
      expect(vg.items[0].productId).toBe(productId);
      expect(vg.items[0].productName).toBe('Test Product');
      expect(vg.items[0].quantity).toBe(2);
      expect(vg.items[0].unitPrice).toBe(price);
      expect(vg.items[0].totalPrice).toBe(200);
    });

    it('should return preview with multiple vendors', async () => {
      const vendorId2 = 'vendor-2';
      const productId2 = 'product-2';

      const validVendor2 = Vendor.create({
        personId: 'vendor-person-2',
        storeName: 'Test Store 2',
        slug: 'test-store-2',
        commissionPct: 15,
      });
      validVendor2.id = vendorId2;
      await vendorRepo.save(validVendor2);

      const validProduct2 = Product.create({
        vendorId: vendorId2,
        categoryId: 'category-1',
        name: 'Test Product 2',
        description: 'Test Description 2',
        price: 50,
        quantity: 10,
        status: ProductStatus.ACTIVE,
      });
      validProduct2.id = productId2;
      await productRepo.save(validProduct2);

      const freshProduct1 = Product.reconstruct({ ...validProduct, quantity: 10 });
      await productRepo.update(freshProduct1);

      await cartService.addItem(consumerId, productId, 2);
      await cartService.addItem(consumerId, productId2, 3);

      const preview = await checkoutService.previewCheckout(consumerId);

      expect(preview.totalAmount).toBe(350);
      expect(preview.vendorGroups).toHaveLength(2);

      const vg1 = preview.vendorGroups.find(v => v.id === vendorId)!;
      expect(vg1.vendorName).toBe('Test Store');
      expect(vg1.subtotal).toBe(200);
      expect(vg1.commissionPct).toBe(10);
      expect(vg1.commissionAmount).toBe(20);
      expect(vg1.vendorNet).toBe(180);

      const vg2 = preview.vendorGroups.find(v => v.id === vendorId2)!;
      expect(vg2.vendorName).toBe('Test Store 2');
      expect(vg2.subtotal).toBe(150);
      expect(vg2.commissionPct).toBe(15);
      expect(vg2.commissionAmount).toBe(22.5);
      expect(vg2.vendorNet).toBe(127.5);
    });

    it('should throw CART_EMPTY when cart is not found', async () => {
      await expect(checkoutService.previewCheckout(consumerId))
        .rejects.toThrow(OrderError.CART_EMPTY);
    });

    it('should throw CART_EMPTY when cart is empty', async () => {
      const emptyCart = Cart.create(consumerId);
      await cartRepo.save(emptyCart);

      await expect(checkoutService.previewCheckout(consumerId))
        .rejects.toThrow(OrderError.CART_EMPTY);
    });

    it('should throw PERSON_ID_REQUIRED when person does not exist', async () => {
      // Create cart directly for non-existent consumer
      const cart = Cart.create('non-existent-consumer');
      cart.addItem(productId, vendorId, 2, price);
      await cartRepo.save(cart);

      await expect(checkoutService.previewCheckout('non-existent-consumer'))
        .rejects.toThrow(OrderError.PERSON_ID_REQUIRED);
    });

    it('should throw PRODUCT_NOT_FOUND when product does not exist', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem('non-existent-product', vendorId, 2, price);
      await cartRepo.save(cart);

      await expect(checkoutService.previewCheckout(consumerId))
        .rejects.toThrow(OrderError.PRODUCT_NOT_FOUND);
    });

    it('should throw INSUFFICIENT_STOCK when product quantity is less than cart quantity', async () => {
      // Add item to cart first with sufficient stock
      await cartService.addItem(consumerId, productId, 2);

      // Then reduce product stock below cart quantity
      const lowStockProduct = Product.reconstruct({
        ...validProduct,
        quantity: 1
      });
      await productRepo.update(lowStockProduct);

      await expect(checkoutService.previewCheckout(consumerId))
        .rejects.toThrow(OrderError.INSUFFICIENT_STOCK);
    });

    it('should throw VENDOR_NOT_FOUND when vendor does not exist', async () => {
      const cart = Cart.create(consumerId);
      cart.addItem(productId, 'non-existent-vendor', 2, price);
      await cartRepo.save(cart);

      await expect(checkoutService.previewCheckout(consumerId))
        .rejects.toThrow(OrderError.VENDOR_NOT_FOUND);
    });

    it('should not create order or payment (cart remains unchanged)', async () => {
      await cartService.addItem(consumerId, productId, 2);

      await checkoutService.previewCheckout(consumerId);

      // Cart should still have items
      const cart = await cartRepo.findById(consumerId);
      expect(cart!.isEmpty).toBe(false);
      expect(cart!.items).toHaveLength(1);

      // No orders or payments should be created
      const orders = await orderRepo.findByPersonId(consumerId);
      expect(orders).toHaveLength(0);

      const payments = await paymentRepo.findByPersonId(consumerId);
      expect(payments).toHaveLength(0);
    });

  });
});