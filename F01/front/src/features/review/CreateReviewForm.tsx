import { useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import { useQueryClient } from '@tanstack/react-query';
import { reviewApi, type Review } from '@/shared/api/review';
import { Input, Textarea, Select, Button, ErrorAlert, Spinner } from '@/components/ui';

export interface CreateReviewFormProps {
  productId: string;
  orderId?: string;
  onSuccess?: (review: Review) => void;
  onReviewCreated?: (review: Review) => void;
}

const RATING_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({
  value: String(value),
  label: `${value} / 5`,
}));

export function CreateReviewForm({
  productId,
  orderId: initialOrderId,
  onSuccess,
  onReviewCreated,
}: CreateReviewFormProps) {
  const { isAuthenticated, hasRole } = useAuth();

  let queryClient: ReturnType<typeof useQueryClient> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    queryClient = useQueryClient();
  } catch {
    queryClient = null;
  }

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [orderId, setOrderId] = useState(initialOrderId ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdReview, setCreatedReview] = useState<Review | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  if (!isAuthenticated) {
    return (
      <div className="p-4 border rounded-lg bg-gray-50 text-sm text-gray-700" role="status">
        Please{' '}
        <a href="/login" className="text-blue-600 hover:underline">
          log in
        </a>{' '}
        to write a review.
      </div>
    );
  }

  if (!hasRole('CONSUMER')) {
    return null;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!orderId.trim()) {
      setError('Order ID is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await reviewApi.createReview({
        productId,
        orderId: orderId.trim(),
        rating,
        comment: comment.trim() ? comment.trim() : undefined,
      });
      const resultAny = result as unknown as { review?: Review };
      const review = resultAny.review ? resultAny.review : (result as Review);

      setCreatedReview(review);
      setSuccessMessage('Review submitted successfully.');
      onSuccess?.(review);
      onReviewCreated?.(review);

      if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ['reviews', productId] });
      }
    } catch (err) {
      const status =
        (err as { status?: number })?.status ??
        (err as { response?: { status?: number } })?.response?.status;

      if (status === 401) {
        setError('Please log in to submit a review.');
      } else if (status === 403) {
        setError('You are not eligible to review this product. A delivered order is required.');
      } else if (status === 409) {
        setError('This order has already been reviewed.');
      } else if (typeof status === 'number' && status >= 500) {
        setError('Server error. Please try again later.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit review.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !createdReview) {
      return;
    }

    setImageError(null);
    setIsUploadingImage(true);
    try {
      const response = await reviewApi.addReviewImage(createdReview.id, file);
      setCreatedReview(response.review);

      if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ['reviews', productId] });
      }
    } catch (err) {
      const status =
        (err as { status?: number })?.status ??
        (err as { response?: { status?: number } })?.response?.status;

      if (status === 401) {
        setImageError('Please log in to upload images.');
      } else if (status === 403) {
        setImageError('Only the review owner may upload images.');
      } else if (typeof status === 'number' && status >= 500) {
        setImageError('Server error. Please try again later.');
      } else {
        setImageError(err instanceof Error ? err.message : 'Failed to upload image.');
      }
    } finally {
      setIsUploadingImage(false);
      event.target.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <ErrorAlert
          title="Review submission failed"
          message={error}
          dismissible
          onDismiss={() => setError(null)}
        />
      )}

      {successMessage && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm" role="status">
          {successMessage}
        </div>
      )}

      {!createdReview && (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Select
            id="rating"
            label="Rating"
            required
            value={String(rating)}
            onChange={(event) => setRating(Number(event.target.value))}
            options={RATING_OPTIONS}
            disabled={isSubmitting}
          />

          <Input
            id="orderId"
            label="Order ID"
            required
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="Order id"
            disabled={isSubmitting || !!initialOrderId}
          />

          <Textarea
            id="comment"
            label="Comment (optional)"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Share your experience (optional)"
            rows={4}
            disabled={isSubmitting}
          />

          <div className="flex justify-end">
            <Button type="submit" isLoading={isSubmitting} loadingText="Submitting...">
              Submit Review
            </Button>
          </div>
        </form>
      )}

      {createdReview && (
        <div className="space-y-3">
          <div>
            <label htmlFor="review-image" className="block text-sm font-medium text-gray-700 mb-1">
              Add photo
            </label>
            <input
              id="review-image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageChange}
              disabled={isUploadingImage}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {isUploadingImage && (
              <div className="mt-2 flex items-center gap-2 text-sm text-blue-600">
                <Spinner size="sm" />
                Uploading image...
              </div>
            )}
            {imageError && (
              <p className="mt-1 text-sm text-red-600" role="alert">
                {imageError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CreateReviewForm;
