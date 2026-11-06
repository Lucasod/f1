import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/credential.domain';
import { InMemoryOrderRepository, Order, OrderStatus, OrderVendorGroupStatus } from '../order/order.domain';
import { InMemoryProductRepository, Product } from '../product/product.domain';
import { InMemoryPersonRepository, Person, PersonRole } from '../person/person.domain';
import { createReviewRoutes } from './review.routes';
import { createUploadRoutes } from '../product/product.routes';
import { InMemoryReviewRepository } from './review.domain';
import { ReviewService } from './review.service';
import { LocalStorageAdapter } from '../../shared/storage/local.adapter';
import { config } from '../../config';

describe('Review routes', () => {
  let app: express.Express;
  let authService: AuthService;
  let consumerToken: string;
  let otherConsumerToken: string;
  let adminToken: string;
  let product: Product;
  let deliveredOrderItemId: string;
  let deliveredOrderId: string;
  let consumerPersonId: string;
  let productRepository: InMemoryProductRepository;
  let orderRepository: InMemoryOrderRepository;
  let storageRoot: string;
  const originalStorageRoot = process.env.STORAGE_ROOT;
  const testPassword = process.env.TEST_USER_PASSWORD!;

  beforeEach(async () => {
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'review-api-'));
    process.env.STORAGE_ROOT = storageRoot;
    const personRepository = new InMemoryPersonRepository();
    authService = new AuthService(personRepository, 'review-test-secret', '24h');
    const consumer = await authService.register({
      name: 'Review Consumer',
      taxIdType: 'CPF',
      taxIdValue: '52998224725',
      email: 'review-consumer@example.com',
      password: testPassword,
      role: PersonRole.CONSUMER,
    });
    const otherConsumer = await authService.register({
      name: 'Other Consumer',
      taxIdType: 'CPF',
      taxIdValue: '98765432100',
      email: 'other-review-consumer@example.com',
      password: testPassword,
      role: PersonRole.CONSUMER,
    });
    consumerToken = consumer.tokens.accessToken;
    consumerPersonId = consumer.person.id;
    otherConsumerToken = otherConsumer.tokens.accessToken;

    const admin = Person.create({
      name: 'Review Admin',
      mainInfo: {
        name: 'Review Admin',
        taxIdType: 'CPF',
        taxIdValue: '11144477735',
      },
      contactInfos: [{ type: 'email', value: 'review-admin@example.com', isPrimary: true }],
      addresses: [],
    });
    admin.addRole(PersonRole.ADMIN);
    admin.setCredential(await hashPassword(testPassword));
    await personRepository.save(admin);
    adminToken = (await authService.login({
      email: 'review-admin@example.com',
      password: testPassword,
    })).tokens.accessToken;

    productRepository = new InMemoryProductRepository();
    product = Product.create({
      vendorId: 'review-vendor',
      categoryId: 'review-category',
      name: 'Review Product',
      description: 'Product used in review API tests',
      price: 25,
      quantity: 3,
    });
    await productRepository.save(product);

    orderRepository = new InMemoryOrderRepository();
    const deliveredOrder = Order.create({
      personId: consumerPersonId,
      vendorGroups: [{
        vendorId: 'review-vendor',
        items: [{
          productId: product.id,
          productName: product.name,
          vendorId: 'review-vendor',
          quantity: 1,
          unitPrice: product.price,
        }],
        commissionPct: 10,
      }],
      shippingAddress: {
        id: 'review-address',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    deliveredOrder.markPaymentAuthorized();
    deliveredOrder.updateVendorGroupStatus('review-vendor', OrderVendorGroupStatus.CONFIRMED);
    deliveredOrder.updateVendorGroupStatus('review-vendor', OrderVendorGroupStatus.PREPARING);
    deliveredOrder.updateVendorGroupStatus('review-vendor', OrderVendorGroupStatus.SHIPPED);
    deliveredOrder.updateVendorGroupStatus('review-vendor', OrderVendorGroupStatus.DELIVERED);
    expect(deliveredOrder.status).toBe(OrderStatus.DELIVERED);
    deliveredOrderItemId = deliveredOrder.vendorGroups[0].items[0].id;
    deliveredOrderId = deliveredOrder.id;
    await orderRepository.save(deliveredOrder);

    const storageAdapter = new LocalStorageAdapter(storageRoot, '/api/v1/uploads');
    const reviewService = new ReviewService(
      new InMemoryReviewRepository(),
      orderRepository,
      productRepository,
      storageAdapter,
    );
    app = express();
    app.use(express.json());
    app.use('/api/v1', createReviewRoutes({ authService, reviewService }));
    app.use('/api/v1/uploads', createUploadRoutes({ storageAdapter, productRepo: productRepository, reviewService }));
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    if (originalStorageRoot === undefined) {
      delete process.env.STORAGE_ROOT;
    } else {
      process.env.STORAGE_ROOT = originalStorageRoot;
    }
  });

  it('creates a published review only for the authenticated consumer’s delivered item', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderItemId: deliveredOrderItemId, rating: 5, comment: 'Great product' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.review).toMatchObject({
          productId: product.id,
          consumerId: expect.any(String),
          orderItemId: deliveredOrderItemId,
          rating: 5,
          status: 'published',
        });
      });

    await request(app)
      .get(`/api/v1/products/${product.id}/reviews`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(1);
        expect(body.averageRating).toBe(5);
        expect(body.items[0].status).toBe('published');
      });
  });

  it('rejects review creation before delivery or for another consumer’s order item', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${otherConsumerToken}`)
      .send({ orderItemId: deliveredOrderItemId, rating: 4 })
      .expect(403);

    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderItemId: 'unknown-order-item', rating: 4 })
      .expect(403);
  });

  it('validates the rating range and requires consumer authentication', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .send({ orderItemId: deliveredOrderItemId, rating: 6 })
      .expect(401);

    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderItemId: deliveredOrderItemId, rating: 6 })
      .expect(400);

    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .send({ rating: 5 })
      .expect(400);
  });

  it('allows admins to hide a published review and excludes hidden reviews from the public list', async () => {
    const created = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderItemId: deliveredOrderItemId, rating: 3 })
      .expect(201);

    await request(app)
      .patch(`/api/v1/admin/reviews/${created.body.review.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'hidden' })
      .expect(200)
      .expect(({ body }) => expect(body.review.status).toBe('hidden'));

    await request(app)
      .get(`/api/v1/products/${product.id}/reviews`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(0);
        expect(body.averageRating).toBeNull();
      });

    await request(app)
      .get('/api/v1/admin/reviews')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.total).toBe(1);
        expect(body.items[0].status).toBe('hidden');
      });
  });

  it('does not allow consumers to moderate reviews', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderItemId: deliveredOrderItemId, rating: 3 })
      .expect(201)
      .then(async ({ body }) => {
        await request(app)
          .patch(`/api/v1/admin/reviews/${body.review.id}/moderate`)
          .set('Authorization', `Bearer ${consumerToken}`)
          .send({ status: 'hidden' })
          .expect(403);
      });
  });

  it('prevents duplicate reviews for one order item', async () => {
    const first = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .send({ orderItemId: deliveredOrderItemId, rating: 4 })
      .expect(201);

    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .send({ orderItemId: deliveredOrderItemId, rating: 5 })
      .expect(409);

    expect(first.body.review.status).toBe('published');
  });

  it('allows the review owner to upload locally stored review images only', async () => {
    const created = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .send({ orderItemId: deliveredOrderItemId, rating: 4 })
      .expect(201);
    const image = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    }).jpeg().toBuffer();

    await request(app)
      .post(`/api/v1/reviews/${created.body.review.id}/images`)
      .set('Authorization', ['Bearer ', otherConsumerToken].join(''))
      .attach('image', image, { filename: 'review.jpg', contentType: 'image/jpeg' })
      .expect(403);

    const uploaded = await request(app)
      .post(`/api/v1/reviews/${created.body.review.id}/images`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .attach('image', image, { filename: 'review.jpg', contentType: 'image/jpeg' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.review.images).toHaveLength(1);
        expect(body.review.images[0]).toContain('/api/v1/uploads/reviews/');
      });

    const imagePath = new URL(uploaded.body.review.images[0], 'http://localhost').pathname;
    await request(app)
      .get(imagePath)
      .expect(200)
      .expect('Content-Type', /image\/jpeg/);

    await request(app)
      .post(`/api/v1/reviews/${created.body.review.id}/images`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .attach('image', Buffer.from('not an image'), { filename: 'review.jpg', contentType: 'image/jpeg' })
      .expect(400);
  });

  it('returns 400 when uploading an image to a non-published review', async () => {
    const created = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .send({ orderItemId: deliveredOrderItemId, rating: 4 })
      .expect(201);

    await request(app)
      .patch(`/api/v1/admin/reviews/${created.body.review.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'hidden' })
      .expect(200);

    const image = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    }).jpeg().toBuffer();

    await request(app)
      .post(`/api/v1/reviews/${created.body.review.id}/images`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .attach('image', image, { filename: 'review.jpg', contentType: 'image/jpeg' })
      .expect(400)
      .expect(({ body }) => expect(body.error).toBe('INVALID_REVIEW'));
  });

  it('limits each review to five locally stored images', async () => {
    const created = await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .send({ orderItemId: deliveredOrderItemId, rating: 4 })
      .expect(201);
    const image = await sharp({
      create: {
        width: 800,
        height: 800,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    }).jpeg().toBuffer();

    for (let count = 0; count < 5; count++) {
      await request(app)
        .post(`/api/v1/reviews/${created.body.review.id}/images`)
        .set('Authorization', ['Bearer ', consumerToken].join(''))
        .attach('image', image, { filename: `review-${count}.jpg`, contentType: 'image/jpeg' })
        .expect(201);
    }

    await request(app)
      .post(`/api/v1/reviews/${created.body.review.id}/images`)
      .set('Authorization', ['Bearer ', consumerToken].join(''))
      .attach('image', image, { filename: 'review-extra.jpg', contentType: 'image/jpeg' })
      .expect(400)
      .expect(({ body }) => expect(body.error).toBe('REVIEW_IMAGE_LIMIT_REACHED'));
  });

  it('orderId flow: success → 201', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderId: deliveredOrderId, productId: product.id, rating: 5 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.review).toMatchObject({
          productId: product.id,
          orderId: deliveredOrderId,
          rating: 5,
        });
      });
  });

  it('orderId flow: non-owner consumer → 403', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${otherConsumerToken}`)
      .send({ orderId: deliveredOrderId, rating: 4 })
      .expect(403);
  });

  it('orderId flow: non-delivered order → 403', async () => {
    const pendingOrder = Order.create({
      personId: consumerPersonId,
      vendorGroups: [{
        vendorId: 'review-vendor',
        items: [{
          productId: product.id,
          productName: product.name,
          vendorId: 'review-vendor',
          quantity: 1,
          unitPrice: product.price,
        }],
        commissionPct: 10,
      }],
      shippingAddress: {
        id: 'review-address-2',
        street: 'Main Street',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      },
    });
    await orderRepository.save(pendingOrder);
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderId: pendingOrder.id, rating: 4 })
      .expect(403);
  });

  it('orderId flow: product not in order → 403', async () => {
    const otherProduct = Product.create({
      vendorId: 'review-vendor',
      categoryId: 'review-category',
      name: 'Other Product',
      description: 'Other',
      price: 10,
      quantity: 1,
    });
    await productRepository.save(otherProduct);
    await request(app)
      .post(`/api/v1/products/${otherProduct.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderId: deliveredOrderId, rating: 4 })
      .expect(403);
  });

  it('orderId flow: duplicate review → 409', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderId: deliveredOrderId, rating: 5 })
      .expect(201);
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderId: deliveredOrderId, rating: 4 })
      .expect(409);
  });

  it('orderId flow: missing rating → 400', async () => {
    await request(app)
      .post(`/api/v1/products/${product.id}/reviews`)
      .set('Authorization', `Bearer ${consumerToken}`)
      .send({ orderId: deliveredOrderId })
      .expect(400);
  });

});
