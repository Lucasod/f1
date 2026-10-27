import { useState, useCallback, useDeferredValue, useEffect } from 'react';
import { useProducts, ProductFilterParams } from './useProducts';
import { useCategories } from './useCategories';
import { ProductCard } from './ProductCard';
import { ProductFilters as ProductFiltersComponent } from './ProductFilters';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function ProductCatalogContent() {
  const [filters, setFilters] = useState<ProductFilterParams>({
    page: 1,
    limit: 20,
    sortBy: 'newest',
  });

  // Debounced search using useDeferredValue
  const deferredSearch = useDeferredValue(filters.search ?? '');

  const { data, isLoading, isError, error, refetch } = useProducts(filters);
  const { data: categoriesData } = useCategories();

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
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent" aria-hidden="true" />
          <span className="sr-only">Loading products...</span>
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-12" role="main">
        <div className="text-center py-12">
          <p className="text-red-600 mb-4" role="alert">Failed to load products: {error?.message}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

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
        sortBy={filters.sortBy || 'newest'}
        onSortChange={handleSortChange}
      />

      {products.length === 0 ? (
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No products found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filters.search || filters.categoryId
              ? 'Try adjusting your filters or search query.'
              : 'Get started by adding a new product.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6" role="list" aria-label="Product catalog">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>

          {(data?.page || 1) * (data?.limit || 20) < total && (
            <div className="mt-8 text-center">
              <button
                onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                disabled={isLoading}
              >
                Load More
              </button>
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