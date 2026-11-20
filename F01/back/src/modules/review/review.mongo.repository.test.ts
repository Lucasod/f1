import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Review, ReviewStatus, ReviewRepository, ReviewError } from './review.domain';
import { MongoReviewRepository } from './review.mongo.repository';

const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const DB_SUFFIX = Math.random().toString(36).substring(2, 9);
const TEST_DB_NAME = `fs01_marketplace_test_${DB_SUFFIX}`;

async function isMongoAvailable(uri: string): Promise<boolean> {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

const mongoAvailable = await isMongoAvailable(TEST_MONGO_URI);
const describeIfMongo = mongoAvailable
  ? describe
  : (name: string, fn: () => void) => describe.skip(`${name} (MongoDB unavailable at ${TEST_MONGO_URI})`, fn);

describeIfMongo('MongoReviewRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let reviewsCollection: Collection;
  let repo: ReviewRepository;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);

    reviewsCollection = db.collection('reviews');

    await reviewsCollection.createIndex({ productId: 1, status: 1, createdAt: -1 });
    await reviewsCollection.createIndex({ consumerId: 1 });
    await reviewsCollection.createIndex({ orderItemId: 1 }, { unique: true });
    await reviewsCollection.createIndex({ createdAt: -1 });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await reviewsCollection.deleteMany({});
    repo = new MongoReviewRepository(db);
  });

  describe('MongoReviewRepository - Contract Compliance', () => {
    it('should implement ReviewRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findByOrderItemId).toBe('function');
      expect(typeof repo.findByProductId).toBe('function');
      expect(typeof repo.findAll).toBe('function');
      expect(typeof repo.update).toBe('function');
    });

    it('should save and find review by ID', async () => {
      const review = createTestReview();

      await repo.save(review);
      const found = await repo.findById(review.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(review.id);
      expect(found!.productId).toBe(review.productId);
      expect(found!.consumerId).toBe(review.consumerId);
      expect(found!.orderItemId).toBe(review.orderItemId);
      expect(found!.rating).toBe(review.rating);
      expect(found!.status).toBe(ReviewStatus.PUBLISHED);
    });

    it('should find review by order item ID', async () => {
      const review = createTestReview({ orderItemId: 'order-item-1' });
      await repo.save(review);

      const found = await repo.findByOrderItemId('order-item-1');
      expect(found).not.toBeNull();
      expect(found!.orderItemId).toBe('order-item-1');

      const notFound = await repo.findByOrderItemId('non-existent');
      expect(notFound).toBeNull();
    });

    it('should find reviews by product ID', async () => {
      const review1 = createTestReview({ productId: 'product-1', orderItemId: 'oi-1' });
      const review2 = createTestReview({ productId: 'product-1', orderItemId: 'oi-2' });
      const review3 = createTestReview({ productId: 'product-2', orderItemId: 'oi-3' });

      await repo.save(review1);
      await repo.save(review2);
      await repo.save(review3);

      const product1Reviews = await repo.findByProductId('product-1');
      const product2Reviews = await repo.findByProductId('product-2');

      expect(product1Reviews).toHaveLength(2);
      expect(product2Reviews).toHaveLength(1);
      expect(product1Reviews.every(r => r.productId === 'product-1')).toBe(true);
      expect(product2Reviews[0].productId).toBe('product-2');
    });

    it('should find all reviews sorted by createdAt descending', async () => {
      const review1 = createTestReview({ orderItemId: 'oi-a' });
      await new Promise(resolve => setTimeout(resolve, 20));
      const review2 = createTestReview({ orderItemId: 'oi-b' });
      await new Promise(resolve => setTimeout(resolve, 20));
      const review3 = createTestReview({ orderItemId: 'oi-c' });

      await repo.save(review1);
      await repo.save(review2);
      await repo.save(review3);

      const all = await repo.findAll();

      expect(all).toHaveLength(3);
      expect(all[0].id).toBe(review3.id);
      expect(all[1].id).toBe(review2.id);
      expect(all[2].id).toBe(review1.id);
    });

    it('should update existing review (moderation status)', async () => {
      const review = createTestReview();
      await repo.save(review);

      const found = await repo.findById(review.id);
      expect(found).not.toBeNull();

      found!.moderate(ReviewStatus.HIDDEN);
      await repo.update(found!);

      const updated = await repo.findById(review.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe(ReviewStatus.HIDDEN);
      expect(updated!.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist all Review fields including images array', async () => {
      const review = createTestReview({
        productId: 'product-x',
        consumerId: 'consumer-x',
        rating: 4,
        comment: 'great product',
      });
      review.addImage('https://example.com/img1.jpg');
      review.addImage('https://example.com/img2.jpg');

      await repo.save(review);
      const found = await repo.findById(review.id);

      expect(found).not.toBeNull();
      expect(found!.productId).toBe('product-x');
      expect(found!.consumerId).toBe('consumer-x');
      expect(found!.rating).toBe(4);
      expect(found!.comment).toBe('great product');
      expect(found!.images).toEqual([
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg',
      ]);
      expect(found!.status).toBe(ReviewStatus.PUBLISHED);
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent review', async () => {
      const found = await repo.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should return empty array for product with no reviews', async () => {
      const reviews = await repo.findByProductId('non-existent-product');
      expect(reviews).toEqual([]);
    });

    it('should enforce unique constraint on orderItemId', async () => {
      const review1 = createTestReview({ orderItemId: 'oi-unique' });
      await repo.save(review1);

      const review2 = createTestReview({ orderItemId: 'oi-unique' });
      await expect(repo.save(review2)).rejects.toThrow();
    });
  });
});

function createTestReview(overrides: Partial<{
  productId: string;
  consumerId: string;
  orderItemId: string;
  rating: number;
  comment: string;
}> = {}): Review {
  return Review.create({
    productId: overrides.productId ?? 'test-product',
    consumerId: overrides.consumerId ?? 'test-consumer',
    orderItemId: overrides.orderItemId ?? 'test-order-item',
    rating: overrides.rating ?? 5,
    comment: overrides.comment,
  });
}
