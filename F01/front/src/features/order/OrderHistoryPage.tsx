import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrders } from './useOrder';
import { Order, OrderStatus, OrderListParams } from '@/shared/api/order';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Select } from '@/components/ui/Input';

/**
 * Format currency in USD (US Dollar)
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

/**
 * Format date to Brazilian locale
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Map API order status to display label and badge variant
 */
function getStatusConfig(status: OrderStatus | undefined): { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' } {
  if (!status) return { label: 'UNKNOWN', variant: 'neutral' };
  const statusMap: Record<OrderStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
    pending_payment: { label: 'PENDING_PAYMENT', variant: 'warning' },
    paid: { label: 'PAID', variant: 'default' },
    processing: { label: 'PROCESSING', variant: 'info' },            // purple/cyan
    shipped: { label: 'SHIPPED', variant: 'info' },                  // indigo/cyan
    delivered: { label: 'DELIVERED', variant: 'success' },           // green
    cancelled: { label: 'CANCELLED', variant: 'error' },             // red
    failed_payment: { label: 'FAILED_PAYMENT', variant: 'error' },
  };

  return statusMap[status] || { label: status.toUpperCase(), variant: 'neutral' };
}

/**
 * Status filter options for the Select component
 */
const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All status' },
  { value: 'pending_payment', label: 'PENDING_PAYMENT' },
  { value: 'paid', label: 'PAID' },
  { value: 'processing', label: 'PROCESSING' },
  { value: 'shipped', label: 'SHIPPED' },
  { value: 'delivered', label: 'DELIVERED' },
  { value: 'cancelled', label: 'CANCELLED' },
  { value: 'failed_payment', label: 'FAILED_PAYMENT' },
];

const DEFAULT_PAGE_SIZE = 10;

export function OrderHistoryPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [currentPage, setCurrentPage] = useState(1);

  const filters = useMemo<OrderListParams>(
    () => ({
      status: statusFilter || undefined,
      page: currentPage,
      limit: DEFAULT_PAGE_SIZE,
    }),
    [statusFilter, currentPage]
  );

  const { data: ordersData, isLoading, error, refetch } = useOrders(filters);

  const orders = ordersData?.orders ?? [];
  const totalOrders = ordersData?.total ?? 0;
  const totalPages = Math.ceil(totalOrders / DEFAULT_PAGE_SIZE);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" label="Loading orders" withStatusRole />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ErrorAlert
            message="Could not load order history. Try again."
            title="Error loading order history"
            variant="error"
            action={{
              label: 'Try again',
              onClick: () => refetch(),
            }}
            role="alert"
          />
        </div>
      </div>
    );
  }

  // Empty state
  if (orders.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <EmptyState
            icon={EmptyStateIcons.orders}
            title="No orders found"
            description={statusFilter ? 'Try adjusting the status filter to see more orders.' : 'You haven\'t made any orders yet.'}
            action={
              !statusFilter
                ? {
                    label: 'Start shopping',
                    onClick: () => navigate('/products'),
                    variant: 'primary' as const,
                  }
                : {
                    label: 'Clear filter',
                    onClick: () => setStatusFilter(''),
                    variant: 'secondary' as const,
                  }
            }
            centered
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">My Orders</h1>
          <p className="mt-1 text-gray-600">
            {totalOrders} order{totalOrders !== 1 ? 's' : ''} found{totalOrders !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Filter and Controls */}
        <Card variant="bordered" padding="md" className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="w-full sm:w-64">
              <Select
                id="status-filter"
                label="Filter by status"
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as OrderStatus | '');
                  setCurrentPage(1);
                }}
                placeholder="All status"
              />
            </div>
          </div>
        </Card>

        {/* Orders List */}
        <Card variant="bordered" padding="none">
          <div className="divide-y divide-gray-200">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
            ))}
          </div>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
<Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
            <span className="px-4 text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface OrderCardProps {
  order: Order;
  onClick: () => void;
}

function OrderCard({ order, onClick }: OrderCardProps) {
  const statusConfig = getStatusConfig(order.status);
  const vendorGroupsCount = order.vendorGroups.length;

  return (
    <div
      className="p-6 hover:bg-gray-50 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center gap-4"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Order ID */}
      <div className="flex-1 sm:w-48 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          Order <span className="font-mono">{order.id.slice(0, 8).toUpperCase()}</span>
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {formatDate(order.createdAt)}
        </p>
      </div>

      {/* Status Badge */}
      <div className="flex-1 sm:w-32">
        <Badge variant={statusConfig.variant} size="md" dot>
          {statusConfig.label}
        </Badge>
      </div>

      {/* Vendor Groups Count */}
      <div className="flex-1 sm:w-32 text-center sm:text-left">
        <p className="text-sm font-medium text-gray-900">{vendorGroupsCount}</p>
        <p className="text-xs text-gray-500">seller{vendorGroupsCount !== 1 ? 's' : ''}</p>
      </div>

      {/* Total Amount */}
      <div className="flex-1 sm:w-40 text-right sm:text-left">
        <p className="text-lg font-semibold text-gray-900">{formatCurrency(order.totalAmount)}</p>
      </div>

      {/* View Details Button */}
      <div className="flex-1 sm:w-auto flex justify-center sm:justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          View details
        </Button>
      </div>
    </div>
  );
}