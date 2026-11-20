import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrderQueryScope, useOrders } from '@/features/order/useOrder';
import { useAuthStore } from '@/app/providers/authStore';
import { adminApi } from '@/shared/api/admin';
import { reviewApi, type Review } from '@/shared/api/review';
import { Card } from '@/components/ui/Card';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Spinner } from '@/components/ui/Spinner';
import { Button } from '@/components/ui/Button';
import { LineChart, PieChart, BarChart } from '@/components/ui/charts';

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

function groupOrdersByDate(orders: any[]): { name: string; sales: number }[] {
  const byDate = new Map<string, number>();
  for (const order of orders) {
    const dateKey = new Date(order.createdAt).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + order.totalAmount);
  }
  return Array.from(byDate.entries()).map(([name, sales]) => ({ name, sales }));
}

function groupOrdersByStatus(orders: any[]): { name: string; value: number }[] {
  const byStatus = new Map<string, number>();
  for (const order of orders) {
    const status = order.status || 'unknown';
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
  }

  const statusLabels: Record<string, string> = {
    pending_payment: 'Pending Payment',
    paid: 'Paid',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    failed_payment: 'Failed Payment',
  };

  return Array.from(byStatus.entries()).map(([name, value]) => ({
    name: statusLabels[name] || name.toUpperCase(),
    value,
  }));
}

function computeCommissionsByDate(orders: any[]): { name: string; commissions: number }[] {
  const byDate = new Map<string, number>();
  for (const order of orders) {
    for (const group of order.vendorGroups ?? []) {
      const dateKey = new Date(group.createdAt || order.createdAt).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      });
      byDate.set(dateKey, (byDate.get(dateKey) || 0) + (group.commissionAmount ?? 0));
    }
  }
  return Array.from(byDate.entries()).map(([name, commissions]) => ({ name, commissions }));
}

export function AdminDashboard() {
  const user = useAuthStore(state => state.user);
  const metrics = useQuery({
    queryKey: ['admin', 'metrics', getOrderQueryScope(user)],
    queryFn: adminApi.getMetrics,
  });
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

  // Chart data transformations from admin-scoped orders
  const salesOverTimeData = useMemo(() => groupOrdersByDate(orders), [orders]);
  const ordersByStatusData = useMemo(() => groupOrdersByStatus(orders), [orders]);
  const revenueByPeriodData = useMemo(() => groupOrdersByDate(orders), [orders]);
  const commissionData = useMemo(() => computeCommissionsByDate(orders), [orders]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="mt-1 text-gray-600">Marketplace overview and recent orders</p>
        </header>

        <section aria-label="Registered totals" className="mb-8">
          {metrics.isLoading && <Spinner label="Loading registered totals" withStatusRole />}
          {metrics.isError && <ErrorAlert title="Unable to load registered totals" message="Try again." variant="error" role="alert" action={{ label: 'Try again', onClick: () => metrics.refetch() }} />}
          {!metrics.isError && metrics.data && (
            <>
              <p className="mb-3 text-sm text-gray-600">Totals are counted separately and may reflect different moments, not a single snapshot.</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card><p>Registered orders</p><p>{metrics.data.orders}</p></Card>
                <Card><p>Registered vendors</p><p>{metrics.data.vendors}</p></Card>
                <Card><p>Registered products</p><p>{metrics.data.products}</p></Card>
              </div>
            </>
          )}
        </section>

        {/* Admin charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card variant="bordered" padding="none">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Sales Over Time</h2>
              <p className="text-sm text-gray-500 mt-1">Marketplace sales trend across all vendors</p>
            </div>
            <LineChart
              data={salesOverTimeData}
              title="Marketplace Sales Over Time"
              xKey="name"
              yKeys={['sales']}
              yKeyLabels={{ sales: 'Sales (BRL)' }}
              height={300}
              loading={isLoading}
              error={error?.message ?? null}
              emptyMessage="No marketplace sales data available"
            />
          </Card>

          <Card variant="bordered" padding="none">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Orders by Status</h2>
              <p className="text-sm text-gray-500 mt-1">Distribution of marketplace orders by status</p>
            </div>
            <PieChart
              data={ordersByStatusData}
              title="Orders by Status"
              height={300}
              loading={isLoading}
              error={error?.message ?? null}
              emptyMessage="No order data available"
            />
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card variant="bordered" padding="none">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Revenue by Period</h2>
              <p className="text-sm text-gray-500 mt-1">Gross marketplace revenue grouped by day</p>
            </div>
            <BarChart
              data={revenueByPeriodData}
              title="Revenue by Period"
              xKey="name"
              yKeys={['sales']}
              yKeyLabels={{ sales: 'Revenue (BRL)' }}
              height={300}
              loading={isLoading}
              error={error?.message ?? null}
              emptyMessage="No revenue data available"
            />
          </Card>

          <Card variant="bordered" padding="none">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Platform Commissions</h2>
              <p className="text-sm text-gray-500 mt-1">Commission earnings across all vendor groups</p>
            </div>
            <LineChart
              data={commissionData}
              title="Platform Commissions"
              xKey="name"
              yKeys={['commissions']}
              yKeyLabels={{ commissions: 'Commissions (BRL)' }}
              height={300}
              loading={isLoading}
              error={error?.message ?? null}
              emptyMessage="No commission data available"
            />
          </Card>
        </div>

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
                      <td className="whitespace-nowrap px-6 py-4 text-sm capitalize text-gray-600">{(order.status ?? '').replace(/_/g, ' ')}</td>
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
