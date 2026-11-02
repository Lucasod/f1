import { useQuery } from '@tanstack/react-query';
import { reviewApi, type Review, type ListReviewsResponse } from '@/shared/api/review';
import { Spinner, ErrorAlert, EmptyState, EmptyStateIcons } from '@/components/ui';

interface ReviewSectionProps {
  productId: string;
}

export function ReviewSection({ productId }: ReviewSectionProps) {
  const { data, isLoading, isError, error, refetch } = useQuery<ListReviewsResponse>({
    queryKey: ['reviews', productId],
    queryFn: () => reviewApi.listProductReviews(productId),
    enabled: !!productId,
  });

  if (isLoading) {
    return <Spinner label="Loading reviews..." withStatusRole />;
  }

  if (isError) {
    return (
      <ErrorAlert
        title="Failed to load reviews"
        message={error instanceof Error ? error.message : 'Unknown error'}
        action={{ label: 'Retry', onClick: () => refetch() }}
      />
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        title="No reviews yet"
        icon={EmptyStateIcons.generic}
        description="Be the first to review this product."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-gray-600">
        <span className="font-medium text-lg">{data.averageRating?.toFixed(1) || '0.0'}</span>
        <span>out of 5 • {data.total} reviews</span>
      </div>
      <div className="space-y-3">
        {data.items.map((review: Review) => (
          <div key={review.id} className="p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium">{review.rating}/5</span>
              <time className="text-xs text-gray-500" dateTime={review.createdAt}>
                {new Date(review.createdAt).toLocaleDateString()}
              </time>
            </div>
            {review.comment && <p className="text-sm text-gray-700">{review.comment}</p>}
            {review.images && review.images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {review.images.map((image, index) => (
                  <img
                    key={`${review.id}-${index}`}
                    src={image}
                    alt={`Review image ${index + 1}`}
                    className="h-16 w-16 rounded object-cover border border-gray-200"
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ReviewSection;
