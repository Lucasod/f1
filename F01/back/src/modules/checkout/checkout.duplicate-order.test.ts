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
  let createSession: ReturnType<typeof vi.fn>;

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

    createSession = vi.fn().mockResolvedValue({ id: 'cs_test_session', url: 'https://checkout.stripe.test/session' });
    checkoutService = new CheckoutService(
      orderRepo,
      paymentRepo,
      cartRepo,
      productRepo,
      vendorRepo,
      personRepo,
      cartService,
      config,
      { createSession }
    );

    const freshProduct = Product.reconstruct({ ...validProduct, quantity: 10 });
    freshProduct.id = productId;
    await productRepo.save(freshProduct);
    await vendorRepo.save(validVendor);
    await personRepo.save(Person.reconstruct({ ...validPerson, addresses: [{ ...validAddress }] }));
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

  it('rejects another owned address before payment, provider, stock or order mutation', async () => {
    const person = (await personRepo.findById(consumerId))!;
    person.addresses.push({ ...validAddress, id: 'address-2', street: 'Other Street' });
    await cartService.addItem(consumerId, productId, 2);
    const first = await checkoutService.checkout(consumerId, addressId);
    const orderSave = vi.spyOn(orderRepo, 'save');
    const orderUpdate = vi.spyOn(orderRepo, 'update');
    const orderDelete = vi.spyOn(orderRepo, 'delete');
    const paymentRead = vi.spyOn(paymentRepo, 'findByOrderId');
    const paymentSave = vi.spyOn(paymentRepo, 'save');
    const paymentUpdate = vi.spyOn(paymentRepo, 'update');
    const paymentDelete = vi.spyOn(paymentRepo, 'delete');
    const decrement = vi.spyOn(productRepo, 'decrementStock');
    const increment = vi.spyOn(productRepo, 'incrementStock');
    createSession.mockClear();

    await expect(checkoutService.checkout(consumerId, 'address-2')).rejects.toThrow('PENDING_ORDER_ADDRESS_CONFLICT');
    expect(createSession).not.toHaveBeenCalled();
    expect(paymentRead).not.toHaveBeenCalled();
    expect(paymentSave).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(paymentDelete).not.toHaveBeenCalled();
    expect(orderSave).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(orderDelete).not.toHaveBeenCalled();
    expect(decrement).not.toHaveBeenCalled();
    expect(increment).not.toHaveBeenCalled();
    expect((await orderRepo.findById(first.order.id))?.shippingAddress).toMatchObject(validAddress);
  });

  it.each(['street', 'number', 'neighborhood', 'city', 'state'] as const)(
    'rejects an edited %s even when address id matches', async field => {
      await cartService.addItem(consumerId, productId, 2);
      await checkoutService.checkout(consumerId, addressId);
      const person = (await personRepo.findById(consumerId))!;
      person.addresses[0][field] = 'Changed';
      createSession.mockClear();
      await expect(checkoutService.checkout(consumerId, addressId)).rejects.toThrow('PENDING_ORDER_ADDRESS_CONFLICT');
      expect(createSession).not.toHaveBeenCalled();
    }
  );

  it('rejects an incomplete historical snapshot rather than assuming it matches', async () => {
    await cartService.addItem(consumerId, productId, 2);
    const first = await checkoutService.checkout(consumerId, addressId);
    (first.order.shippingAddress as Partial<typeof first.order.shippingAddress>).city = undefined;
    createSession.mockClear();
    await expect(checkoutService.checkout(consumerId, addressId)).rejects.toThrow('PENDING_ORDER_ADDRESS_CONFLICT');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('ignores a change to the primary-address flag when delivery details are unchanged', async () => {
    await cartService.addItem(consumerId, productId, 2);
    const first = await checkoutService.checkout(consumerId, addressId);
    (await personRepo.findById(consumerId))!.addresses[0].isPrimary = false;
    const second = await checkoutService.checkout(consumerId, addressId);
    expect(second.order.id).toBe(first.order.id);
  });

  it('checks all matching pending orders before reusing any of them', async () => {
    await cartService.addItem(consumerId, productId, 2);
    const first = await checkoutService.checkout(consumerId, addressId);
    const other = Object.assign(Object.create(Object.getPrototypeOf(first.order)), first.order, {
      shippingAddress: { ...first.order.shippingAddress, street: 'Other Street' }
    });
    vi.spyOn(orderRepo, 'findByPersonId').mockResolvedValue([first.order, other]);
    createSession.mockClear();
    await expect(checkoutService.checkout(consumerId, addressId)).rejects.toThrow('PENDING_ORDER_ADDRESS_CONFLICT');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('propagates order lookup failures without accessing payment provider', async () => {
    await cartService.addItem(consumerId, productId, 2);
    vi.spyOn(orderRepo, 'findByPersonId').mockRejectedValue(new Error('lookup failed'));
    await expect(checkoutService.checkout(consumerId, addressId)).rejects.toThrow('lookup failed');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('does not reuse or block on another consumer order for the same cart', async () => {
    const other = Person.reconstruct({ ...validPerson, id: 'consumer-2', addresses: [{ ...validAddress }], contactInfos: [{ ...validPerson.contactInfos[0], value: 'other@example.com' }] });
    await personRepo.save(other);
    await cartService.addItem(consumerId, productId, 2);
    await cartService.addItem(other.id, productId, 2);
    const first = await checkoutService.checkout(consumerId, addressId);
    const second = await checkoutService.checkout(other.id, addressId);
    expect(second.order.id).not.toBe(first.order.id);
    expect(second.order.personId).toBe(other.id);
  });

  it('does not reuse an unrelated owner order even if the repository returns it', async () => {
    const other = Person.reconstruct({ ...validPerson, id: 'consumer-2', addresses: [{ ...validAddress }], contactInfos: [{ ...validPerson.contactInfos[0], value: 'other@example.com' }] });
    await personRepo.save(other);
    await cartService.addItem(other.id, productId, 2);
    const first = await checkoutService.checkout(other.id, addressId);
    await cartService.addItem(consumerId, productId, 2);
    vi.spyOn(orderRepo, 'findByPersonId').mockResolvedValue([first.order]);
    const second = await checkoutService.checkout(consumerId, addressId);
    expect(second.order.personId).toBe(consumerId);
    expect(second.order.id).not.toBe(first.order.id);
  });

  it('rejects an address not owned by the consumer before provider access', async () => {
    await cartService.addItem(consumerId, productId, 2);
    await expect(checkoutService.checkout(consumerId, 'other-person-address')).rejects.toThrow(OrderError.INVALID_SHIPPING_ADDRESS);
    expect(createSession).not.toHaveBeenCalled();
  });
});
