import { useState, useCallback, useDeferredValue, useEffect } from 'react';
import { useProducts, ProductFilterParams } from './useProducts';
import { useCategories } from './useCategories';
import { ProductCard } from './ProductCard';
import { ProductFilters as ProductFiltersComponent } from './ProductFilters';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuth } from '@/app/providers/AuthProvider';
import { vendorApi, VendorApiException } from '@/shared/api/vendor';
import { Button, EmptyState, EmptyStateIcons, Spinner, ErrorAlert } from '@/components/ui';

function ProductCatalogContent() {
  const [filters, setFilters] = useState<ProductFilterParams>({
    page: 1,
    limit: 20,
    sortBy: 'stock_status',
  });

  // Debounced search using useDeferredValue
  const deferredSearch = useDeferredValue(filters.search ?? '');

  const { data, isLoading, isError, error, refetch } = useProducts(filters);
  const { data: categoriesData } = useCategories();
  const { isAuthenticated, hasRole } = useAuth();
  const isVendor = hasRole('VENDOR');

  // Check vendor profile status for vendors
  const [vendorProfile, setVendorProfile] = useState<{ hasProfile: boolean; isLoading: boolean }>({
    hasProfile: false,
    isLoading: true,
  });

  useEffect(() => {
    if (isVendor && isAuthenticated) {
      const checkVendorProfile = async () => {
        try {
          const response = await vendorApi.getMe();
          setVendorProfile({ hasProfile: !!response.vendor, isLoading: false });
        } catch (err) {
          // If API call fails, check if it's a VendorApiException
          if (err instanceof VendorApiException) {
            if (err.status === 401 || err.status === 403) {
              // Auth errors - no profile
              setVendorProfile({ hasProfile: false, isLoading: false });
            } else if (err.status === 404) {
              // No profile found
              setVendorProfile({ hasProfile: false, isLoading: false });
            } else {
              // 5xx or other errors - treat as loading error
              setVendorProfile({ hasProfile: false, isLoading: false });
            }
          } else {
            // Network or unknown error
            setVendorProfile({ hasProfile: false, isLoading: false });
          }
        }
      };
      checkVendorProfile();
    } else {
      setVendorProfile({ hasProfile: false, isLoading: false });
    }
  }, [isVendor, isAuthenticated]);

  // Announce product count changes to screen readers
  const total = data?.total || 0;
  useEffect(() => {
    const announcement = `${total} product${total !== 1 ? 's' : ''} found`;
    const liveRegion = document.getElementById('product-count-announcement');
    if (liveRegion) {
      liveRegion.textContent = announcement;
    }
  }, [total]);

  const handleCategoryChange = useCallback((categoryId: string | null) => {
    setFilters((prev) => ({ ...prev, categoryId, page: 1 }));
  }, []);

  const handleSearchChange = useCallback((search: string) => {
    setFilters((prev) => ({ ...prev, search, page: 1 }));
  }, []);

  const handleSortChange = useCallback((sortBy: ProductFilterParams['sortBy']) => {
    setFilters((prev) => ({ ...prev, sortBy, page: 1 }));
  }, []);

  // Client-side sorting for stock_status
  let products = data?.products || [];
  if (filters.sortBy === 'stock_status') {
    products = [...products].sort((a, b) => {
      const aInStock = a.quantity > 0;
      const bInStock = b.quantity > 0;
      if (aInStock && !bInStock) return -1;
      if (!aInStock && bInStock) return 1;
      return 0;
    });
  }

  const categories = categoriesData?.categories || [];

  if (isLoading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-12" role="main">
        <div className="flex justify-center items-center min-h-[400px]" role="status" aria-live="polite">
          <Spinner size="lg" label="Loading products..." />
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-12" role="main">
        <ErrorAlert
          title="Failed to Load Products"
          message={error?.message || 'An unexpected error occurred'}
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </main>
    );
  }

  const hasFilters = filters.search || filters.categoryId;

  const getEmptyStateMessage = () => {
    // If filters are applied, show filter adjustment message
    if (hasFilters) {
      return 'Try adjusting your filters or search query.';
    }

    // No filters applied - show role-based message
    if (!isAuthenticated) {
      return 'No products available at the moment. Check back later!';
    }

    if (isVendor) {
      if (vendorProfile.isLoading) {
        return 'Loading...';
      }
      if (!vendorProfile.hasProfile) {
        return 'Complete your vendor onboarding to add products';
      }
      return "You don't have any products yet. Add your first product.";
    }

    // Consumer or other roles
    return 'No products available at the moment. Check back later!';
  };

  const getEmptyStateAction = () => {
    if (!hasFilters && isVendor && !vendorProfile.isLoading && !vendorProfile.hasProfile) {
      return {
        label: 'Create Vendor Profile',
        onClick: () => window.location.href = '/vendor/onboard',
        variant: 'primary' as const,
      };
    }
    if (!hasFilters && isVendor && vendorProfile.hasProfile) {
      return {
        label: 'Add Product',
        onClick: () => window.location.href = '/vendor/products/new',
        variant: 'primary' as const,
      };
    }
    return undefined;
  };

  return (
    <main className="max-w-7xl mx-auto px-4 py-8" role="main">
      {/* Screen reader announcement for product count changes */}
      <div
        id="product-count-announcement"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Products</h1>
        <p className="text-gray-600 mt-1">{total} product{total !== 1 ? 's' : ''} found</p>
      </div>

      <ProductFiltersComponent
        categories={categories}
        selectedCategory={filters.categoryId || null}
        onCategoryChange={handleCategoryChange}
        searchQuery={deferredSearch}
        onSearchChange={handleSearchChange}
        sortBy={filters.sortBy || 'stock_status'}
        onSortChange={handleSortChange}
      />

      {products.length === 0 ? (
        <EmptyState
          title="No products found"
          description={getEmptyStateMessage()}
          icon={EmptyStateIcons.products}
          action={getEmptyStateAction()}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" role="list" aria-label="Product catalog">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          {(data?.page || 1) * (data?.limit || 20) < total && (
            <div className="mt-8 text-center">
              <Button
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
                disabled={isLoading}
              >
                Load More
              </Button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export function ProductCatalogPage() {
  return (
    <ErrorBoundary>
      <ProductCatalogContent />
    </ErrorBoundary>
  );
}
