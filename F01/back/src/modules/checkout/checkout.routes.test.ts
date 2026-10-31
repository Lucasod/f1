import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemoryPersonRepository, Person, Address } from '../person/person.domain';
import { InMemoryCartRepository, Cart } from '../cart/cart.domain';
import { InMemoryProductRepository, Product, ProductStatus } from '../product/product.domain';
import { InMemoryVendorRepository, Vendor } from '../vendor/vendor.domain';
import { InMemoryOrderRepository } from '../order/order.domain';
import { InMemoryPaymentRepository } from '../order/order.domain';
import { AuthService } from '../auth/auth.service';
import { CartService } from '../cart/cart.service';
import { CheckoutService } from './checkout.service';
import { createCheckoutRoutes } from './checkout.routes';
import { createAuthRoutes } from '../auth/auth.routes';
import { createVendorRoutes } from '../vendor/vendor.routes';
import { PersonRole } from '../person/person.domain';
import { config } from '../../config';
import { hashPassword } from '../auth/credential.domain';
import { OrderError } from '../order/order.domain';

// Valid test CPF/CNPJ values (these pass validation)
const VALID_CPF_1 = '52998224725';
const VALID_CPF_2 = '98765432100';
const VALID_CNPJ_1 = '11222333000181';
const VALID_CNPJ_2 = '04252011000110';

describe('Checkout Routes', () => {
  let app: express.Express;
  let personRepo: InMemoryPersonRepository;
  let cartRepo: InMemoryCartRepository;
  let productRepo: InMemoryProductRepository;
  let vendorRepo: InMemoryVendorRepository;
  let orderRepo: InMemoryOrderRepository;
  let paymentRepo: InMemoryPaymentRepository;
  let authService: AuthService;
  let cartService: CartService;
  let checkoutService: CheckoutService;
  const testPassword = 'SecurePass123!';

  // Test data IDs
  let consumerId: string;
  let vendorPersonId: string;
  let vendorId: string;
  let productId: string;
  let productId2: string;
  let addressId: string;
  let addressId2: string;
  let consumerToken: string;
  let vendorToken: string;
  let adminToken: string;

  beforeEach(async () => {
    // Initialize repositories
    personRepo = new InMemoryPersonRepository();
    cartRepo = new InMemoryCartRepository();
    productRepo = new InMemoryProductRepository();
    vendorRepo = new InMemoryVendorRepository();
    orderRepo = new InMemoryOrderRepository();
    paymentRepo = new InMemoryPaymentRepository();

    // Initialize services
    authService = new AuthService(personRepo, 'test-secret-key', '24h', '30d');
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

    // Create Express app
    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRoutes({ authService }));
    app.use('/api/v1/vendor', createVendorRoutes({
      authService,
      vendorService: new (await import('../vendor/vendor.service')).VendorService(vendorRepo, personRepo, config),
      personRepo
    }));
    app.use('/api/v1/checkout', createCheckoutRoutes({
      authService,
      checkoutService,
      personRepo
    }));

    // Create admin user directly in repository (bypassing register API which rejects ADMIN)
    const adminPerson = Person.create({
      name: 'Admin User',
      mainInfo: { name: 'Admin User', taxIdType: 'CPF', taxIdValue: VALID_CPF_2 },
      contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
      addresses: []
    });
    adminPerson.addRole(PersonRole.ADMIN);
    adminPerson.setCredential(await hashPassword(testPassword));
    await personRepo.save(adminPerson);

    // Login to get admin token
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@example.com',
        password: testPassword
      });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.tokens.accessToken;

    // Register a consumer
    const consumerRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Test Consumer',
        taxIdType: 'CPF',
        taxIdValue: VALID_CPF_1,
        email: 'consumer@example.com',
        password: testPassword,
        role: PersonRole.CONSUMER
      });
    expect(consumerRegister.status).toBe(201);
    consumerToken = consumerRegister.body.tokens.accessToken;
    consumerId = consumerRegister.body.person.id;

    // Register a vendor person
    const vendorRegister = await request(app)
      .post('/api/v1/auth/register')
      .send({
        name: 'Test Vendor',
        taxIdType: 'CNPJ',
        taxIdValue: VALID_CNPJ_1,
        email: 'vendor@example.com',
        password: testPassword,
        role: PersonRole.VENDOR
      });
    expect(vendorRegister.status).toBe(201);
    vendorToken = vendorRegister.body.tokens.accessToken;
    vendorPersonId = vendorRegister.body.person.id;

    // Login vendor again to get fresh token with VENDOR role
    const vendorLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'vendor@example.com',
        password: testPassword
      });
    expect(vendorLogin.status).toBe(200);
    vendorToken = vendorLogin.body.tokens.accessToken;

    // Onboard vendor
    const vendorOnboard = await request(app)
      .post('/api/v1/vendor/onboard')
      .set('Authorization', `Bearer ${vendorToken}`)
      .send({
        storeName: 'Test Store',
        slug: 'test-store'
      });
    expect(vendorOnboard.status).toBe(201);
    vendorId = vendorOnboard.body.vendor.id;

    // Login vendor again to get fresh token with VENDOR role (onboarding adds VENDOR role)
    const vendorLoginAfterOnboard = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'vendor@example.com',
        password: testPassword
      });
    expect(vendorLoginAfterOnboard.status).toBe(200);
    vendorToken = vendorLoginAfterOnboard.body.tokens.accessToken;

    // Create test products
    const product = Product.create({
      vendorId,
      categoryId: 'category-1',
      name: 'Test Product',
      description: 'Test Description',
      price: 100,
      quantity: 10,
      status: ProductStatus.ACTIVE,
    });
    productId = product.id;
    await productRepo.save(product);

    const product2 = Product.create({
      vendorId,
      categoryId: 'category-1',
      name: 'Test Product 2',
      description: 'Test Description 2',
      price: 50,
      quantity: 5,
      status: ProductStatus.ACTIVE,
    });
    productId2 = product2.id;
    await productRepo.save(product2);

    // Add addresses to consumer
    const address1: Address = {
      id: 'address-1',
      street: 'Main Street',
      number: '123',
      neighborhood: 'Downtown',
      city: 'Test City',
      state: 'TS',
      isPrimary: true
    };
    const address2: Address = {
      id: 'address-2',
      street: 'Second Street',
      number: '456',
      neighborhood: 'Uptown',
      city: 'Test City',
      state: 'TS',
      isPrimary: false
    };
    addressId = address1.id;
    addressId2 = address2.id;

    const consumer = await personRepo.findById(consumerId);
    consumer!.addresses.push(address1, address2);
    await personRepo.save(consumer!);
  });

  // Helper to add item to cart
  const addToCart = async (consumerId: string, productId: string, quantity: number) => {
    return cartService.addItem(consumerId, productId, quantity);
  };

  describe('GET /api/v1/checkout/preview', () => {
    describe('Success cases', () => {
      it('should return checkout preview with items from cart', async () => {
        // Add item to cart
        await addToCart(consumerId, productId, 2);

        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(200);
        expect(response.body.preview).toBeDefined();
        expect(response.body.preview.vendorGroups).toHaveLength(1);
        expect(response.body.preview.totalAmount).toBe(200); // 2 * 100

        const vg = response.body.preview.vendorGroups[0];
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
        expect(vg.items[0].unitPrice).toBe(100);
        expect(vg.items[0].totalPrice).toBe(200);
      });

      it('should return preview with multiple items from same vendor', async () => {
        await addToCart(consumerId, productId, 2);
        await addToCart(consumerId, productId2, 3);

        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(200);
        expect(response.body.preview.totalAmount).toBe(350); // 2*100 + 3*50
        expect(response.body.preview.vendorGroups).toHaveLength(1);

        const vg = response.body.preview.vendorGroups[0];
        expect(vg.items).toHaveLength(2);
        expect(vg.subtotal).toBe(350);
        expect(vg.commissionAmount).toBe(35);
        expect(vg.vendorNet).toBe(315);
      });

      it('should return preview with items from multiple vendors', async () => {
        // Create second vendor
        const vendor2Person = Person.create({
          name: 'Vendor 2',
          mainInfo: { name: 'Vendor 2', taxIdType: 'CNPJ', taxIdValue: VALID_CNPJ_2 },
          contactInfos: [{ type: 'email', value: 'vendor2@example.com', isPrimary: true }],
          addresses: []
        });
        vendor2Person.addRole(PersonRole.VENDOR);
        await personRepo.save(vendor2Person);

        const vendor2 = Vendor.create({
          personId: vendor2Person.id,
          storeName: 'Test Store 2',
          slug: 'test-store-2',
          commissionPct: 15,
        });
        await vendorRepo.save(vendor2);

        const product3 = Product.create({
          vendorId: vendor2.id,
          categoryId: 'category-1',
          name: 'Test Product 3',
          description: 'Test Description 3',
          price: 75,
          quantity: 10,
          status: ProductStatus.ACTIVE,
        });
        await productRepo.save(product3);

        await addToCart(consumerId, productId, 2);
        await addToCart(consumerId, product3.id, 1);

        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(200);
        expect(response.body.preview.totalAmount).toBe(275); // 2*100 + 1*75
        expect(response.body.preview.vendorGroups).toHaveLength(2);

        const vg1 = response.body.preview.vendorGroups.find((v: any) => v.id === vendorId);
        expect(vg1.subtotal).toBe(200);
        expect(vg1.commissionPct).toBe(10);
        expect(vg1.vendorName).toBe('Test Store');

        const vg2 = response.body.preview.vendorGroups.find((v: any) => v.id === vendor2.id);
        expect(vg2.subtotal).toBe(75);
        expect(vg2.commissionPct).toBe(15);
        expect(vg2.vendorName).toBe('Test Store 2');
      });

      it('should not modify cart after preview', async () => {
        await addToCart(consumerId, productId, 2);

        await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        // Cart should still have items
        const cart = await cartRepo.findById(consumerId);
        expect(cart!.isEmpty).toBe(false);
        expect(cart!.items).toHaveLength(1);
      });
    });

    describe('Error cases', () => {
      it('should return 400 for empty cart', async () => {
        // Cart doesn't exist or is empty
        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(400);
        expect(response.body.error).toBe(OrderError.CART_EMPTY);
        expect(response.body.message).toBe('Cart is empty');
      });

      it('should return 400 when cart exists but is empty', async () => {
        // Create empty cart
        const emptyCart = Cart.create(consumerId);
        await cartRepo.save(emptyCart);

        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(400);
        expect(response.body.error).toBe(OrderError.CART_EMPTY);
      });

      it('should return 401 for missing auth token', async () => {
        const response = await request(app)
          .get('/api/v1/checkout/preview');

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('MISSING_TOKEN');
      });

      it('should return 401 for invalid auth token', async () => {
        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', 'Bearer invalid-token');

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('INVALID_TOKEN');
      });

      it('should return 403 for ADMIN role (requires CONSUMER)', async () => {
        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('FORBIDDEN');
      });

      it('should return 404 for product not found in cart', async () => {
        // Create cart directly with non-existent product
        const cart = Cart.create(consumerId);
        cart.addItem('non-existent-product', vendorId, 2, 100);
        await cartRepo.save(cart);

        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(404);
        expect(response.body.error).toBe(OrderError.PRODUCT_NOT_FOUND);
      });

      it('should return 409 for insufficient stock', async () => {
        // Add item to cart with sufficient stock
        await addToCart(consumerId, productId, 2);

        // Reduce product stock below cart quantity
        const lowStockProduct = Product.reconstruct({
          ...(await productRepo.findById(productId))!,
          quantity: 1
        });
        await productRepo.update(lowStockProduct);

        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(409);
        expect(response.body.error).toBe(OrderError.INSUFFICIENT_STOCK);
      });

      it('should return 404 for vendor not found', async () => {
        // Create cart directly with non-existent vendor
        const cart = Cart.create(consumerId);
        cart.addItem(productId, 'non-existent-vendor', 2, 100);
        await cartRepo.save(cart);

        const response = await request(app)
          .get('/api/v1/checkout/preview')
          .set('Authorization', `Bearer ${consumerToken}`);

        expect(response.status).toBe(404);
        expect(response.body.error).toBe(OrderError.VENDOR_NOT_FOUND);
      });
    });
  });

  describe('POST /api/v1/checkout', () => {
    describe('Success cases', () => {
      it('should create order from cart and return order + clientSecret, clear cart', async () => {
        await addToCart(consumerId, productId, 2);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(201);
        expect(response.body.order).toBeDefined();
        expect(response.body.clientSecret).toBe('mock_client_secret_for_testing');

        const order = response.body.order;
        expect(order.personId).toBe(consumerId);
        expect(order.status).toBe('pending_payment');
        expect(order.financialStatus).toBe('paid');
        expect(order.totalAmount).toBe(200);
        expect(order.vendorGroups).toHaveLength(1);
        expect(order.vendorGroups[0].vendorId).toBe(vendorId);
        expect(order.vendorGroups[0].items).toHaveLength(1);
        expect(order.vendorGroups[0].items[0].productId).toBe(productId);
        expect(order.vendorGroups[0].items[0].quantity).toBe(2);
        expect(order.vendorGroups[0].subtotal).toBe(200);
        expect(order.vendorGroups[0].commissionPct).toBe(10);
        expect(order.vendorGroups[0].commissionAmount).toBe(20);
        expect(order.vendorGroups[0].vendorNet).toBe(180);
        expect(order.shippingAddress.id).toBe(addressId);
        expect(order.shippingAddress.street).toBe('Main Street');

        // Verify cart is cleared
        const cart = await cartRepo.findById(consumerId);
        expect(cart!.isEmpty).toBe(true);

        // Verify payment was created
        const payments = await paymentRepo.findByOrderId(order.id);
        expect(payments).toHaveLength(1);
        expect(payments[0].orderId).toBe(order.id);
        expect(payments[0].personId).toBe(consumerId);
        expect(payments[0].amount).toBe(200);
        expect(payments[0].status).toBe('pending');
        expect(payments[0].provider).toBe('stripe');
      });

      it('should create order with multiple items from same vendor', async () => {
        await addToCart(consumerId, productId, 2);
        await addToCart(consumerId, productId2, 3);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(201);
        expect(response.body.order.totalAmount).toBe(350);
        expect(response.body.order.vendorGroups).toHaveLength(1);
        expect(response.body.order.vendorGroups[0].items).toHaveLength(2);
        expect(response.body.order.vendorGroups[0].subtotal).toBe(350);
      });

      it('should create order with items from multiple vendors', async () => {
        // Create second vendor
        const vendor2Person = Person.create({
          name: 'Vendor 2',
          mainInfo: { name: 'Vendor 2', taxIdType: 'CNPJ', taxIdValue: VALID_CNPJ_2 },
          contactInfos: [{ type: 'email', value: 'vendor2@example.com', isPrimary: true }],
          addresses: []
        });
        vendor2Person.addRole(PersonRole.VENDOR);
        await personRepo.save(vendor2Person);

        const vendor2 = Vendor.create({
          personId: vendor2Person.id,
          storeName: 'Test Store 2',
          slug: 'test-store-2',
          commissionPct: 15,
        });
        await vendorRepo.save(vendor2);

        const product3 = Product.create({
          vendorId: vendor2.id,
          categoryId: 'category-1',
          name: 'Test Product 3',
          description: 'Test Description 3',
          price: 75,
          quantity: 10,
          status: ProductStatus.ACTIVE,
        });
        await productRepo.save(product3);

        await addToCart(consumerId, productId, 2);
        await addToCart(consumerId, product3.id, 1);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(201);
        expect(response.body.order.totalAmount).toBe(275);
        expect(response.body.order.vendorGroups).toHaveLength(2);

        const vg1 = response.body.order.vendorGroups.find((v: any) => v.vendorId === vendorId);
        expect(vg1.subtotal).toBe(200);
        expect(vg1.commissionPct).toBe(10);

        const vg2 = response.body.order.vendorGroups.find((v: any) => v.vendorId === vendor2.id);
        expect(vg2.subtotal).toBe(75);
        expect(vg2.commissionPct).toBe(15);
      });

      it('should use secondary address when provided', async () => {
        await addToCart(consumerId, productId, 1);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId2
          });

        expect(response.status).toBe(201);
        expect(response.body.order.shippingAddress.id).toBe(addressId2);
        expect(response.body.order.shippingAddress.street).toBe('Second Street');
      });
    });

    describe('Error cases', () => {
      it('should return 400 for missing shippingAddressId', async () => {
        await addToCart(consumerId, productId, 2);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('SHIPPING_ADDRESS_ID_REQUIRED');
        expect(response.body.message).toBe('Shipping address ID is required');
      });

      it('should return 400 for empty shippingAddressId', async () => {
        await addToCart(consumerId, productId, 2);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: ''
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('SHIPPING_ADDRESS_ID_REQUIRED');
      });

      it('should return 400 for empty cart', async () => {
        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe(OrderError.CART_EMPTY);
        expect(response.body.message).toBe('Cart is empty');
      });

      it('should return 404 for invalid shipping address', async () => {
        await addToCart(consumerId, productId, 2);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: 'non-existent-address'
          });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe(OrderError.INVALID_SHIPPING_ADDRESS);
        expect(response.body.message).toBe('Invalid shipping address');
      });

      it('should return 404 for product not found', async () => {
        // Create cart directly with non-existent product
        const cart = Cart.create(consumerId);
        cart.addItem('non-existent-product', vendorId, 2, 100);
        await cartRepo.save(cart);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe(OrderError.PRODUCT_NOT_FOUND);
        expect(response.body.message).toBe('Product not found');
      });

      it('should return 409 for insufficient stock', async () => {
        // Add item to cart with sufficient stock
        await addToCart(consumerId, productId, 2);

        // Reduce product stock below cart quantity
        const lowStockProduct = Product.reconstruct({
          ...(await productRepo.findById(productId))!,
          quantity: 1
        });
        await productRepo.update(lowStockProduct);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(409);
        expect(response.body.error).toBe(OrderError.INSUFFICIENT_STOCK);
        expect(response.body.message).toBe('Insufficient stock');
      });

      it('should return 404 for vendor not found', async () => {
        // Create cart directly with non-existent vendor
        const cart = Cart.create(consumerId);
        cart.addItem(productId, 'non-existent-vendor', 2, 100);
        await cartRepo.save(cart);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(404);
        expect(response.body.error).toBe(OrderError.VENDOR_NOT_FOUND);
        expect(response.body.message).toBe('Vendor not found');
      });

      it('should return 401 for missing auth token', async () => {
        const response = await request(app)
          .post('/api/v1/checkout')
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('MISSING_TOKEN');
      });

      it('should return 401 for invalid auth token', async () => {
        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', 'Bearer invalid-token')
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('INVALID_TOKEN');
      });

      it('should return 403 for ADMIN role (requires CONSUMER)', async () => {
        await addToCart(consumerId, productId, 2);

        const response = await request(app)
          .post('/api/v1/checkout')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            shippingAddressId: addressId
          });

        expect(response.status).toBe(403);
        expect(response.body.error).toBe('FORBIDDEN');
      });
    });
  });
});