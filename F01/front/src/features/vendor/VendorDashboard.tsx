import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { vendorApi, Vendor, VendorApiException } from '@/shared/api/vendor';
import { productApi, Product } from '@/shared/api/product';
import { Button, Card, Badge, EmptyState, EmptyStateIcons, Spinner, ErrorAlert, ConfirmDialog, CardContent } from '@/components/ui';

interface DashboardState {
  vendor: Vendor | null;
  products: Product[];
  isLoading: boolean;
  error: string | null;
}

export function VendorDashboard() {
  const [state, setState] = useState<DashboardState>({
    vendor: null,
    products: [],
    isLoading: true,
    error: null,
  });

  const [deleteConfirm, setDeleteConfirm] = useState<{ productId: string; productName: string } | null>(null);

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
          // No vendor profile
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

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

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

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="main">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{state.vendor.storeName}</h1>
          <p className="text-gray-500 mt-1 text-xl font-medium">Vendor Dashboard</p>
        </div>
        <Link to="/vendor/products/new">
          <Button leftIcon={<span aria-hidden="true">+</span>}>
            Add Product
          </Button>
        </Link>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard title="Total Products" value={totalProducts} />
        <MetricCard title="Active" value={activeProducts} variant="success" />
        <MetricCard title="Out of Stock" value={outOfStockProducts} variant="warning" />
        <MetricCard title="Inactive" value={inactiveProducts} variant="neutral" />
      </div>

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
  value: number;
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