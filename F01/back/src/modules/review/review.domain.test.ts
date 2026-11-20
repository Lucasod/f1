import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Review, ReviewStatus, ReviewError } from './review.domain';

describe('Review.create', () => {
  it('should create a valid review with all required fields', () => {
    const review = Review.create({
      productId: 'prod-001',
      consumerId: 'consumer-001',
      orderItemId: 'order-001',
      rating: 5,
    });
    expect(review.id).toBeDefined();
    expect(review.productId).toBe('prod-001');
    expect(review.consumerId).toBe('consumer-001');
    expect(review.orderItemId).toBe('order-001');
    expect(review.rating).toBe(5);
    expect(review.comment).toBeUndefined();
    expect(review.images).toEqual([]);
    expect(review.status).toBe(ReviewStatus.PUBLISHED);
    expect(review.createdAt).toBeInstanceOf(Date);
    expect(review.updatedAt).toBeInstanceOf(Date);
  });

  it('should trim and store comment when provided', () => {
    const review = Review.create({
      productId: 'prod-001',
      consumerId: 'consumer-001',
      orderItemId: 'order-001',
      rating: 3,
      comment: '  great product  ',
    });
    expect(review.comment).toBe('great product');
  });

  it('should throw INVALID_REVIEW when productId is missing', () => {
    expect(() =>
      Review.create({
        productId: '',
        consumerId: 'consumer-001',
        orderItemId: 'order-001',
        rating: 4,
      })
    ).toThrow(ReviewError.INVALID_REVIEW);
  });

  it('should throw INVALID_REVIEW when consumerId is missing', () => {
    expect(() =>
      Review.create({
        productId: 'prod-001',
        consumerId: '',
        orderItemId: 'order-001',
        rating: 4,
      })
    ).toThrow(ReviewError.INVALID_REVIEW);
  });

  it('should throw INVALID_REVIEW when orderItemId is missing', () => {
    expect(() =>
      Review.create({
        productId: 'prod-001',
        consumerId: 'consumer-001',
        orderItemId: '',
        rating: 4,
      })
    ).toThrow(ReviewError.INVALID_REVIEW);
  });

  it('should throw INVALID_RATING when rating is below 1', () => {
    expect(() =>
      Review.create({
        productId: 'prod-001',
        consumerId: 'consumer-001',
        orderItemId: 'order-001',
        rating: 0,
      })
    ).toThrow(ReviewError.INVALID_RATING);
  });

  it('should throw INVALID_RATING when rating is above 5', () => {
    expect(() =>
      Review.create({
        productId: 'prod-001',
        consumerId: 'consumer-001',
        orderItemId: 'order-001',
        rating: 6,
      })
    ).toThrow(ReviewError.INVALID_RATING);
  });

  it('should throw INVALID_RATING when rating is not an integer', () => {
    expect(() =>
      Review.create({
        productId: 'prod-001',
        consumerId: 'consumer-001',
        orderItemId: 'order-001',
        rating: 3.5,
      })
    ).toThrow(ReviewError.INVALID_RATING);
  });

  it('should throw INVALID_REVIEW when comment is empty string', () => {
    expect(() =>
      Review.create({
        productId: 'prod-001',
        consumerId: 'consumer-001',
        orderItemId: 'order-001',
        rating: 4,
        comment: '',
      })
    ).toThrow(ReviewError.INVALID_REVIEW);
  });

  it('should throw INVALID_REVIEW when comment is non-string', () => {
    expect(() =>
      Review.create({
        productId: 'prod-001',
        consumerId: 'consumer-001',
        orderItemId: 'order-001',
        rating: 4,
        comment: 123,
      })
    ).toThrow(ReviewError.INVALID_REVIEW);
  });
});

describe('Review.moderate', () => {
  let review: Review;

  beforeEach(() => {
    review = Review.create({
      productId: 'prod-001',
      consumerId: 'consumer-001',
      orderItemId: 'order-001',
      rating: 4,
    });
  });

  it('should transition status to PUBLISHED', () => {
    review.moderate(ReviewStatus.PUBLISHED);
    expect(review.status).toBe(ReviewStatus.PUBLISHED);
    expect(review.updatedAt).toBeInstanceOf(Date);
  });

  it('should transition status to HIDDEN', () => {
    review.moderate(ReviewStatus.HIDDEN);
    expect(review.status).toBe(ReviewStatus.HIDDEN);
    expect(review.updatedAt).toBeInstanceOf(Date);
  });

  it('should transition status to REJECTED', () => {
    review.moderate(ReviewStatus.REJECTED);
    expect(review.status).toBe(ReviewStatus.REJECTED);
    expect(review.updatedAt).toBeInstanceOf(Date);
  });

  it('should throw INVALID_REVIEW_STATUS for invalid status', () => {
    expect(() => review.moderate({} as ReviewStatus)).toThrow(ReviewError.INVALID_REVIEW_STATUS);
  });
});

describe('Review.addImage', () => {
  let review: Review;

  beforeEach(() => {
    review = Review.create({
      productId: 'prod-001',
      consumerId: 'consumer-001',
      orderItemId: 'order-001',
      rating: 4,
    });
  });

  it('should add a valid image URL', () => {
    review.addImage('https://example.com/image1.jpg');
    expect(review.images).toEqual(['https://example.com/image1.jpg']);
    expect(review.updatedAt).toBeInstanceOf(Date);
  });

  it('should add multiple images up to the limit of 5', () => {
    review.addImage('https://example.com/image1.jpg');
    review.addImage('https://example.com/image2.jpg');
    review.addImage('https://example.com/image3.jpg');
    review.addImage('https://example.com/image4.jpg');
    review.addImage('https://example.com/image5.jpg');
    expect(review.images).toHaveLength(5);
  });

  it('should throw REVIEW_IMAGE_LIMIT_REACHED when adding a 6th image', () => {
    review.addImage('https://example.com/image1.jpg');
    review.addImage('https://example.com/image2.jpg');
    review.addImage('https://example.com/image3.jpg');
    review.addImage('https://example.com/image4.jpg');
    review.addImage('https://example.com/image5.jpg');
    expect(() => review.addImage('https://example.com/image6.jpg')).toThrow(ReviewError.REVIEW_IMAGE_LIMIT_REACHED);
  });

  it('should throw INVALID_REVIEW_IMAGE when URL is empty', () => {
    expect(() => review.addImage('')).toThrow(ReviewError.INVALID_REVIEW_IMAGE);
  });

  it('should throw INVALID_REVIEW_IMAGE when URL is whitespace only', () => {
    expect(() => review.addImage('   ')).toThrow(ReviewError.INVALID_REVIEW_IMAGE);
  });
});

describe('Review.toJSON', () => {
  let review: Review;

  beforeEach(() => {
    review = Review.create({
      productId: 'prod-001',
      consumerId: 'consumer-001',
      orderItemId: 'order-001',
      rating: 5,
      comment: 'Excellent product!',
    });
    review.addImage('https://example.com/img1.jpg');
    review.addImage('https://example.com/img2.jpg');
  });

  it('should return an object with the correct shape', () => {
    const json = review.toJSON();
    expect(json).toHaveProperty('id');
    expect(json).toHaveProperty('productId');
    expect(json).toHaveProperty('consumerId');
    expect(json).toHaveProperty('orderItemId');
    expect(json).toHaveProperty('rating');
    expect(json).toHaveProperty('comment');
    expect(json).toHaveProperty('images');
    expect(json).toHaveProperty('status');
    expect(json).toHaveProperty('createdAt');
    expect(json).toHaveProperty('updatedAt');
    expect(json.id).toBe(review.id);
    expect(json.productId).toBe(review.productId);
    expect(json.consumerId).toBe(review.consumerId);
    expect(json.orderItemId).toBe(review.orderItemId);
    expect(json.rating).toBe(review.rating);
    expect(json.comment).toBe(review.comment);
    expect(json.images).toEqual(review.images);
    expect(json.status).toBe(review.status);
    expect(json.createdAt).toBeInstanceOf(Date);
    expect(json.updatedAt).toBeInstanceOf(Date);
  });
});

describe('Review.reconstruct', () => {
  it('should reconstruct a Review from ReviewData', () => {
    const original = Review.create({
      productId: 'prod-001',
      consumerId: 'consumer-001',
      orderItemId: 'order-001',
      rating: 4,
      comment: 'Good',
    });
    const data: any = {
      id: original.id,
      productId: original.productId,
      consumerId: original.consumerId,
      orderItemId: original.orderItemId,
      rating: original.rating,
      comment: original.comment,
      images: [...original.images],
      status: original.status,
    };
    const reconstructed = Review.reconstruct(data);
    expect(reconstructed.productId).toBe(original.productId);
    expect(reconstructed.consumerId).toBe(original.consumerId);
    expect(reconstructed.orderItemId).toBe(original.orderItemId);
    expect(reconstructed.rating).toBe(original.rating);
    expect(reconstructed.comment).toBe(original.comment);
    expect(reconstructed.images).toEqual(original.images);
    expect(reconstructed.status).toBe(original.status);
    expect(reconstructed.id).toBe(original.id);
    expect(reconstructed.createdAt).toBeInstanceOf(Date);
    expect(reconstructed.updatedAt).toBeInstanceOf(Date);
  });
});