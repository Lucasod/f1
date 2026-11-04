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
  INVALID_PAGINATION = 'INVALID_PAGINATION',
}

export interface ReviewData {
  id: string;
  productId: string;
  consumerId: string;
  orderItemId: string;
  rating: number;
  comment?: string;
  images: string[];
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class Review {
  public readonly id: string;
  public readonly productId: string;
  public readonly consumerId: string;
  public readonly orderItemId: string;
  public rating: number;
  public comment?: string;
  public images: string[];
  public status: ReviewStatus;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: ReviewData) {
    this.id = data.id;
    this.productId = data.productId;
    this.consumerId = data.consumerId;
    this.orderItemId = data.orderItemId;
    this.rating = data.rating;
    this.comment = data.comment;
    this.images = [...data.images];
    this.status = data.status;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(data: {
    productId: string;
    consumerId: string;
    orderItemId: string;
    rating: number;
    comment?: string;
  }): Review {
    if (
      typeof data.productId !== 'string' || data.productId.trim().length === 0
      || typeof data.consumerId !== 'string' || data.consumerId.trim().length === 0
      || typeof data.orderItemId !== 'string' || data.orderItemId.trim().length === 0
    ) {
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
      rating: this.rating,
      comment: this.comment,
      images: [...this.images],
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

export interface ReviewRepository {
  save(review: Review): Promise<Review>;
  findById(id: string): Promise<Review | null>;
  findByOrderItemId(orderItemId: string): Promise<Review | null>;
  findByProductId(productId: string): Promise<Review[]>;
  findAll(): Promise<Review[]>;
  update(review: Review): Promise<Review>;
}

export class InMemoryReviewRepository implements ReviewRepository {
  private readonly reviews = new Map<string, Review>();

  async save(review: Review): Promise<Review> {
    if ([...this.reviews.values()].some(existing => existing.orderItemId === review.orderItemId)) {
      throw new Error(ReviewError.REVIEW_ALREADY_EXISTS);
    }
    this.reviews.set(review.id, review);
    return review;
  }

  async findById(id: string): Promise<Review | null> {
    return this.reviews.get(id) ?? null;
  }

  async findByOrderItemId(orderItemId: string): Promise<Review | null> {
    return [...this.reviews.values()].find(review => review.orderItemId === orderItemId) ?? null;
  }

  async findByProductId(productId: string): Promise<Review[]> {
    return [...this.reviews.values()].filter(review => review.productId === productId);
  }

  async findAll(): Promise<Review[]> {
    return [...this.reviews.values()];
  }

  async update(review: Review): Promise<Review> {
    if (!this.reviews.has(review.id)) {
      throw new Error(ReviewError.REVIEW_NOT_FOUND);
    }
    this.reviews.set(review.id, review);
    return review;
  }
}
