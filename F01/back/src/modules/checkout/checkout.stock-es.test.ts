import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckoutService } from './checkout.service';
import { Cart, InMemoryCartRepository } from '../cart/cart.domain';
import { Product, ProductStatus, InMemoryProductRepository } from '../product/product.domain';
import { Vendor, VendorStatus, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { Person, InMemoryPersonRepository, Address } from '../person/person.domain';
import { Order, OrderStatus, FinancialStatus, Payment, PaymentStatus, OrderError, InMemoryOrderRepository, InMemoryPaymentRepository } from '../order/order.domain';
import { CartService } from '../cart/cart.service';
import { config } from '../../config';

describe('Checkout stock Elasticsearch sync (CR002)', () => {
  let checkoutService: CheckoutService;
  let cartRepo: InMemoryCartRepository;
  let productRepo: InMemoryProductRepository;
  let vendorRepo: InMemoryVendorRepository;
  let personRepo: InMemoryPersonRepository;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let cartService: CartService;
  let searchIndex: { indexProduct: ReturnType<typeof vi.fn> };

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
    mainInfo: { taxIdType: 'CPF', taxIdValue: '12345678901' },
    contactInfos: [{ type: 'email', value: 'test@example.com', isPrimary: true }],
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
    searchIndex = { indexProduct: vi.fn().mockResolvedValue(undefined) };

    checkoutService = new CheckoutService(
      orderRepo,
      paymentRepo,
      cartRepo,
      productRepo,
      vendorRepo,
      personRepo,
      cartService,
      config,
      { createSession: vi.fn().mockResolvedValue({ id: 'cs_test_session', url: 'https://checkout.stripe.test/session' }) },
      undefined,
      searchIndex as any
    );
  });

  it('indexes product after successful decrementStock', async () => {
    const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
    freshProduct.id = productId;
    await productRepo.save(freshProduct);
    await vendorRepo.save(validVendor);
    await personRepo.save(validPerson);
    await cartService.addItem(consumerId, productId, 2);

    await checkoutService.checkout(consumerId, addressId);

    expect(searchIndex.indexProduct).toHaveBeenCalled();
    const calledProduct = searchIndex.indexProduct.mock.calls[0][0];
    expect(calledProduct.id).toBe(productId);
    expect(calledProduct.quantity).toBe(8);
  });

  it('does not fail checkout when ES indexing fails after decrement', async () => {
    searchIndex.indexProduct.mockRejectedValue(new Error('ES_DOWN'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
    freshProduct.id = productId;
    await productRepo.save(freshProduct);
    await vendorRepo.save(validVendor);
    await personRepo.save(validPerson);
    await cartService.addItem(consumerId, productId, 2);

    const result = await checkoutService.checkout(consumerId, addressId);

    expect(result.order).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('indexes product after compensateStock increment on failure path', async () => {
    // Force order save to fail by making productRepo? Instead trigger insufficient stock? 
    // We'll simulate decrement success then order creation failure via missing person? 
    // Simpler: make payment provider fail to trigger compensateStock
    const failingProvider = { createSession: vi.fn().mockRejectedValue(new Error('PROVIDER_FAIL')) };
    checkoutService = new CheckoutService(
      orderRepo,
      paymentRepo,
      cartRepo,
      productRepo,
      vendorRepo,
      personRepo,
      cartService,
      config,
      failingProvider as any,
      undefined,
      searchIndex as any
    );
    searchIndex.indexProduct.mockClear();
    searchIndex.indexProduct.mockResolvedValue(undefined);

    const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
    freshProduct.id = productId;
    await productRepo.save(freshProduct);
    await vendorRepo.save(validVendor);
    await personRepo.save(validPerson);
    await cartService.addItem(consumerId, productId, 2);

    await expect(checkoutService.checkout(consumerId, addressId)).rejects.toThrow();
    // compensateStock calls incrementStock then indexProduct
    expect(searchIndex.indexProduct).toHaveBeenCalled();
  });
});
