import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AuthService } from '../auth/auth.service';
import { InMemoryPersonRepository, PersonRole } from '../person/person.domain';
import { Product, InMemoryProductRepository } from '../product/product.domain';
import { Vendor, InMemoryVendorRepository } from '../vendor/vendor.domain';
import { CartService } from './cart.service';
import { InMemoryCartRepository } from './cart.domain';
import { createCartRoutes } from './cart.routes';
import { config } from '../../config';

describe('Cart routes', () => {
  let app: express.Express;
  let authService: AuthService;
  let cartRepository: InMemoryCartRepository;
  let productId: string;
  let accessToken: string;
  let consumerId: string;

  beforeEach(async () => {
    const personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'test-secret-key', '24h');
    const { person, tokens } = await authService.register({
      name: 'Cart Consumer',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'cart-consumer@example.com',
      password: 'SecurePass123!',
      role: PersonRole.CONSUMER,
    });
    consumerId = person.id;
    accessToken = tokens.accessToken;

    const vendorRepository = new InMemoryVendorRepository();
    const vendor = Vendor.create({
      personId: 'vendor-owner',
      storeName: 'Cart Store',
      slug: 'cart-store',
      commissionPct: 10,
    });
    await vendorRepository.save(vendor);

    const productRepository = new InMemoryProductRepository();
    const product = Product.create({
      vendorId: vendor.id,
      categoryId: 'cart-category',
      name: 'Cart Product',
      description: 'Product used by cart route tests',
      price: 25,
      quantity: 4,
    });
    productId = product.id;
    await productRepository.save(product);

    cartRepository = new InMemoryCartRepository();
    const cartService = new CartService(cartRepository, productRepository, vendorRepository, config);
    app = express();
    app.use(express.json());
    app.use('/api/v1/cart', createCartRoutes({
      authService,
      cartService,
      personRepo: personRepository,
    }));
  });

  it('creates a guest cart, persists it by its returned identifier, and isolates other guests', async () => {
    const firstGuest = await request(app).get('/api/v1/cart').expect(200);
    const guestCartId = firstGuest.headers['x-guest-cart-id'] as string;
    expect(guestCartId).toMatch(/^guest:[0-9a-f-]{36}$/i);

    await request(app)
      .post('/api/v1/cart/items')
      .set('X-Guest-Cart-Id', guestCartId)
      .send({ productId, quantity: 2 })
      .expect(201);

    const reloadedCart = await request(app)
      .get('/api/v1/cart')
      .set('X-Guest-Cart-Id', guestCartId)
      .expect(200);
    expect(reloadedCart.body.cart.items).toHaveLength(1);
    expect(reloadedCart.body.cart.items[0].quantity).toBe(2);

    const secondGuest = await request(app).get('/api/v1/cart').expect(200);
    expect(secondGuest.headers['x-guest-cart-id']).not.toBe(guestCartId);
    expect(secondGuest.body.cart.items).toHaveLength(0);
  });

  it('uses the authenticated subject instead of a client guest-cart header', async () => {
    const guestCart = await request(app).get('/api/v1/cart').expect(200);
    const guestCartId = guestCart.headers['x-guest-cart-id'] as string;
    await request(app)
      .post('/api/v1/cart/items')
      .set('X-Guest-Cart-Id', guestCartId)
      .send({ productId, quantity: 1 })
      .expect(201);

    const authenticatedCart = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Guest-Cart-Id', 'guest:12345678-1234-4123-8123-123456789abc')
      .expect(200);

    expect(authenticatedCart.body.cart.id).toBe(consumerId);
    expect(authenticatedCart.body.guestCartId).toBeUndefined();
    expect(authenticatedCart.body.cart.items).toHaveLength(0);
    expect((await cartRepository.findById(guestCartId))?.totalItems).toBe(1);
  });

  it('validates stock on add and merge without partially changing either cart', async () => {
    const guestCart = await request(app).get('/api/v1/cart').expect(200);
    const guestCartId = guestCart.headers['x-guest-cart-id'] as string;
    await request(app)
      .post('/api/v1/cart/items')
      .set('X-Guest-Cart-Id', guestCartId)
      .send({ productId, quantity: 3 })
      .expect(201);
    await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId, quantity: 2 })
      .expect(201);

    await request(app)
      .post('/api/v1/cart/merge-guest')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ guestCartId })
      .expect(409)
      .expect(({ body }) => expect(body.error).toBe('STOCK_INSUFFICIENT'));

    expect((await cartRepository.findById(guestCartId))?.getItem(productId)?.quantity).toBe(3);
    expect((await cartRepository.findById(consumerId))?.getItem(productId)?.quantity).toBe(2);

    const overStock = await request(app)
      .post('/api/v1/cart/items')
      .set('X-Guest-Cart-Id', guestCartId)
      .send({ productId, quantity: 2 })
      .expect(409);
    expect(overStock.body.error).toBe('STOCK_INSUFFICIENT');
  });

  it('requires an authenticated consumer to merge a guest cart', async () => {
    await request(app)
      .post('/api/v1/cart/merge-guest')
      .send({ guestCartId: 'guest:12345678-1234-4123-8123-123456789abc' })
      .expect(401);
  });
});
