import { OrderRepository, OrderStatus } from '../order/order.domain';
import { ProductRepository } from '../product/product.domain';
import { StorageAdapter } from '../../shared/storage/storage.interface';
import {
  Review,
  ReviewError,
  ReviewRepository,
  ReviewStatus,
} from './review.domain';

export interface CreateReviewInput {
  productId: string;
  consumerId: string;
  orderItemId: string;
  rating: number;
  comment?: string;
}

export class ReviewService {
  constructor(
    private readonly reviewRepo: ReviewRepository,
    private readonly orderRepo: OrderRepository,
    private readonly productRepo: ProductRepository,
    private readonly storageAdapter: StorageAdapter,
  ) {}

  async createReview(input: CreateReviewInput): Promise<Review> {
    if (
      typeof input.orderItemId !== 'string'
      || input.orderItemId.trim().length === 0
      || (input.comment !== undefined && typeof input.comment !== 'string')
    ) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new Error(ReviewError.INVALID_RATING);
    }
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      throw new Error(ReviewError.PRODUCT_NOT_FOUND);
    }

    const orders = await this.orderRepo.findByPersonId(input.consumerId);
    const eligibleItem = orders.some(order =>
      order.status === OrderStatus.DELIVERED
      && order.vendorGroups.some(group =>
        group.items.some(item =>
          item.id === input.orderItemId && item.productId === input.productId
        )
      )
    );
    if (!eligibleItem) {
      throw new Error(ReviewError.REVIEW_PURCHASE_NOT_ELIGIBLE);
    }
    if (await this.reviewRepo.findByOrderItemId(input.orderItemId)) {
      throw new Error(ReviewError.REVIEW_ALREADY_EXISTS);
    }

    return this.reviewRepo.save(Review.create(input));
  }

  async listProductReviews(productId: string, page = 1, limit = 20) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error(ReviewError.INVALID_PAGINATION);
    }
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(ReviewError.PRODUCT_NOT_FOUND);
    }

    const published = (await this.reviewRepo.findByProductId(productId))
      .filter(review => review.status === ReviewStatus.PUBLISHED)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const total = published.length;
    const averageRating = total === 0
      ? null
      : Number((published.reduce((sum, review) => sum + review.rating, 0) / total).toFixed(2));

    return {
      items: published.slice((page - 1) * limit, page * limit),
      total,
      page,
      limit,
      averageRating,
    };
  }

  async listAdminReviews(page = 1, limit = 20) {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error(ReviewError.INVALID_PAGINATION);
    }
    const reviews = (await this.reviewRepo.findAll())
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return {
      items: reviews.slice((page - 1) * limit, page * limit),
      total: reviews.length,
      page,
      limit,
    };
  }

  async moderateReview(reviewId: string, status: ReviewStatus): Promise<Review> {
    if (!Object.values(ReviewStatus).includes(status)) {
      throw new Error(ReviewError.INVALID_REVIEW_STATUS);
    }
    const review = await this.reviewRepo.findById(reviewId);
    if (!review) {
      throw new Error(ReviewError.REVIEW_NOT_FOUND);
    }
    review.moderate(status);
    return this.reviewRepo.update(review);
  }

  async addReviewImage(
    consumerId: string,
    reviewId: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<Review> {
    const review = await this.reviewRepo.findById(reviewId);
    if (!review) {
      throw new Error(ReviewError.REVIEW_NOT_FOUND);
    }
    if (review.consumerId !== consumerId) {
      throw new Error(ReviewError.REVIEW_OWNERSHIP_VIOLATION);
    }
    if (review.status !== ReviewStatus.PUBLISHED) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    if (review.images.length >= 5) {
      throw new Error(ReviewError.REVIEW_IMAGE_LIMIT_REACHED);
    }

    const validation = await this.storageAdapter.validateFile(buffer, contentType);
    if (!validation.valid) {
      throw new Error(ReviewError.INVALID_REVIEW_IMAGE);
    }

    const extension = contentType === 'image/jpeg' ? 'jpg'
      : contentType === 'image/png' ? 'png'
        : contentType === 'image/webp' ? 'webp' : undefined;
    if (!extension) {
      throw new Error(ReviewError.INVALID_REVIEW_IMAGE);
    }

    const imageName = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}.${extension}`;
    const imageKey = `reviews/${review.productId}/${review.id}/${imageName}`;
    const { url } = await this.storageAdapter.save(buffer, imageKey, contentType);
    review.addImage(url);
    return this.reviewRepo.update(review);
  }

  async getReviewImageUrls(): Promise<string[]> {
    const reviews = await this.reviewRepo.findAll();
    return reviews.flatMap(review => review.images);
  }
}
