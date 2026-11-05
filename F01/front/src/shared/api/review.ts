import { apiClient } from './client';

export enum ReviewStatus {
  PUBLISHED = 'published',
  HIDDEN = 'hidden',
  REJECTED = 'rejected',
}

export interface Review {
  id: string;
  productId: string;
  consumerId: string;
  orderItemId?: string;
  orderId?: string;
  rating: number;
  comment: string | null | undefined;
  images: string[];
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewInput {
  productId: string;
  orderId: string;
  rating: number;
  comment?: string;
  images?: string[];
  orderItemId?: string;
}

export interface ListReviewsParams {
  page?: number;
  limit?: number;
}

export interface ListReviewsResponse {
  items: Review[];
  total: number;
  page: number;
  limit: number;
  averageRating: number | null;
}

/**
 * Custom error class for review API errors that preserves HTTP status and error code.
 * Allows callers to handle different error types (401, 403, 404, 5xx) appropriately.
 */
export class ReviewApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ReviewApiException';
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ReviewApiException(
      errorData.message || `API error: ${response.status}`,
      response.status,
      errorData.error
    );
  }
  return response.json();
}

export const reviewApi = {
  /**
   * List reviews for a product with pagination
   */
  async listProductReviews(
    productId: string,
    params: ListReviewsParams = {}
  ): Promise<ListReviewsResponse> {
    const { page = 1, limit = 10 } = params;
    const query = new URLSearchParams({ page: String(page), limit: String(limit) }).toString();
    const response = await apiClient.get(`/api/v1/products/${productId}/reviews?${query}`);
    return handleResponse<ListReviewsResponse>(response);
  },

  /**
   * Create a new review for a product
   */
  async createReview(data: { productId: string; orderId: string; rating: number; comment?: string }): Promise<Review> {
    const { productId, ...input } = data;
    const response = await apiClient.post(`/api/v1/products/${productId}/reviews`, input);
    const result = await handleResponse<{ review: Review }>(response);
    return result.review;
  },

  /**
   * Add an image to an existing review
   */
  async addReviewImage(reviewId: string, file: File): Promise<{ review: Review }> {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`/api/v1/reviews/${reviewId}/images`, {
      method: 'POST',
      headers: {
        ...apiClient.getAuthHeaders(),
      },
      body: formData,
    });

    return handleResponse<{ review: Review }>(response);
  },

  /**
   * List all reviews for admin moderation with pagination
   */
  async listAdminReviews(params: ListReviewsParams = {}): Promise<{
    items: Review[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page = 1, limit = 20 } = params;
    const query = new URLSearchParams({ page: String(page), limit: String(limit) }).toString();
    const response = await apiClient.get(`/api/v1/admin/reviews?${query}`);
    return handleResponse<{
      items: Review[];
      total: number;
      page: number;
      limit: number;
    }>(response);
  },

  /**
   * Moderate a review (change its status)
   */
  async moderateReview(reviewId: string, status: ReviewStatus): Promise<{ review: Review }> {
    const response = await apiClient.patch(`/api/v1/admin/reviews/${reviewId}/moderate`, { status });
    return handleResponse<{ review: Review }>(response);
  },
};