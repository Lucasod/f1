import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVendorOrderGroups, useOrderMutations } from './useOrder';
import {
  orderApi,
  OrderVendorGroup,
  OrderVendorGroupStatus,
  VendorOrderGroupsParams,
  OrderApiException,
} from '@/shared/api/order';
import { Card, CardFooter } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';

const DEFAULT_PAGE_SIZE = 10;

/**
 * Format currency in USD (US Dollar)
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'BRL',
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
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Map vendor group status to display label and badge variant
 * Statuses follow the backend OrderVendorGroup state machine.
 */
function getVendorGroupStatusConfig(status: OrderVendorGroupStatus): {
  label: string;
  variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
} {
  const statusMap: Record<OrderVendorGroupStatus, {
    label: string;
    variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
  }> = {
    pending: { label: 'PENDING', variant: 'warning' },
    confirmed: { label: 'CONFIRMED', variant: 'default' },
    preparing: { label: 'PREPARING', variant: 'info' },
    shipped: { label: 'SHIPPED', variant: 'info' },
    delivered: { label: 'DELIVERED', variant: 'success' },
    cancelled: { label: 'CANCELLED', variant: 'error' },
    returned: { label: 'RETURNED', variant: 'error' },
  };

  return statusMap[status] || { label: status.toUpperCase(), variant: 'neutral' };
}

/**
 * Status filter options for the Select component
 */
const VENDOR_GROUP_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All status' },
  { value: 'pending', label: 'PENDING' },
  { value: 'confirmed', label: 'CONFIRMED' },
  { value: 'preparing', label: 'PREPARING' },
  { value: 'shipped', label: 'SHIPPED' },
  { value: 'delivered', label: 'DELIVERED' },
  { value: 'cancelled', label: 'CANCELLED' },
  { value: 'returned', label: 'RETURNED' },
];

/**
 * Available next statuses for vendor group status transitions
 */
function getNextVendorGroupStatuses(currentStatus: OrderVendorGroupStatus): OrderVendorGroupStatus[] {
  const transitions: Record<OrderVendorGroupStatus, OrderVendorGroupStatus[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['shipped', 'cancelled'],
    shipped: ['delivered', 'cancelled', 'returned'],
    delivered: ['returned'],
    cancelled: [],
    returned: [],
  };
  return transitions[currentStatus] || [];
}

interface VendorGroupCardProps {
  vendorGroup: OrderVendorGroup;
  financialStatus: string | undefined;
  onUpdateStatus: (ovgId: string, status: OrderVendorGroupStatus) => void;
  isUpdating: boolean;
  onViewDetails: (orderId: string) => void;
}

function VendorGroupCard({
  vendorGroup,
  financialStatus,
  onUpdateStatus,
  isUpdating,
  onViewDetails,
}: VendorGroupCardProps) {
  const statusConfig = getVendorGroupStatusConfig(vendorGroup.status);
  const availableNextStatuses = getNextVendorGroupStatuses(vendorGroup.status);
  const itemsCount = vendorGroup.items.length;
  const canPrepare = financialStatus === 'paid';

  return (
    <Card variant="bordered" padding="md" className="mb-4">
      {/* Vendor Group Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-gray-200">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">Order</span>
            <span className="font-mono text-sm text-gray-700">{vendorGroup.orderId.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Vendor Group</span>
            <span className="font-mono">{vendorGroup.id.slice(0, 8).toUpperCase()}</span>
          </div>
        </div>
        <Badge variant={statusConfig.variant} size="md" dot>
          {statusConfig.label}
        </Badge>
      </div>

      {/* Customer Info & Items Count */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Items</p>
          <p className="font-medium text-gray-900">{itemsCount}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Date</p>
          <p className="font-medium text-gray-900">{formatDate(vendorGroup.createdAt)}</p>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-3 gap-4 text-center p-4 bg-gray-50 rounded-lg mb-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Subtotal</p>
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(vendorGroup.subtotal)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Commission ({vendorGroup.commissionPct}%)</p>
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(vendorGroup.commissionAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Vendor Net</p>
          <p className="text-lg font-semibold text-green-700">{formatCurrency(vendorGroup.vendorNet)}</p>
        </div>
      </div>

      {/* Actions */}
      <CardFooter className="pt-3 border-t border-gray-200">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetails(vendorGroup.orderId)}
          >
            View details
          </Button>
          {availableNextStatuses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {availableNextStatuses.map((nextStatus) => {
                const nextStatusConfig = getVendorGroupStatusConfig(nextStatus);
                // Disable PREPARING button if order financial status is not 'paid'
                const isPreparing = nextStatus === 'preparing';
                return (
                  <Button
                    key={nextStatus}
                    variant="outline"
                    size="sm"
                    onClick={() => onUpdateStatus(vendorGroup.id, nextStatus)}
                    disabled={isUpdating || vendorGroup.status === nextStatus || (isPreparing && !canPrepare)}
                  >
                    {nextStatusConfig.label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

export function VendorOrderPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<OrderVendorGroupStatus | ''>('');
  const [currentPage, setCurrentPage] = useState(1);

  const filters = useMemo<VendorOrderGroupsParams>(
    () => ({
      status: statusFilter || undefined,
      page: currentPage,
      limit: DEFAULT_PAGE_SIZE,
    }),
    [statusFilter, currentPage]
  );

  const {
    data: vendorGroupsData,
    isLoading,
    error,
    refetch,
  } = useVendorOrderGroups(filters);

  const { useUpdateVendorGroupStatus } = useOrderMutations();
  const updateVendorGroupStatusMutation = useUpdateVendorGroupStatus();

  const vendorGroups = vendorGroupsData?.vendorGroups ?? [];
  const totalGroups = vendorGroupsData?.total ?? 0;
  const totalPages = Math.ceil(totalGroups / DEFAULT_PAGE_SIZE);

  // Map orderId to financialStatus for guard checks
  const [orderFinancialStatusMap, setOrderFinancialStatusMap] = useState<Record<string, string | undefined>>(() => {
    const map: Record<string, string | undefined> = {};
    const orderIds = [...new Set(vendorGroups.map((vg) => vg.orderId))];
    orderIds.forEach((orderId) => {
      map[orderId] = 'pending_payment';
    });
    return map;
  });

  useEffect(() => {
    const orderIds = [...new Set(vendorGroups.map((vg) => vg.orderId))];
    orderIds.forEach((orderId) => {
      orderApi.getById(orderId)?.then(
        ({ order }) => {
          setOrderFinancialStatusMap((prev) => ({
            ...prev,
            [orderId]: order.financialStatus,
          }));
        },
        () => {
          setOrderFinancialStatusMap((prev) => ({
            ...prev,
            [orderId]: 'pending_payment',
          }));
        }
      );
    });
  }, [vendorGroups]);

  const handleUpdateStatus = (ovgId: string, status: OrderVendorGroupStatus) => {
    // Note: We need the orderId to call the mutation, but the hook only has ovgId.
    // The API expects orderId and ovgId. We need to find the orderId from the vendorGroup.
    const vendorGroup = vendorGroups.find((vg) => vg.id === ovgId);
    if (vendorGroup) {
      updateVendorGroupStatusMutation.mutate(
        {
          orderId: vendorGroup.orderId,
          ovgId,
          status,
        },
        {
          onError: (error: any) => {
            if (error instanceof OrderApiException && error.status === 409) {
              const message =
                error.message || 'Invalid payment status';
              alert(
                `Unable to prepare this order: ` + message +
                  `. The payment must be confirmed before changing the status to PREPARING.`
              );
            } else if (error instanceof Error) {
              alert(`Error updating status: ${error.message}`);
            } else {
              alert('Error unexpectedly updating order status.');
            }
          },
        }
      );
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" label="Loading vendor orders" withStatusRole />
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
            message="Could not load seller's orders. Try again."
            title="Error loading orders"
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
  if (vendorGroups.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <EmptyState
            icon={EmptyStateIcons.orders}
            title="No order groups found"
            description={
              statusFilter
                ? 'Try changing the status filter to see more order groups.'
                : 'You don\'t have any order groups associated.'
            }
            action={
              !statusFilter
                ? undefined
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
          <h1 className="text-3xl font-bold text-gray-900">My Orders (Seller)</h1>
          <p className="mt-1 text-gray-600">
            {totalGroups} order group{totalGroups !== 1 ? 's' : ''} found{totalGroups !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Filter and Controls */}
        <Card variant="bordered" padding="md" className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="w-full sm:w-72">
              <Select
                id="vendor-group-status-filter"
                label="Filter by status"
                options={VENDOR_GROUP_STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as OrderVendorGroupStatus | '');
                  setCurrentPage(1);
                }}
                placeholder="All status"
              />
            </div>
          </div>
        </Card>

        {/* Vendor Groups List */}
        <div className="space-y-4">
          {vendorGroups.map((vendorGroup) => {
    // Get financialStatus for this vendor group's order
    const financialStatus = orderFinancialStatusMap[vendorGroup.orderId];
    return (
      <VendorGroupCard
        key={vendorGroup.id}
        vendorGroup={vendorGroup}
        financialStatus={financialStatus}
        onUpdateStatus={handleUpdateStatus}
        isUpdating={updateVendorGroupStatusMutation.isPending}
        onViewDetails={(orderId) => navigate(`/orders/${orderId}`)}
      />
    );
  })}
        </div>

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