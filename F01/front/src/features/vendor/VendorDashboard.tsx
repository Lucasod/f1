import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { vendorApi, Vendor, VendorApiException } from '@/shared/api/vendor';
import { productApi, Product } from '@/shared/api/product';
import { orderApi, OrderVendorGroup } from '@/shared/api/order';
import { financialApi, FinancialDashboard, FinancialHistoryEntry } from '@/shared/api/financial';
import {
  Button,
  Card,
  Badge,
  EmptyState,
  EmptyStateIcons,
  Spinner,
  ErrorAlert,
  ConfirmDialog,
  CardContent,
  LineChart,
  PieChart,
  BarChart,
} from '@/components/ui';

interface DashboardState {
  vendor: Vendor | null;
  products: Product[];
  isLoading: boolean;
  error: string | null;
}

interface PeriodOption {
  value: string;
  label: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

function getPeriodDates(period: string): { start?: Date; end?: Date } {
  const end = new Date();
  let start: Date | undefined;
  switch (period) {
    case '7d':
      start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
    default:
      start = undefined;
  }
  return { start, end };
}

function groupEntriesByDate(
  entries: FinancialHistoryEntry[],
  movementTypeFilter?: string
): { name: string; sales: number }[] {
  const filtered = movementTypeFilter
    ? entries.filter(e => e.movementType === movementTypeFilter)
    : entries;

  const byDate = new Map<string, number>();
  for (const entry of filtered) {
    const dateKey = new Date(entry.effectiveAt).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + entry.amount);
  }

  return Array.from(byDate.entries()).map(([name, sales]) => ({ name, sales }));
}

function groupOrdersByStatus(groups: OrderVendorGroup[]): { name: string; value: number }[] {
  const byStatus = new Map<string, number>();
  for (const group of groups) {
    byStatus.set(group.status, (byStatus.get(group.status) || 0) + 1);
  }

  const statusLabels: Record<string, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    returned: 'Returned',
  };

  return Array.from(byStatus.entries()).map(([name, value]) => ({
    name: statusLabels[name] || name,
    value,
  }));
}

function groupEntriesByMovementType(
  entries: FinancialHistoryEntry[]
): { name: string; value: number }[] {
  const byType = new Map<string, number>();
  for (const entry of entries) {
    byType.set(entry.movementType, (byType.get(entry.movementType) || 0) + entry.amount);
  }

  const typeLabels: Record<string, string> = {
    consumer_payment: 'Consumer Payments',
    commission: 'Commissions',
    vendor_transfer: 'Vendor Transfers',
    vendor_payout: 'Vendor Payouts',
    refund: 'Refunds',
    transfer_reversal: 'Transfer Reversals',
  };

  return Array.from(byType.entries()).map(([name, value]) => ({
    name: typeLabels[name] || name,
    value,
  }));
}

export function VendorDashboard() {
  const [state, setState] = useState<DashboardState>({
    vendor: null,
    products: [],
    isLoading: true,
    error: null,
  });

  const [deleteConfirm, setDeleteConfirm] = useState<{ productId: string; productName: string } | null>(null);
  const [period, setPeriod] = useState<string>('30d');

  // Financial dashboard data (vendor-scoped, isolated by vendorId in backend)
  const [financialData, setFinancialData] = useState<FinancialDashboard | null>(null);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [financialError, setFinancialError] = useState<string | null>(null);

  // Vendor order groups for orders-by-status chart
  const [vendorOrderGroups, setVendorOrderGroups] = useState<OrderVendorGroup[]>([]);
  const [vendorOrdersLoading, setVendorOrdersLoading] = useState(false);
  const [vendorOrdersError, setVendorOrdersError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));

      const [vendorRes, productsRes] = await Promise.all([
        vendorApi.getMe(),
        productApi.getMyProducts(),
      ]);

      setState({
        vendor: vendorRes.vendor,
        products: productsRes.products,
        isLoading: false,
        error: null,
      });

      // Load vendor order groups after vendor is known
      loadVendorOrderGroups();
    } catch (error) {
      let errorMessage = 'Error loading dashboard';
      if (error instanceof VendorApiException) {
        if (error.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (error.status === 403) {
          window.location.href = '/access-denied';
          return;
        }
        if (error.status === 404) {
          errorMessage = 'Vendor profile not found';
        } else {
          errorMessage = error.message || 'Error loading dashboard';
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
    }
  }, []);

  const loadFinancialData = useCallback(async () => {
    if (!state.vendor) return;

    const { start, end } = getPeriodDates(period);
    setFinancialLoading(true);
    setFinancialError(null);

    try {
      const data = await financialApi.getVendorDashboard(start, end);
      setFinancialData(data);
    } catch (error) {
      setFinancialError(error instanceof Error ? error.message : 'Failed to load financial data');
    } finally {
      setFinancialLoading(false);
    }
  }, [state.vendor, period]);

  const loadVendorOrderGroups = useCallback(async () => {
    setVendorOrdersLoading(true);
    setVendorOrdersError(null);

    try {
      const response = await orderApi.getVendorOrderGroups();
      setVendorOrderGroups(response.vendorGroups);
    } catch (error) {
      setVendorOrdersError(error instanceof Error ? error.message : 'Failed to load vendor orders');
    } finally {
      setVendorOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadFinancialData();
  }, [loadFinancialData]);

  const getStatusVariant = (status: Product['status']): 'success' | 'warning' | 'error' | 'neutral' => {
    const variants: Record<Product['status'], 'success' | 'warning' | 'error' | 'neutral'> = {
      active: 'success',
      inactive: 'neutral',
      out_of_stock: 'warning',
      discontinued: 'error',
    };
    return variants[status] || 'neutral';
  };

  const getStatusLabel = (status: Product['status']) => {
    const labels: Record<Product['status'], string> = {
      active: 'Active',
      inactive: 'Inactive',
      out_of_stock: 'Out of Stock',
      discontinued: 'Discontinued',
    };
    return labels[status] || status;
  };

  // Chart data transformations (memoized)
  const salesOverTimeData = useMemo(() => {
    if (!financialData?.history) return [];
    return groupEntriesByDate(financialData.history, 'consumer_payment');
  }, [financialData?.history]);

  const commissionTrendData = useMemo(() => {
    if (!financialData?.history) return [];
    return groupEntriesByDate(financialData.history, 'commission');
  }, [financialData?.history]);

  const revenueByPeriodData = useMemo(() => {
    if (!financialData?.history) return [];
    return groupEntriesByDate(financialData.history, 'consumer_payment');
  }, [financialData?.history]);

  const ordersByStatusData = useMemo(() => {
    return groupOrdersByStatus(vendorOrderGroups);
  }, [vendorOrderGroups]);

  const financialTransactionsData = useMemo(() => {
    if (!financialData?.history) return [];
    return groupEntriesByMovementType(financialData.history);
  }, [financialData?.history]);

  const handleDeleteProduct = async (productId: string) => {
    try {
      await productApi.delete(productId);
      await loadDashboard();
    } catch (error) {
      console.error('Failed to delete product:', error);
      window.location.reload();
    }
  };

  const handleDeleteClick = (productId: string, productName: string) => {
    setDeleteConfirm({ productId, productName });
  };

  if (state.isLoading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <div className="flex items-center justify-center min-h-[400px]" role="status" aria-live="polite">
          <Spinner size="lg" label="Loading dashboard..." />
        </div>
      </main>
    );
  }

  if (state.error) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <ErrorAlert
          title="Error Loading Dashboard"
          message={state.error}
          action={{ label: 'Try Again', onClick: () => window.location.reload() }}
        />
      </main>
    );
  }

  if (!state.vendor) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
        <EmptyState
          title="Vendor profile not found"
          description="You need to create a vendor profile to access the dashboard."
          icon={EmptyStateIcons.profile}
          action={{ label: 'Create Vendor Profile', onClick: () => window.location.href = '/vendor/onboard' }}
        />
      </main>
    );
  }

  // Calculate metrics
  const totalProducts = state.products.length;
  const activeProducts = state.products.filter(p => p.status === 'active').length;
  const outOfStockProducts = state.products.filter(p => p.status === 'out_of_stock').length;
  const inactiveProducts = state.products.filter(p => p.status === 'inactive').length;

  const grossSales = financialData?.grossSales ?? 0;
  const netExpected = financialData?.netExpectedAmount ?? 0;
  const receivedInStripe = financialData?.receivedInStripe ?? 0;
  const pendingDistribution = financialData?.pendingDistribution ?? 0;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{state.vendor.storeName}</h1>
          <p className="text-gray-500 mt-1 text-xl font-medium">Vendor Dashboard</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:ml-auto">
          <span className="text-sm text-gray-500 whitespace-nowrap">Period:</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PERIOD_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Link to="/vendor/products/new">
            <Button leftIcon={<span aria-hidden="true">+</span>}>
              Add Product
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard title="Total Products" value={totalProducts} />
        <MetricCard title="Active" value={activeProducts} variant="success" />
        <MetricCard title="Out of Stock" value={outOfStockProducts} variant="warning" />
        <MetricCard title="Inactive" value={inactiveProducts} variant="neutral" />
        <MetricCard title="Gross Sales" value={formatCurrency(grossSales)} variant="success" />
        <MetricCard title="Net Expected" value={formatCurrency(netExpected)} variant="default" />
        <MetricCard title="Received" value={formatCurrency(receivedInStripe)} variant="default" />
        <MetricCard title="Pending Distribution" value={formatCurrency(pendingDistribution)} variant="warning" />
      </div>

      {/* Sales over time chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card variant="bordered" padding="none">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Sales Over Time</h2>
            <p className="text-sm text-gray-500 mt-1">Vendor sales trend over the selected period</p>
          </div>
          <LineChart
            data={salesOverTimeData}
            title="Sales Over Time"
            xKey="name"
            yKeys={['sales']}
            yKeyLabels={{ sales: 'Sales (BRL)' }}
            height={300}
            loading={financialLoading}
            error={financialError}
            emptyMessage="No sales data available for the selected period"
          />
        </Card>

        <Card variant="bordered" padding="none">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Orders by Status</h2>
            <p className="text-sm text-gray-500 mt-1">Distribution of vendor order groups by status</p>
          </div>
          <PieChart
            data={ordersByStatusData}
            title="Orders by Status"
            height={300}
            loading={vendorOrdersLoading}
            error={vendorOrdersError}
            emptyMessage="No order data available"
          />
        </Card>
      </div>

      {/* Revenue by period and commissions charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card variant="bordered" padding="none">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Revenue by Period</h2>
            <p className="text-sm text-gray-500 mt-1">Gross sales grouped by day in the selected period</p>
          </div>
          <BarChart
            data={revenueByPeriodData}
            title="Revenue by Period"
            xKey="name"
            yKeys={['sales']}
            yKeyLabels={{ sales: 'Revenue (BRL)' }}
            height={300}
            loading={financialLoading}
            error={financialError}
            emptyMessage="No revenue data available for the selected period"
          />
        </Card>

        <Card variant="bordered" padding="none">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Platform Commissions</h2>
            <p className="text-sm text-gray-500 mt-1">Commission trend over the selected period</p>
          </div>
          <LineChart
            data={commissionTrendData}
            title="Platform Commissions"
            xKey="name"
            yKeys={['sales']}
            yKeyLabels={{ sales: 'Commission (BRL)' }}
            height={300}
            loading={financialLoading}
            error={financialError}
            emptyMessage="No commission data available for the selected period"
          />
        </Card>
      </div>

      {/* Financial transactions chart */}
      <Card variant="bordered" padding="none">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Financial Transactions by Type</h2>
          <p className="text-sm text-gray-500 mt-1">Breakdown of financial movements by type</p>
        </div>
        <BarChart
          data={financialTransactionsData}
          title="Financial Transactions by Type"
          xKey="name"
          yKeys={['value']}
          yKeyLabels={{ value: 'Amount (BRL)' }}
          height={300}
          loading={financialLoading}
          error={financialError}
          emptyMessage="No financial transaction data available"
        />
      </Card>

      {/* Products Table */}
      <Card variant="bordered" padding="none">
        {state.products.length === 0 ? (
          <CardContent className="p-12">
            <EmptyState
              title="No products yet"
              description="Start by adding your first product."
              icon={EmptyStateIcons.products}
              action={{ label: 'Add Product', onClick: () => window.location.href = '/vendor/products/new' }}
            />
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" role="table">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {state.products.map(product => (
                  <tr key={product.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        {product.images.length > 0 ? (
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            className="h-12 w-12 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400" aria-hidden="true">
                            📷
                          </div>
                        )}
                        <div className="ml-4">
                          <p className="text-sm font-medium text-gray-900">{product.name}</p>
                          <p className="text-sm text-gray-500 truncate max-w-xs">{product.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900">
                        R$ {product.price.toFixed(2).replace('.', ',')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm ${product.quantity === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {product.quantity} {product.quantity === 1 ? 'unit' : 'units'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={getStatusVariant(product.status)} size="sm" dot>
                        {getStatusLabel(product.status)}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link
                        to={`/vendor/products/${product.id}/edit`}
                        className="text-blue-600 hover:text-blue-900 mr-3"
                      >
                        Edit
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteClick(product.id, product.name)}
                        className="text-red-600 hover:text-red-900 hover:bg-red-50"
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm) {
            handleDeleteProduct(deleteConfirm.productId);
            setDeleteConfirm(null);
          }
        }}
        title="Delete Product"
        message={`Are you sure you want to delete "${deleteConfirm?.productName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
      />
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
          {variant === 'warning' && '⚠️'}
          {variant === 'neutral' && '⏸️'}
          {variant === 'default' && '📦'}
        </div>
      </div>
    </Card>
  );
}
