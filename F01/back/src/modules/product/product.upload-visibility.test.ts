import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createUploadRoutes } from './product.routes';

describe('public uploaded image visibility', () => {
  it('signs only exact references to visible products and published reviews', async () => {
    const getSignedUrl = vi.fn().mockResolvedValue('https://signed.example/image');
    const storageAdapter = {
      isRemote: true,
      sanitizeKey: (key: string) => key.replace(/[^a-zA-Z0-9\-_./]/g, ''),
      getUrl: (key: string) => `/api/v1/uploads/${key}`,
      getSignedUrl,
    } as any;
    const product = { id: 'p1', vendorId: 'v1', status: 'active', images: ['/api/v1/uploads/products/v1/p1/one.jpg'] };
    const review = { id: 'r1', productId: 'p1', status: 'published', images: ['/api/v1/uploads/reviews/p1/r1/one.jpg'] };
    const productRepo = { findById: vi.fn().mockImplementation(async id => id === 'p1' ? product : null) };
    const reviewService = { findReviewById: vi.fn().mockImplementation(async id => id === 'r1' ? review : null) };
    const app = express();
    app.use(createUploadRoutes({ storageAdapter, productRepo, reviewService } as any));

    const productResponse = await request(app).get('/products/v1/p1/one.jpg');
    expect(productResponse.status).toBe(302);
    expect(productResponse.headers['cache-control']).toBe('no-store');
    expect(getSignedUrl).toHaveBeenCalledWith('products/v1/p1/one.jpg', 60);
    expect((await request(app).get('/reviews/p1/r1/one.jpg')).status).toBe(302);
    for (const key of ['invoices/2026/10/private.pdf', 'products/v2/p1/one.jpg', 'products/v1/p1/missing.jpg', 'reviews/p2/r1/one.jpg', 'products/v1/p1/one%40.jpg']) {
      expect((await request(app).get(`/${key}`)).status).toBe(404);
    }
    product.images = ['https://other.example/api/v1/uploads/products/v1/p1/one.jpg'];
    expect((await request(app).get('/products/v1/p1/one.jpg')).status).toBe(404);
    product.images = ['/api/v1/uploads/products/v1/p1/one.jpg'];
    product.status = 'inactive';
    expect((await request(app).get('/products/v1/p1/one.jpg')).status).toBe(404);
    product.status = 'active';
    review.status = 'hidden';
    expect((await request(app).get('/reviews/p1/r1/one.jpg')).status).toBe(404);
    review.status = 'published';
    review.images = ['https://other.example/api/v1/uploads/reviews/p1/r1/one.jpg'];
    expect((await request(app).get('/reviews/p1/r1/one.jpg')).status).toBe(404);
    expect(getSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('fails closed when repositories are unavailable', async () => {
    const getSignedUrl = vi.fn();
    const app = express();
    app.use(createUploadRoutes({ storageAdapter: {
      isRemote: true, sanitizeKey: (key: string) => key, getSignedUrl,
    } as any }));
    expect((await request(app).get('/products/v1/p1/one.jpg')).status).toBe(404);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
