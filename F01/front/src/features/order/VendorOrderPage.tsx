import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVendorOrderGroups, useOrderMutations } from './useOrder';
import {
  OrderVendorGroup,
  OrderVendorGroupStatus,
  VendorOrderGroupsParams,
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
    pending: { label: 'PENDENTE', variant: 'warning' },
    confirmed: { label: 'CONFIRMADO', variant: 'default' },
    preparing: { label: 'PREPARANDO', variant: 'info' },
    shipped: { label: 'ENVIADO', variant: 'info' },
    delivered: { label: 'ENTREGUE', variant: 'success' },
    cancelled: { label: 'CANCELADO', variant: 'error' },
    returned: { label: 'DEVOLVIDO', variant: 'error' },
  };

  return statusMap[status] || { label: status.toUpperCase(), variant: 'neutral' };
}

/**
 * Status filter options for the Select component
 */
const VENDOR_GROUP_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'PENDENTE' },
  { value: 'confirmed', label: 'CONFIRMADO' },
  { value: 'preparing', label: 'PREPARANDO' },
  { value: 'shipped', label: 'ENVIADO' },
  { value: 'delivered', label: 'ENTREGUE' },
  { value: 'cancelled', label: 'CANCELADO' },
  { value: 'returned', label: 'DEVOLVIDO' },
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
  onUpdateStatus: (ovgId: string, status: OrderVendorGroupStatus) => void;
  isUpdating: boolean;
  onViewDetails: (orderId: string) => void;
}

function VendorGroupCard({
  vendorGroup,
  onUpdateStatus,
  isUpdating,
  onViewDetails,
}: VendorGroupCardProps) {
  const statusConfig = getVendorGroupStatusConfig(vendorGroup.status);
  const availableNextStatuses = getNextVendorGroupStatuses(vendorGroup.status);
  const itemsCount = vendorGroup.items.length;

  return (
    <Card variant="bordered" padding="md" className="mb-4">
      {/* Vendor Group Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-gray-200">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">Pedido</span>
            <span className="font-mono text-sm text-gray-700">{vendorGroup.orderId.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Grupo vendedor</span>
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
          <p className="text-xs text-gray-500 uppercase tracking-wider">Itens</p>
          <p className="font-medium text-gray-900">{itemsCount}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Data</p>
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
          <p className="text-xs text-gray-500 uppercase tracking-wider">Comissão ({vendorGroup.commissionPct}%)</p>
          <p className="text-lg font-semibold text-gray-900">{formatCurrency(vendorGroup.commissionAmount)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Líquido Vendedor</p>
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
            Ver detalhes
          </Button>
          {availableNextStatuses.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {availableNextStatuses.map((nextStatus) => {
                const nextStatusConfig = getVendorGroupStatusConfig(nextStatus);
                return (
                  <Button
                    key={nextStatus}
                    variant="outline"
                    size="sm"
                    onClick={() => onUpdateStatus(vendorGroup.id, nextStatus)}
                    disabled={isUpdating || vendorGroup.status === nextStatus}
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

  const handleUpdateStatus = (ovgId: string, status: OrderVendorGroupStatus) => {
    // Note: We need the orderId to call the mutation, but the hook only has ovgId.
    // The API expects orderId and ovgId. We need to find the orderId from the vendorGroup.
    const vendorGroup = vendorGroups.find((vg) => vg.id === ovgId);
    if (vendorGroup) {
      updateVendorGroupStatusMutation.mutate({
        orderId: vendorGroup.orderId,
        ovgId,
        status,
      });
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" label="Carregando pedidos do vendedor" withStatusRole />
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
            message="Não foi possível carregar os pedidos do vendedor. Tente novamente."
            title="Erro ao carregar pedidos"
            variant="error"
            action={{
              label: 'Tentar novamente',
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
            title="Nenhum grupo de pedidos encontrado"
            description={
              statusFilter
                ? 'Tente alterar o filtro de status para ver mais grupos de pedidos.'
                : 'Você ainda não tem nenhum grupo de pedidos associado.'
            }
            action={
              !statusFilter
                ? undefined
                : {
                    label: 'Limpar filtro',
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
          <h1 className="text-3xl font-bold text-gray-900">Meus Pedidos (Vendedor)</h1>
          <p className="mt-1 text-gray-600">
            {totalGroups} grupo{totalGroups !== 1 ? 's' : ''} de pedido{totalGroups !== 1 ? 's' : ''} encontrado{totalGroups !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Filter and Controls */}
        <Card variant="bordered" padding="md" className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="w-full sm:w-72">
              <Select
                id="vendor-group-status-filter"
                label="Filtrar por status"
                options={VENDOR_GROUP_STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as OrderVendorGroupStatus | '');
                  setCurrentPage(1);
                }}
                placeholder="Todos os status"
              />
            </div>
          </div>
        </Card>

        {/* Vendor Groups List */}
        <div className="space-y-4">
          {vendorGroups.map((vendorGroup) => (
            <VendorGroupCard
              key={vendorGroup.id}
              vendorGroup={vendorGroup}
              onUpdateStatus={handleUpdateStatus}
              isUpdating={updateVendorGroupStatusMutation.isPending}
              onViewDetails={(orderId) => navigate(`/orders/${orderId}`)}
            />
          ))}
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
              Anterior
            </Button>
            <span className="px-4 text-sm text-gray-600">
              Página {currentPage} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Próxima
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}