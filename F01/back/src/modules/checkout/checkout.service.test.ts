import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckoutService } from './checkout.service';
import { Cart, InMemoryCartRepository } from '../cart/cart.domain';
import { Product, ProductStatus, InMemoryProductRepository } from '../product/product.domain';
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
      config
    );
  });

  describe('checkout', () => {
    beforeEach(async () => {
      await productRepo.save(validProduct);
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
      expect(result.order.financialStatus).toBe(FinancialStatus.PAID);
      expect(result.order.vendorGroups).toHaveLength(1);
      expect(result.order.totalAmount).toBe(200); // 2 * 100
      expect(result.clientSecret).toBe('mock_client_secret_for_testing');

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
      expect(payments[0].providerTransactionId).toBe('mock_intent_123');

      // Verify cart is cleared
      const cart = await cartRepo.findById(consumerId);
      expect(cart!.isEmpty).toBe(true);
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