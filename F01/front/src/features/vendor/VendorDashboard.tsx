import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { vendorApi, Vendor } from '@/shared/api/vendor';
import { productApi, Product } from '@/shared/api/product';

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
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Error loading dashboard',
      }));
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const getStatusLabel = (status: Product['status']) => {
    const labels: Record<Product['status'], string> = {
      active: 'Active',
      inactive: 'Inactive',
      out_of_stock: 'Out of Stock',
      discontinued: 'Discontinued',
    };
    return labels[status] || status;
  };

  const getStatusClass = (status: Product['status']) => {
    const classes: Record<Product['status'], string> = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      out_of_stock: 'bg-yellow-100 text-yellow-800',
      discontinued: 'bg-red-100 text-red-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
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

  if (state.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
        <span className="sr-only">Loading dashboard...</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="p-6 text-center">
        <div className="max-w-md mx-auto">
          <h1 className="text-xl font-semibold text-red-600 mb-2">Error loading dashboard</h1>
          <p className="text-gray-600 mb-4">{state.error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!state.vendor) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-600">Vendor profile not found.</p>
      </div>
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
          <h2 className="text-gray-500 mt-1 text-xl font-medium">Vendor Dashboard</h2>
        </div>
        <Link
          to="/vendor/products/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add Product
        </Link>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard title="Total Products" value={totalProducts} icon="📦" />
        <MetricCard title="Active" value={activeProducts} icon="✅" className="border-l-4 border-green-500" />
        <MetricCard title="Out of Stock" value={outOfStockProducts} icon="⚠️" className="border-l-4 border-yellow-500" />
        <MetricCard title="Inactive" value={inactiveProducts} icon="⏸️" className="border-l-4 border-gray-400" />
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {state.products.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-4xl mb-4">📦</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">No products yet</h2>
            <p className="text-gray-500 mb-6">Start by adding your first product.</p>
            <Link
              to="/vendor/products/new"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Add Product
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
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
                          <div className="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
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
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusClass(product.status)}`}>
                        {getStatusLabel(product.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link to={`/vendor/products/${product.id}/edit`} className="text-blue-600 hover:text-blue-900 mr-3">
                        Edit
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${product.name}"? This action cannot be undone.`)) {
                            handleDeleteProduct(product.id);
                          }
                        }}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function MetricCard({ title, value, icon, className = '' }: { title: string; value: number; icon: string; className?: string }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}