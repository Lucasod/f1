export enum ReviewStatus {
  PUBLISHED = 'published',
  HIDDEN = 'hidden',
  REJECTED = 'rejected',
}

export enum ReviewError {
  INVALID_REVIEW = 'INVALID_REVIEW',
  INVALID_RATING = 'INVALID_RATING',
  INVALID_REVIEW_STATUS = 'INVALID_REVIEW_STATUS',
  REVIEW_NOT_FOUND = 'REVIEW_NOT_FOUND',
  REVIEW_ALREADY_EXISTS = 'REVIEW_ALREADY_EXISTS',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  REVIEW_PURCHASE_NOT_ELIGIBLE = 'REVIEW_PURCHASE_NOT_ELIGIBLE',
  REVIEW_IMAGE_REQUIRED = 'REVIEW_IMAGE_REQUIRED',
  INVALID_REVIEW_IMAGE = 'INVALID_REVIEW_IMAGE',
  REVIEW_IMAGE_LIMIT_REACHED = 'REVIEW_IMAGE_LIMIT_REACHED',
  REVIEW_OWNERSHIP_VIOLATION = 'REVIEW_OWNERSHIP_VIOLATION',
  REVIEW_CONFLICT = 'REVIEW_CONFLICT',
  INVALID_PAGINATION = 'INVALID_PAGINATION',
}

export interface ReviewData {
  id: string;
  productId: string;
  consumerId: string;
  orderItemId?: string;
  orderId?: string;
  rating: number;
  comment?: string;
  images: string[];
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
  revision?: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class Review {
  private readonly revisionValue: number;
  public readonly id: string;
  public readonly productId: string;
  public readonly consumerId: string;
  public readonly orderItemId?: string;
  public readonly orderId?: string;
  public rating: number;
  public comment?: string;
  public images: string[];
  public status: ReviewStatus;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: ReviewData) {
    this.revisionValue = data.revision ?? 0;
    this.id = data.id;
    this.productId = data.productId;
    this.consumerId = data.consumerId;
    this.orderItemId = data.orderItemId;
    this.orderId = data.orderId;
    this.rating = data.rating;
    this.comment = data.comment;
    this.images = [...data.images];
    this.status = data.status;
    this.createdAt = new Date(data.createdAt);
    this.updatedAt = new Date(data.updatedAt);
  }

  static create(data: {
    productId: string;
    consumerId: string;
    orderItemId?: string;
    orderId?: string;
    rating: number;
    comment?: string;
  }): Review {
    if (
      typeof data.productId !== 'string' || data.productId.trim().length === 0
      || typeof data.consumerId !== 'string' || data.consumerId.trim().length === 0
    ) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    const hasOrderItem = typeof data.orderItemId === 'string' && data.orderItemId.trim().length > 0;
    const hasOrderId = typeof data.orderId === 'string' && data.orderId.trim().length > 0;
    if (!hasOrderItem && !hasOrderId) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    if (data.orderItemId !== undefined && (typeof data.orderItemId !== 'string' || data.orderItemId.trim().length === 0)) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    if (data.orderId !== undefined && (typeof data.orderId !== 'string' || data.orderId.trim().length === 0)) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) {
      throw new Error(ReviewError.INVALID_RATING);
    }
    if (data.comment !== undefined && typeof data.comment !== 'string') {
      throw new Error(ReviewError.INVALID_REVIEW);
    }
    if (data.comment !== undefined && data.comment.trim().length === 0) {
      throw new Error(ReviewError.INVALID_REVIEW);
    }

    const now = new Date();
    return new Review({
      id: generateId(),
      productId: data.productId,
      consumerId: data.consumerId,
      orderItemId: data.orderItemId,
      orderId: data.orderId,
      rating: data.rating,
      comment: data.comment?.trim() || undefined,
      images: [],
      status: ReviewStatus.PUBLISHED,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstruct(data: ReviewData): Review {
    return new Review({
      ...data,
      createdAt: data.createdAt ?? new Date(),
      updatedAt: data.updatedAt ?? new Date(),
    });
  }

  get revision(): number {
    return this.revisionValue;
  }

  snapshot(revision = this.revision): Review {
    return Review.reconstruct({ ...this.toJSON(), revision });
  }

  moderate(status: ReviewStatus): void {
    if (!Object.values(ReviewStatus).includes(status)) {
      throw new Error(ReviewError.INVALID_REVIEW_STATUS);
    }
    this.status = status;
    this.updatedAt = new Date();
  }

  addImage(imageUrl: string): void {
    if (!imageUrl || imageUrl.trim().length === 0) {
      throw new Error(ReviewError.INVALID_REVIEW_IMAGE);
    }
    if (this.images.length >= 5) {
      throw new Error(ReviewError.REVIEW_IMAGE_LIMIT_REACHED);
    }
    this.images.push(imageUrl);
    this.updatedAt = new Date();
  }

  toJSON(): ReviewData {
    return {
      id: this.id,
      productId: this.productId,
      consumerId: this.consumerId,
      orderItemId: this.orderItemId,
      orderId: this.orderId,
      rating: this.rating,
      comment: this.comment,
      images: [...this.images],
      status: this.status,
      createdAt: new Date(this.createdAt),
      updatedAt: new Date(this.updatedAt),
    };
  }
}

export interface ReviewUpdateCondition {
  consumerId: string;
  status: ReviewStatus;
}

export interface ReviewRepository {
  save(review: Review): Promise<Review>;
  findById(id: string): Promise<Review | null>;
  findByOrderItemId(orderItemId: string): Promise<Review | null>;
  findByOrderId(orderId: string): Promise<Review[]>;
  findByProductId(productId: string): Promise<Review[]>;
  findAll(): Promise<Review[]>;
  update(review: Review, condition?: ReviewUpdateCondition): Promise<Review>;
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly reviews = new Map<string, Review>();

  async save(review: Review): Promise<Review> {
    if ([...this.reviews.values()].some(existing =>
      existing.id === review.id
      || (review.orderItemId !== undefined && existing.orderItemId === review.orderItemId)
    )) {
      throw new Error(ReviewError.REVIEW_ALREADY_EXISTS);
    }
    this.reviews.set(review.id, review.snapshot());
    return review.snapshot();
  }

  async findById(id: string): Promise<Review | null> {
    return this.reviews.get(id)?.snapshot() ?? null;
  }

  async findByOrderItemId(orderItemId: string): Promise<Review | null> {
    return [...this.reviews.values()].find(review => review.orderItemId === orderItemId)?.snapshot() ?? null;
  }

  async findByOrderId(orderId: string): Promise<Review[]> {
    return [...this.reviews.values()].filter(review => review.orderId === orderId).map(review => review.snapshot());
  }

  async findByProductId(productId: string): Promise<Review[]> {
    return [...this.reviews.values()].filter(review => review.productId === productId).map(review => review.snapshot());
  }

  async findAll(): Promise<Review[]> {
    return [...this.reviews.values()].map(review => review.snapshot());
  }

  async update(review: Review, condition?: ReviewUpdateCondition): Promise<Review> {
    const current = this.reviews.get(review.id);
    if (!current || current.revision !== review.revision || (condition &&
      (current.consumerId !== condition.consumerId || current.status !== condition.status))) {
      throw new Error(ReviewError.REVIEW_CONFLICT);
    }
    const updated = review.snapshot(review.revision + 1);
    this.reviews.set(review.id, updated);
    return updated.snapshot();
  }
}
