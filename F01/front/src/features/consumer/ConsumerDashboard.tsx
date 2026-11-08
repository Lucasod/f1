import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { orderApi, ConsumerOrderSummary, OrderStatus, OrderApiException } from '@/shared/api/order';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/app/providers/AuthProvider';
import { getOrderQueryScope } from '@/features/order/useOrder';

/**
 * Format currency in BRL (Brazilian Real)
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/**
 * Format date to Brazilian locale
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Map API order status to display label and badge variant
 */
function getOrderStatusConfig(status: OrderStatus): { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' } {
  const statusMap: Record<OrderStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
    pending_payment: { label: 'PENDING_PAYMENT', variant: 'warning' },
    paid: { label: 'PAID', variant: 'default' },
    processing: { label: 'PROCESSING', variant: 'info' },
    shipped: { label: 'SHIPPED', variant: 'info' },
    delivered: { label: 'DELIVERED', variant: 'success' },
    cancelled: { label: 'CANCELLED', variant: 'error' },
    failed_payment: { label: 'FAILED_PAYMENT', variant: 'error' },
  };

  return statusMap[status] || { label: status.toUpperCase(), variant: 'neutral' };
}

export function ConsumerDashboard() {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<{ summary: ConsumerOrderSummary }, Error>({
    queryKey: ['orders', 'consumer', 'summary', getOrderQueryScope(user)],
    queryFn: () => orderApi.getConsumerSummary(),
    staleTime: 2 * 60 * 1000,
  });

  const summary = data?.summary;
  const recentOrders = summary?.recentOrders ?? [];

  const handleShopAgain = () => {
    // Navigate to catalog/products page
    navigate('/products');
  };

  // Loading state
  if (isLoading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <div className="flex items-center justify-center min-h-[400px]" role="status" aria-live="polite">
          <Spinner size="lg" label="Loading dashboard..." />
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    let errorMessage = 'Error loading dashboard';
    if (error instanceof OrderApiException) {
      if (error.status === 401) {
        navigate('/login');
        return null;
      }
      if (error.status === 403) {
        navigate('/access-denied');
        return null;
      }
      errorMessage = error.message || 'Error loading dashboard';
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <ErrorAlert
          title="Error Loading Dashboard"
          message={errorMessage}
          action={{ label: 'Try Again', onClick: () => refetch() }}
        />
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">My Dashboard</h1>
          <p className="text-gray-500 mt-1 text-xl font-medium">Consumer Dashboard</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!hasRole('VENDOR') && (
            <Link to="/vendor/onboard">
              <Button variant="outline">Become a Seller</Button>
            </Link>
          )}
          <Link to="/orders">
            <Button variant="outline" leftIcon={<span aria-hidden="true">📋</span>}>
              All Orders
            </Button>
          </Link>
          <Link to="/profile">
            <Button variant="primary" leftIcon={<span aria-hidden="true">👤</span>}>
              My Profile
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard title="Total Orders" value={summary?.totalOrders ?? 0} />
        <MetricCard title="Total Spent" value={formatCurrency(summary?.totalSpent ?? 0)} variant="success" />
        <MetricCard title="Pending" value={summary?.pendingOrders ?? 0} variant="warning" />
        <MetricCard title="Delivered" value={summary?.deliveredOrders ?? 0} variant="success" />
      </div>

      {/* Recent Orders */}
      <Card variant="bordered" padding="none">
        <CardHeader className="p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle as="h2">Recent Orders</CardTitle>
            <Link to="/orders">
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </Link>
          </div>
        </CardHeader>
        {recentOrders.length === 0 ? (
          <CardContent className="p-12">
            <EmptyState
              title="No orders yet"
              description="Start shopping to see your orders here."
              icon={EmptyStateIcons.orders}
              action={{ label: 'Start Shopping', onClick: () => navigate('/products') }}
            />
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" role="table">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {recentOrders.map((order) => {
                  const statusConfig = getOrderStatusConfig(order.status as OrderStatus);
                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <Link
                          to={`/orders/${order.id}`}
                          className="text-blue-600 hover:text-blue-900 font-medium text-sm"
                        >
                          {order.id.slice(0, 8).toUpperCase()}
                        </Link>
                        <p className="text-xs text-gray-500 mt-0.5">{order.vendorGroups.length} vendor{order.vendorGroups.length !== 1 ? 's' : ''}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(order.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge variant={statusConfig.variant} size="sm" dot>
                          {statusConfig.label}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm font-medium text-gray-900">
                          {formatCurrency(order.totalAmount)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <Link
                          to={`/orders/${order.id}`}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                        >
                          View
                        </Link>
                        {order.status !== 'cancelled' && order.status !== 'failed_payment' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleShopAgain}
                            className="text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                          >
                            Shop Again
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}

type MetricCardVariant = 'default' | 'success' | 'warning' | 'neutral';

interface MetricCardProps {
  title: string;
  value: number | string;
  variant?: MetricCardVariant;
}

function MetricCard({ title, value, variant = 'default' }: MetricCardProps) {
  const variantStyles: Record<MetricCardVariant, string> = {
    default: 'border-l-4 border-blue-500',
    success: 'border-l-4 border-green-500',
    warning: 'border-l-4 border-yellow-500',
    neutral: 'border-l-4 border-gray-400',
  };

  return (
    <Card variant="bordered" padding="md" className={variantStyles[variant]}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className="text-3xl" aria-hidden="true">
          {variant === 'success' && '✅'}
          {variant === 'warning' && '⏳'}
          {variant === 'neutral' && '📦'}
          {variant === 'default' && '📋'}
        </div>
      </div>
    </Card>
  );
}