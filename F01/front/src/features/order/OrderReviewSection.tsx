import { useState } from 'react';
import { reviewApi } from '@/shared/api/review';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Input';
import { ErrorAlert } from '@/components/ui/ErrorAlert';

export interface OrderItemReviewProps {
  orderId: string;
  productId: string;
  productName: string;
}

export function OrderItemReview({ orderId, productId }: OrderItemReviewProps) {
  const [isWriting, setIsWriting] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);

  if (reviewed) {
    return <span className="text-sm text-green-700 font-medium">Reviewed</span>;
  }

  if (!isWriting) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setIsWriting(true)}>
        Write Review
      </Button>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    setIsSubmitting(true);
    try {
      await reviewApi.createReview({
        productId,
        orderId,
        rating,
        comment: comment.trim() ? comment.trim() : undefined,
      });

      setReviewed(true);
      setSuccessMessage('Review submitted successfully.');
      setIsWriting(false);
    } catch (err) {
      const status =
        (err as { status?: number })?.status ??
        (err as { response?: { status?: number } })?.response?.status;

      if (status === 401) {
        setError('Please log in to submit a review.');
      } else if (status === 403) {
        setError('You are not eligible to review this product. A delivered order is required.');
      } else if (status === 409) {
        setError('This product has already been reviewed for this order.');
      } else if (typeof status === 'number' && status >= 500) {
        setError('Server error. Please try again later.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit review.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
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

      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <Select
          id={`rating-${productId}`}
          label="Rating"
          required
          value={String(rating)}
          onChange={(event) => setRating(Number(event.target.value))}
          options={[1, 2, 3, 4, 5].map((value) => ({
            value: String(value),
            label: `${value} / 5`,
          }))}
          disabled={isSubmitting}
        />

        <Textarea
          id={`comment-${productId}`}
          label="Comment (optional)"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Share your experience (optional)"
          rows={3}
          disabled={isSubmitting}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsWriting(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSubmitting} loadingText="Submitting...">
            Submit Review
          </Button>
        </div>
      </form>
    </div>
  );
}

export interface OrderReviewSectionProps {
  order: {
    id: string;
    status: string;
    vendorGroups: { items: { id: string; productId: string; productName: string }[] }[];
  };
  canReview?: boolean;
}

export function OrderReviewSection({ order, canReview = true }: OrderReviewSectionProps) {
  if (!canReview || order.status !== 'delivered') {
    return null;
  }

  const items = order.vendorGroups.flatMap((group) => group.items);

  if (items.length === 0) {
    return null;
  }

  return (
    <Card variant="bordered" padding="md" className="mb-6" data-testid="order-review-section">
      <CardHeader>
        <CardTitle as="h3">Product Reviews</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
            <p className="font-medium text-gray-900 mb-2">{item.productName}</p>
            <OrderItemReview orderId={order.id} productId={item.productId} productName={item.productName} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default OrderReviewSection;
