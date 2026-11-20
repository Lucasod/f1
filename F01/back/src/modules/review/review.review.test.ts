import { describe, it, expect } from 'vitest';
import { Review, ReviewStatus, ReviewError } from './review.domain';

describe('Review Domain', () => {
  describe('Review.create', () => {
    it('creates a published review with rating 1-5', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
        comment: 'Great product!',
      });
      expect(review.productId).toBe('product-1');
      expect(review.consumerId).toBe('consumer-1');
      expect(review.orderItemId).toBe('item-1');
      expect(review.rating).toBe(5);
      expect(review.comment).toBe('Great product!');
      expect(review.status).toBe(ReviewStatus.PUBLISHED);
      expect(review.images).toEqual([]);
      expect(review.revision).toBe(0);
    });

    it('throws INVALID_RATING for rating outside 1-5', () => {
      expect(() => Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 0,
      })).toThrow(ReviewError.INVALID_RATING);

      expect(() => Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 6,
      })).toThrow(ReviewError.INVALID_RATING);
    });

    it('throws INVALID_REVIEW for missing orderItemId and orderId', () => {
      expect(() => Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        rating: 5,
      })).toThrow(ReviewError.INVALID_REVIEW);
    });

    it('throws INVALID_REVIEW for empty productId', () => {
      expect(() => Review.create({
        productId: '',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
      })).toThrow(ReviewError.INVALID_REVIEW);
    });
  });

  describe('Review.addImage', () => {
    it('adds an image URL', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
      });
      review.addImage('https://example.com/image.jpg');
      expect(review.images).toHaveLength(1);
      expect(review.images[0]).toBe('https://example.com/image.jpg');
    });

    it('throws REVIEW_IMAGE_LIMIT_REACHED after 5 images', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
      });
      for (let i = 0; i < 5; i++) {
        review.addImage(`https://example.com/image${i}.jpg`);
      }
      expect(() => review.addImage('https://example.com/image6.jpg')).toThrow(ReviewError.REVIEW_IMAGE_LIMIT_REACHED);
    });

    it('throws INVALID_REVIEW_IMAGE for empty URL', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
      });
      expect(() => review.addImage('')).toThrow(ReviewError.INVALID_REVIEW_IMAGE);
    });
  });

  describe('Review.moderate', () => {
    it('changes review status', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
      });
      review.moderate(ReviewStatus.HIDDEN);
      expect(review.status).toBe(ReviewStatus.HIDDEN);
    });

    it('throws INVALID_REVIEW_STATUS for invalid status', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
      });
      expect(() => review.moderate('invalid' as any)).toThrow(ReviewError.INVALID_REVIEW_STATUS);
    });
  });

  describe('snapshot/revision', () => {
    it('creates a snapshot with incremented revision', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 5,
      });
      expect(review.revision).toBe(0);
      const snapshot = review.snapshot();
      expect(snapshot.revision).toBe(0);
      const updated = review.snapshot(review.revision + 1);
      expect(updated.revision).toBe(1);
    });
  });

  describe('toJSON/roundtrip', () => {
    it('serializes and reconstructs a review', () => {
      const review = Review.create({
        productId: 'product-1',
        consumerId: 'consumer-1',
        orderItemId: 'item-1',
        rating: 4,
        comment: 'Good product',
      });
      review.addImage('https://example.com/img.jpg');
      const json = review.toJSON();
      const reconstructed = Review.reconstruct(json);
      expect(reconstructed.rating).toBe(4);
      expect(reconstructed.comment).toBe('Good product');
      expect(reconstructed.images).toEqual(['https://example.com/img.jpg']);
      expect(reconstructed.status).toBe(ReviewStatus.PUBLISHED);
    });
  });
});
