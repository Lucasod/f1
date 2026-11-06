import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckoutService } from './checkout.service';
import { Cart, InMemoryCartRepository } from '../cart/cart.domain';
import { Product, ProductStatus, InMemoryProductRepository } from '../product/product.domain';
import { Vendor, VendorStatus, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Person, InMemoryPersonRepository, Address } from '../person/person.domain';
import { Order, OrderStatus, FinancialStatus, Payment, PaymentStatus, OrderError, InMemoryOrderRepository, InMemoryPaymentRepository } from '../order/order.domain';
import { CartService } from '../cart/cart.service';
import { config } from '../../config';

describe('Checkout duplicate order prevention', () => {
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

  beforeEach(async () => {
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

    const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
    freshProduct.id = productId;
    await productRepo.save(freshProduct);
    await vendorRepo.save(validVendor);
    await personRepo.save(validPerson);
  });

  it('should reuse existing pending order for the same cart', async () => {
    await cartService.addItem(consumerId, productId, 2);

    const first = await checkoutService.checkout(consumerId, addressId);
    expect(first.order).toBeDefined();

    // Second checkout reuses the same pending order instead of creating a duplicate
    const second = await checkoutService.checkout(consumerId, addressId);
    expect(second.order).toBeDefined();
    expect(second.order.id).toBe(first.order.id);
  });
});