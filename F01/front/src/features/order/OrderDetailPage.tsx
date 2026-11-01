import { useNavigate, useParams } from 'react-router-dom';
import { useOrderDetail, useOrderMutations } from './useOrder';
import { useAuth } from '@/app/providers/AuthProvider';
import {
  Order,
  OrderVendorGroup,
  OrderItem,
  OrderStatus,
  OrderVendorGroupStatus,
} from '@/shared/api/order';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Button } from '@/components/ui/Button';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';

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
 * Map API order status to display label and badge variant
 */
function getOrderStatusConfig(status: OrderStatus): { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' } {
  const statusMap: Record<OrderStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
    pending: { label: 'PENDING_PAYMENT', variant: 'warning' },
    confirmed: { label: 'PAID', variant: 'default' },
    processing: { label: 'PROCESSING', variant: 'info' },
    shipped: { label: 'SHIPPED', variant: 'info' },
    delivered: { label: 'DELIVERED', variant: 'success' },
    cancelled: { label: 'CANCELLED', variant: 'error' },
    refunded: { label: 'FAILED_PAYMENT', variant: 'error' },
  };

  return statusMap[status] || { label: status.toUpperCase(), variant: 'neutral' };
}

/**
 * Map vendor group status to display label and badge variant
 */
function getVendorGroupStatusConfig(status: OrderVendorGroupStatus): { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' } {
  const statusMap: Record<OrderVendorGroupStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
    pending: { label: 'PENDING', variant: 'warning' },
    confirmed: { label: 'CONFIRMED', variant: 'default' },
    preparing: { label: 'PREPARING', variant: 'info' },
    ready_for_pickup: { label: 'READY_FOR_PICKUP', variant: 'info' },
    out_for_delivery: { label: 'OUT_FOR_DELIVERY', variant: 'info' },
    delivered: { label: 'DELIVERED', variant: 'success' },
    cancelled: { label: 'CANCELLED', variant: 'error' },
    refunded: { label: 'REFUNDED', variant: 'error' },
  };

  return statusMap[status] || { label: status.toUpperCase(), variant: 'neutral' };
}

/**
 * Timeline steps for order status tracking
 */
const TIMELINE_STEPS: { status: OrderStatus; label: string; description: string }[] = [
  { status: 'pending', label: 'PENDING_PAYMENT', description: 'Aguardando pagamento' },
  { status: 'confirmed', label: 'PAID', description: 'Pagamento confirmado' },
  { status: 'processing', label: 'PROCESSING', description: 'Em preparação' },
  { status: 'shipped', label: 'SHIPPED', description: 'Enviado para entrega' },
  { status: 'delivered', label: 'DELIVERED', description: 'Entregue' },
];

const TERMINAL_STATUSES: OrderStatus[] = ['cancelled', 'refunded'];

interface VendorGroupCardProps {
  vendorGroup: OrderVendorGroup;
  isVendor: boolean;
  isAdmin: boolean;
  currentUserId: string;
  onUpdateStatus: (ovgId: string, status: OrderVendorGroupStatus) => void;
  orderStatus: OrderStatus;
}

function VendorGroupCard({
  vendorGroup,
  isVendor,
  isAdmin,
  currentUserId,
  onUpdateStatus,
  orderStatus,
}: VendorGroupCardProps) {
  const statusConfig = getVendorGroupStatusConfig(vendorGroup.status);
  const isOwnVendorGroup = vendorGroup.vendorId === currentUserId;
  const canUpdateVendorGroup = (isVendor && isOwnVendorGroup) || isAdmin;
  const isTerminalStatus = TERMINAL_STATUSES.includes(orderStatus);

  // Determine available next statuses for vendor group
  const getNextVendorGroupStatuses = (currentStatus: OrderVendorGroupStatus): OrderVendorGroupStatus[] => {
    const transitions: Record<OrderVendorGroupStatus, OrderVendorGroupStatus[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['preparing', 'cancelled'],
      preparing: ['ready_for_pickup', 'cancelled'],
      ready_for_pickup: ['out_for_delivery', 'cancelled'],
      out_for_delivery: ['delivered', 'cancelled'],
      delivered: ['refunded'],
      cancelled: [],
      refunded: [],
    };
    return transitions[currentStatus] || [];
  };

  const availableVendorGroupStatuses = getNextVendorGroupStatuses(vendorGroup.status);

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      {/* Vendor Group Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-3 border-b border-gray-200">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Vendedor: {vendorGroup.vendorId.slice(0, 8).toUpperCase()}</h3>
          <p className="text-sm text-gray-500 mt-0.5">ID do grupo: {vendorGroup.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <Badge variant={statusConfig.variant} size="md" dot>
          {statusConfig.label}
        </Badge>
      </div>

      {/* Items Table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">Produto</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wider">Qtd</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wider">Preço Unit.</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vendorGroup.items.map((item: OrderItem) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-900">
                  <p className="font-medium">{item.productName}</p>
                  <p className="text-xs text-gray-500">SKU: {item.productId.slice(0, 8).toUpperCase()}</p>
                </td>
                <td className="px-4 py-3 text-right text-gray-900">{item.quantity}</td>
                <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(item.unitPrice)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(item.totalPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Vendor Group Financial Summary */}
      <div className="grid grid-cols-3 gap-4 text-center p-4 bg-gray-50 rounded-lg">
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

      {/* Vendor Group Actions */}
      {(canUpdateVendorGroup || isAdmin) && !isTerminalStatus && availableVendorGroupStatuses.length > 0 && (
        <CardFooter className="pt-4 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {availableVendorGroupStatuses.map((nextStatus) => (
              <Button
                key={nextStatus}
                variant="outline"
                size="sm"
                onClick={() => onUpdateStatus(vendorGroup.id, nextStatus)}
                disabled={vendorGroup.status === nextStatus}
              >
                {getVendorGroupStatusConfig(nextStatus).label}
              </Button>
            ))}
          </div>
        </CardFooter>
      )}
    </Card>
  );
}

interface OrderTotalsProps {
  order: Order;
}

function OrderTotals({ order }: OrderTotalsProps) {
  const subtotal = order.vendorGroups.reduce((sum, vg) => sum + vg.subtotal, 0);
  const shipping = order.totalAmount - subtotal;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader>
        <CardTitle as="h3">Totais do Pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Subtotal ({order.vendorGroups.length} vendedor{order.vendorGroups.length !== 1 ? 'es' : ''})</span>
          <span className="font-medium text-gray-900">{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Frete</span>
          <span className="font-medium text-gray-900">{formatCurrency(shipping)}</span>
        </div>
        <div className="border-t border-gray-200 pt-3 flex justify-between text-lg font-bold">
          <span className="text-gray-900">Total</span>
          <span className="text-gray-900">{formatCurrency(order.totalAmount)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

interface ShippingAddressCardProps {
  address: Order['shippingAddress'];
}

function ShippingAddressCard({ address }: ShippingAddressCardProps) {
  return (
    <Card variant="bordered" padding="md">
      <CardHeader>
        <CardTitle as="h3">Endereço de Entrega</CardTitle>
      </CardHeader>
      <CardContent>
        <address className="not-italic space-y-1">
          <p className="font-medium text-gray-900">{address.street}, {address.number}</p>
          <p className="text-gray-600">{address.neighborhood}</p>
          <p className="text-gray-600">{address.city} - {address.state}</p>
        </address>
      </CardContent>
    </Card>
  );
}

interface TimelineTrackerProps {
  currentStatus: OrderStatus;
}

function TimelineTracker({ currentStatus }: TimelineTrackerProps) {
  const currentIndex = TIMELINE_STEPS.findIndex((step) => step.status === currentStatus);
  const isTerminal = TERMINAL_STATUSES.includes(currentStatus);

  return (
    <Card variant="bordered" padding="md">
      <CardHeader>
        <CardTitle as="h3">Rastreamento do Pedido</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" aria-hidden="true" />

          <div className="space-y-6 pl-14">
            {TIMELINE_STEPS.map((step, index) => {
              const isCompleted = index < currentIndex || (index === currentIndex && !isTerminal);
              const isCurrent = index === currentIndex && !isTerminal;

              return (
                <div key={step.status} className="relative">
                  {/* Timeline dot */}
                  <div
                    className={`
                      absolute -left-14 w-10 h-10 rounded-full flex items-center justify-center border-4
                      ${isCompleted
                        ? 'bg-green-500 border-green-500'
                        : isCurrent
                        ? 'bg-blue-500 border-blue-500'
                        : 'bg-white border-gray-300'}
                    `}
                    aria-hidden="true"
                  >
                    {isCompleted && (
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    {isCurrent && (
                      <div className="w-3 h-3 bg-white rounded-full animate-pulse" aria-hidden="true" />
                    )}
                  </div>

                  {/* Timeline content */}
                  <div className={`
                    ${isCompleted ? 'text-gray-900' : isCurrent ? 'text-blue-600' : 'text-gray-400'}
                  `}>
                    <p className="font-medium text-sm">{step.label}</p>
                    <p className="text-xs mt-0.5">{step.description}</p>
                  </div>
                </div>
              );
            })}

            {/* Terminal statuses */}
            {isTerminal && (
              <div className="relative">
                <div className="absolute -left-14 w-10 h-10 rounded-full flex items-center justify-center border-4 bg-red-500 border-red-500" aria-hidden="true">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="text-red-600">
                  <p className="font-medium text-sm">{getOrderStatusConfig(currentStatus).label}</p>
                  <p className="text-xs mt-0.5">Pedido {currentStatus === 'cancelled' ? 'cancelado' : 'com pagamento falhou'}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();

  const isConsumer = hasRole('CONSUMER');
  const isVendor = hasRole('VENDOR');
  const isAdmin = hasRole('ADMIN');

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useOrderDetail(orderId ?? null);

  const { useUpdateVendorGroupStatus, useUpdateOrderStatus } = useOrderMutations();

  const updateVendorGroupStatusMutation = useUpdateVendorGroupStatus();
  const updateOrderStatusMutation = useUpdateOrderStatus();

  const handleUpdateVendorGroupStatus = (ovgId: string, status: OrderVendorGroupStatus) => {
    if (!orderId) return;
    updateVendorGroupStatusMutation.mutate({ orderId, ovgId, status });
  };

  const handleUpdateOrderStatus = (status: OrderStatus) => {
    if (!orderId) return;
    updateOrderStatusMutation.mutate({ orderId, status });
  };

  const handleReorder = () => {
    // TODO: Implement reorder logic - could navigate to cart with items pre-filled
    navigate('/cart');
  };

  const handleBackToOrders = () => {
    navigate('/orders');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" label="Carregando detalhes do pedido" withStatusRole />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    const isNotFound = error instanceof Error && error.message.includes('404');

    if (isNotFound) {
      return (
        <div className="min-h-screen bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <EmptyState
              icon={EmptyStateIcons.orders}
              title="Pedido não encontrado"
              description="O pedido solicitado não existe ou foi removido."
              action={{
                label: 'Voltar para meus pedidos',
                onClick: handleBackToOrders,
                variant: 'primary',
              }}
              centered
            />
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ErrorAlert
            message="Não foi possível carregar os detalhes do pedido. Tente novamente."
            title="Erro ao carregar pedido"
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

  const order = data?.order;

  if (!order) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <EmptyState
            icon={EmptyStateIcons.orders}
            title="Pedido não encontrado"
            description="O pedido solicitado não existe ou foi removido."
            action={{
              label: 'Voltar para meus pedidos',
              onClick: handleBackToOrders,
              variant: 'primary',
            }}
            centered
          />
        </div>
      </div>
    );
  }

  const orderStatusConfig = getOrderStatusConfig(order.status);
  const isTerminal = TERMINAL_STATUSES.includes(order.status);

  // Determine available next statuses for admin
  const getNextOrderStatuses = (currentStatus: OrderStatus): OrderStatus[] => {
    const transitions: Record<OrderStatus, OrderStatus[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['processing', 'cancelled'],
      processing: ['shipped', 'cancelled'],
      shipped: ['delivered', 'cancelled'],
      delivered: ['refunded'],
      cancelled: [],
      refunded: [],
    };
    return transitions[currentStatus] || [];
  };

  const availableOrderStatuses = getNextOrderStatuses(order.status);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header with Back Button */}
        <div className="mb-8 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={handleBackToOrders} leftIcon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          }>
            Voltar
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Detalhes do Pedido</h1>
            <p className="text-gray-600 mt-1">
              Pedido <span className="font-mono text-gray-900">{order.id.slice(0, 8).toUpperCase()}</span>
            </p>
          </div>
        </div>

        {/* Order Header Card */}
        <Card variant="bordered" padding="md" className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div>
                <p className="text-sm text-gray-500">Status do Pedido</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={orderStatusConfig.variant} size="md" dot>
                    {orderStatusConfig.label}
                  </Badge>
                  {order.financialStatus && (
                    <Badge variant="neutral" size="sm">
                      {order.financialStatus}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="border-l border-gray-200 pl-4 sm:pl-0 sm:border-l-0 sm:border-t sm:pt-4">
                <p className="text-sm text-gray-500">Data do Pedido</p>
                <p className="font-medium text-gray-900">{formatDate(order.createdAt)}</p>
              </div>
            </div>

            {/* Role-based Actions */}
            <div className="flex flex-wrap gap-2">
              {/* Consumer: Reorder */}
              {isConsumer && !isTerminal && (
                <Button variant="primary" onClick={handleReorder} leftIcon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                }>
                  Comprar Novamente
                </Button>
              )}

              {/* Admin: Update Order Status */}
              {isAdmin && !isTerminal && availableOrderStatuses.length > 0 && (
                <div className="flex gap-2">
                  {availableOrderStatuses.map((nextStatus) => (
                    <Button
                      key={nextStatus}
                      variant="outline"
                      size="sm"
                      onClick={() => handleUpdateOrderStatus(nextStatus)}
                      disabled={updateOrderStatusMutation.isPending}
                    >
                      {getOrderStatusConfig(nextStatus).label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Timeline + Shipping Address */}
          <div className="lg:col-span-1 space-y-6">
            <TimelineTracker currentStatus={order.status} />
            <ShippingAddressCard address={order.shippingAddress} />
          </div>

          {/* Right Column: Vendor Groups + Totals */}
          <div className="lg:col-span-2 space-y-6">
            {/* Vendor Groups */}
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Itens por Vendedor</h2>
              {order.vendorGroups.map((vendorGroup) => (
                <VendorGroupCard
                  key={vendorGroup.id}
                  vendorGroup={vendorGroup}
                  isVendor={isVendor}
                  isAdmin={isAdmin}
                  currentUserId={user?.id ?? ''}
                  onUpdateStatus={handleUpdateVendorGroupStatus}
                  orderStatus={order.status}
                />
              ))}
            </div>

            {/* Order Totals */}
            <OrderTotals order={order} />
          </div>
        </div>
      </div>
    </div>
  );
}