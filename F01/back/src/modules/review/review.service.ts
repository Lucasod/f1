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
  orderItemId?: string;
  orderId?: string;
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
      typeof input.productId !== 'string' || input.productId.trim().length === 0
      || typeof input.consumerId !== 'string' || input.consumerId.trim().length === 0
      || (input.orderItemId !== undefined && (typeof input.orderItemId !== 'string' || input.orderItemId.trim().length === 0))
      || (input.orderId !== undefined && (typeof input.orderId !== 'string' || input.orderId.trim().length === 0))
      || (input.comment !== undefined && typeof input.comment !== 'string')
    ) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new Error(ReviewError.INVALID_RATING);
    }
    if (!input.orderItemId && !input.orderId) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    const product = await this.productRepo.findById(input.productId);
    if (!product) {
      throw new Error(ReviewError.PRODUCT_NOT_FOUND);
    }

    let resolvedOrderId: string | undefined = input.orderId?.trim();
    let resolvedOrderItemId: string | undefined = input.orderItemId?.trim();

    if (resolvedOrderId) {
      const order = await this.orderRepo.findById(resolvedOrderId);
      if (!order || order.personId !== input.consumerId || order.status !== OrderStatus.DELIVERED) {
        throw new Error(ReviewError.REVIEW_PURCHASE_NOT_ELIGIBLE);
      }
      const matchingItems = order.vendorGroups
        .flatMap(group => group.items)
        .filter(item => item.productId === input.productId && (!resolvedOrderItemId || item.id === resolvedOrderItemId));
      if (!resolvedOrderItemId && matchingItems.length > 1) {
        throw new Error(ReviewError.REVIEW_CONFLICT);
      }
      const matchingItem = matchingItems[0];
      if (!matchingItem || !matchingItem.isDelivered) {
        throw new Error(ReviewError.REVIEW_PURCHASE_NOT_ELIGIBLE);
      }
      if (resolvedOrderItemId && resolvedOrderItemId !== matchingItem.id) {
        throw new Error(ReviewError.REVIEW_PURCHASE_NOT_ELIGIBLE);
      }
      if (!resolvedOrderItemId) {
        resolvedOrderItemId = matchingItem.id;
      }
    } else if (resolvedOrderItemId) {
      const orders = await this.orderRepo.findByPersonId(input.consumerId);
      const eligibleOrder = orders.find(order => order.personId === input.consumerId && order.status === OrderStatus.DELIVERED &&
        order.vendorGroups.some(group =>
          group.items.some(item =>
            item.id === resolvedOrderItemId && item.productId === input.productId && item.isDelivered
          )
        )
      );
      if (!eligibleOrder) {
        throw new Error(ReviewError.REVIEW_PURCHASE_NOT_ELIGIBLE);
      }
      resolvedOrderId = eligibleOrder.id;
    }

    if (!resolvedOrderId || !resolvedOrderItemId) {
      throw new Error(ReviewError.REVIEW_PURCHASE_NOT_ELIGIBLE);
    }
    if (await this.reviewRepo.findByOrderItemId(resolvedOrderItemId)) {
      throw new Error(ReviewError.REVIEW_ALREADY_EXISTS);
    }
    const orderReviews = await this.reviewRepo.findByOrderId(resolvedOrderId);
    if (orderReviews.some(review => !review.orderItemId && review.productId === input.productId)) {
      throw new Error(ReviewError.REVIEW_ALREADY_EXISTS);
    }

    return this.reviewRepo.save(Review.create({
      productId: input.productId,
      consumerId: input.consumerId,
      orderId: resolvedOrderId,
      orderItemId: resolvedOrderItemId,
      rating: input.rating,
      comment: input.comment,
    }));
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

  async findReviewById(id: string): Promise<Review | null> {
    return this.reviewRepo.findById(id);
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
    await this.storageAdapter.save(buffer, imageKey, contentType);
    review.addImage(imageKey);
    // A failed update may have committed; deleting could break a persisted reference.
    const updatedReview = await this.reviewRepo.update(review, { consumerId, status: ReviewStatus.PUBLISHED });
    return updatedReview;
  }

  toReviewWithUrls(review: Review): Review {
    return {
      ...review,
      images: review.images.map(key => this.storageAdapter.getUrl(key)),
    } as Review;
  }

  async getReviewImageUrls(): Promise<string[]> {
    const reviews = await this.reviewRepo.findAll();
    return reviews.flatMap(review => review.images.map(key => this.storageAdapter.getUrl(key)));
  }
}
