import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrders } from '@/features/order/useOrder';
import { reviewApi, type Review } from '@/shared/api/review';
import { Card } from '@/components/ui/Card';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function AdminDashboard() {
  const { data, isLoading, error, refetch } = useOrders({ page: 1, limit: 10 });
  const orders = data?.orders ?? [];

  const queryClient = useQueryClient();
  const [moderationError, setModerationError] = useState<{ reviewId: string; message: string } | null>(null);

  const {
    data: reviewsData,
    isLoading: reviewsLoading,
    isError: reviewsError,
    error: reviewsErrorObj,
    refetch: refetchReviews,
  } = useQuery({
    queryKey: ['admin', 'reviews'],
    queryFn: () => reviewApi.listAdminReviews(),
  });

  const reviews = reviewsData?.items ?? [];

  const moderateMutation = useMutation({
    mutationFn: ({ reviewId, status }: { reviewId: string; status: string }) =>
      reviewApi.moderateReview(reviewId, status as any),
    onSuccess: () => {
      setModerationError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'reviews'] });
    },
    onError: (err, variables) => {
      const message = err instanceof Error ? err.message : 'Failed to moderate review.';
      setModerationError({ reviewId: variables.reviewId, message });
    },
  });

  const isModerating = (reviewId: string, status: string) =>
    moderateMutation.isPending &&
    moderateMutation.variables?.reviewId === reviewId &&
    moderateMutation.variables?.status === status;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="mt-1 text-gray-600">Recent marketplace orders</p>
        </header>

        <Card variant="bordered" padding="none">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent orders</h2>
          </div>

          {isLoading && (
            <div className="flex justify-center p-12">
              <Spinner size="lg" label="Loading marketplace orders" withStatusRole />
            </div>
          )}

          {error && (
            <div className="p-6">
              <ErrorAlert
                title="Unable to load marketplace orders"
                message="The order service did not return data. Try again."
                variant="error"
                role="alert"
                action={{ label: 'Try again', onClick: () => refetch() }}
              />
            </div>
          )}

          {!isLoading && !error && orders.length === 0 && (
            <p className="px-6 py-10 text-center text-gray-600">No marketplace orders yet.</p>
          )}

          {!isLoading && !error && orders.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Order</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Date</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {orders.map(order => (
                    <tr key={order.id}>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{order.id}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">{formatDate(order.createdAt)}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm capitalize text-gray-600">{order.status.replace(/_/g, ' ')}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{formatCurrency(order.totalAmount)}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                        <Link className="font-medium text-blue-700 hover:text-blue-900" to={`/orders/${order.id}`}>
                          View order {order.id}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="mt-8">
          <Card variant="bordered" padding="none">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Review moderation</h2>
            </div>

            {reviewsLoading && (
              <div className="flex justify-center p-12">
                <Spinner size="lg" label="Loading reviews" withStatusRole />
              </div>
            )}

            {reviewsError && (
              <div className="p-6">
                <ErrorAlert
                  title="Unable to load reviews"
                  message={reviewsErrorObj instanceof Error ? `${reviewsErrorObj.message}. Failed to load reviews.` : 'The review service did not return data. Try again. Failed to load reviews.'}
                  variant="error"
                  role="alert"
                  action={{ label: 'Try again', onClick: () => refetchReviews() }}
                />
              </div>
            )}

            {!reviewsLoading && !reviewsError && reviews.length === 0 && (
              <p className="px-6 py-10 text-center text-gray-600">No reviews to moderate. No reviews yet.</p>
            )}

            {!reviewsLoading && !reviewsError && reviews.length > 0 && (
              <ul className="divide-y divide-gray-200">
                {reviews.map((review: Review) => (
                  <li key={review.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {review.rating}/5
                          <span className="ml-2 text-xs font-normal text-gray-500">Status: {review.status}</span>
                        </p>
                        {review.comment && (
                          <p className="mt-1 text-sm text-gray-700">{review.comment}</p>
                        )}
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
                        <p className="mt-1 text-xs text-gray-500">
                          Product: {review.productId} • Consumer: {review.consumerId}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => moderateMutation.mutate({ reviewId: review.id, status: 'published' })}
                          isLoading={isModerating(review.id, 'published')}
                          loadingText="Publishing..."
                          disabled={moderateMutation.isPending}
                        >
                          Publish
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => moderateMutation.mutate({ reviewId: review.id, status: 'hidden' })}
                          isLoading={isModerating(review.id, 'hidden')}
                          loadingText="Hiding..."
                          disabled={moderateMutation.isPending}
                        >
                          Hide
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => moderateMutation.mutate({ reviewId: review.id, status: 'rejected' })}
                          isLoading={isModerating(review.id, 'rejected')}
                          loadingText="Rejecting..."
                          disabled={moderateMutation.isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                    {moderationError?.reviewId === review.id && (
                      <div className="mt-3">
                        <ErrorAlert
                          title="Unable to moderate review"
                          message={`${moderationError.message}. Failed to moderate review.`}
                          variant="error"
                          role="alert"
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
