import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { productApi, Product } from '@/shared/api/product';
import { useCartMutations } from '@/features/cart/useCart';
import { CartItemInput } from '@/shared/api/cart';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Card, Badge, Spinner, ErrorAlert, EmptyState, EmptyStateIcons, Button } from '@/components/ui';

function getStatusVariant(status: Product['status'], quantity: number): 'success' | 'error' | 'neutral' {
  if (quantity === 0 || status === 'out_of_stock') {
    return 'error';
  }

  switch (status) {
    case 'active':
      return 'success';
    case 'inactive':
    case 'discontinued':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function getStatusLabel(status: Product['status'], quantity: number): string {
  if (quantity === 0 || status === 'out_of_stock') {
    return 'Out of Stock';
  }

  switch (status) {
    case 'active':
      return 'In Stock';
    case 'inactive':
      return 'Inactive';
    case 'discontinued':
      return 'Discontinued';
    default:
      return 'Unknown';
  }
}

function getImageUrl(images: string[], index: number = 0): string {
  if (images.length === 0 || index >= images.length) {
    return '/placeholder-product.svg';
  }
  return `/api/v1/uploads/${images[index]}`;
}

const PLACEHOLDER_IMAGE = '/placeholder-product.svg';

function handleImageError(event: React.SyntheticEvent<HTMLImageElement>) {
  const target = event.target as HTMLImageElement;
  const currentSrc = target.src;

  // Compare pathnames to avoid infinite loop (target.src returns absolute URL)
  const currentPathname = new URL(currentSrc, window.location.origin).pathname;
  const placeholderPathname = PLACEHOLDER_IMAGE;

  // Safeguard: prevent infinite retries if placeholder itself fails
  if (currentPathname !== placeholderPathname) {
    target.src = PLACEHOLDER_IMAGE;
  }
}

function ProductDetailContent() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { useAddItem } = useCartMutations();

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [showAddedMessage, setShowAddedMessage] = useState(false);

  const addItemMutation = useAddItem();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => productApi.getById(productId!),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!productId,
  });

  const product = data?.product;
  const isOutOfStock = !product || product.quantity === 0 || product.status === 'out_of_stock';
  const statusVariant = product ? getStatusVariant(product.status, product.quantity) : 'neutral';
  const statusLabel = product ? getStatusLabel(product.status, product.quantity) : 'Unknown';

  // Reset quantity when product changes - use useEffect to avoid render-time setState
  const maxQuantity = product?.quantity ?? 1;
  useEffect(() => {
    if (quantity > maxQuantity) {
      setQuantity(Math.max(1, maxQuantity));
    }
  }, [maxQuantity]);

  const handleIncrement = useCallback(() => {
    if (quantity < maxQuantity) {
      setQuantity((prev) => prev + 1);
    }
  }, [quantity, maxQuantity]);

  const handleDecrement = useCallback(() => {
    if (quantity > 1) {
      setQuantity((prev) => prev - 1);
    }
  }, [quantity]);

  const handleQuantityChange = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(value, maxQuantity));
    setQuantity(clamped);
  }, [maxQuantity]);

  const handleAddToCart = useCallback(async () => {
    if (!product || isOutOfStock) return;

    try {
      const input: CartItemInput = {
        productId: product.id,
        quantity,
      };
      await addItemMutation.mutateAsync(input);
      setShowAddedMessage(true);
      setTimeout(() => setShowAddedMessage(false), 2000);
    } catch (err) {
      console.error('Failed to add to cart:', err);
      // Error handling could be enhanced with a toast notification
    }
  }, [product, quantity, isOutOfStock, addItemMutation]);

  const handleBrowseProducts = useCallback(() => {
    navigate('/products');
  }, [navigate]);

  if (isLoading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-12" role="main">
        <div className="flex justify-center items-center min-h-[400px]" role="status" aria-live="polite">
          <Spinner size="lg" label="Loading product..." withStatusRole={true} />
        </div>
      </main>
    );
  }

  if (isError) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-12" role="main">
        <ErrorAlert
          title="Failed to Load Product"
          message={error?.message || 'An unexpected error occurred'}
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </main>
    );
  }

  if (!product) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-12" role="main">
        <EmptyState
          title="Product Not Found"
          description="The product you requested could not be found."
          icon={EmptyStateIcons.search}
          action={{
            label: 'Browse Products',
            onClick: handleBrowseProducts,
            variant: 'primary',
          }}
        />
      </main>
    );
  }

  const mainImageUrl = getImageUrl(product.images, selectedImageIndex);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8" role="main">
      <div className="mb-6">
        <NavLink
          to="/products"
          className="text-sm text-blue-600 hover:text-blue-800 focus:outline-none focus:underline"
        >
          ← Back to Products
        </NavLink>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Image Gallery - spans 1 column on mobile, 1 column on md+ (left side) */}
        <div className="md:col-span-1">
          <Card variant="bordered" padding="none" className="overflow-hidden">
            {/* Main Image */}
            <div className="aspect-square bg-gray-100 relative overflow-hidden">
              <img
                src={mainImageUrl}
                alt={product.name}
                className="w-full h-full object-cover transition-transform duration-300"
                loading="lazy"
                onError={handleImageError}
              />
              {product.images.length > 1 && (
                <div className="absolute bottom-2 left-2 right-2 flex justify-center gap-1">
                  {product.images.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setSelectedImageIndex(index)}
                      className={`w-2 h-2 rounded-full transition-all ${
                        index === selectedImageIndex
                          ? 'bg-white scale-125'
                          : 'bg-white/50 hover:bg-white/75'
                      }`}
                      aria-label={`View image ${index + 1}`}
                      aria-current={index === selectedImageIndex ? 'true' : 'false'}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Thumbnail Images */}
            {product.images.length > 1 && (
              <div className="p-4 border-t border-gray-200">
                <div className="grid grid-cols-4 gap-2" role="list" aria-label="Product thumbnails">
                  {product.images.map((_, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setSelectedImageIndex(index)}
                      className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${
                        index === selectedImageIndex
                          ? 'border-blue-500'
                          : 'border-transparent hover:border-gray-300'
                      }`}
                      aria-label={`Select image ${index + 1}`}
                      aria-current={index === selectedImageIndex ? 'true' : 'false'}
                    >
                      <img
                        src={getImageUrl(product.images, index)}
                        alt={`${product.name} - Image ${index + 1}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={handleImageError}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Product Details - spans 1 column on mobile, 2 columns on md+ (right side) */}
        <div className="md:col-span-2">
          <Card variant="bordered" padding="lg">
            {/* Vendor Info */}
            <div className="mb-4 text-sm text-gray-500">
              Sold by Vendor ID: {product.vendorId}
            </div>

            {/* Product Name */}
            <h1 className="text-3xl font-semibold text-gray-900 truncate mb-4" role="heading">
              {product.name}
            </h1>

            {/* Price */}
            <div className="mb-6">
              <span className="text-3xl font-bold text-gray-900">
                ${product.price.toFixed(2)}
              </span>
            </div>

            {/* Stock Status Badge */}
            <div className="mb-6">
              <Badge variant={statusVariant} size="md" dot>
                {statusLabel}
              </Badge>
            </div>

            {/* Description */}
            {product.description && product.description.trim() && (
              <div className="mb-6">
                <h2 className="text-lg font-medium text-gray-900 mb-2">Description</h2>
                <p className="text-gray-600 whitespace-pre-wrap">{product.description}</p>
              </div>
            )}

            {/* Quantity Selector & Add to Cart */}
            <div className="border-t border-gray-200 pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                {/* Quantity Selector */}
                <div className="flex items-center gap-3">
                  <label htmlFor="quantity" className="text-sm font-medium text-gray-700">
                    Qty:
                  </label>
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={handleDecrement}
                      disabled={quantity <= 1 || isOutOfStock}
                      className="px-4 py-2 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                      aria-label="Decrease quantity"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                      </svg>
                    </button>
                    <input
                      type="number"
                      id="quantity"
                      value={quantity}
                      onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
                      min={1}
                      max={maxQuantity}
                      disabled={isOutOfStock}
                      className="w-16 text-center border-x border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                      aria-label="Quantity"
                    />
                    <button
                      type="button"
                      onClick={handleIncrement}
                      disabled={quantity >= maxQuantity || isOutOfStock}
                      className="px-4 py-2 bg-gray-50 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                      aria-label="Increase quantity"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                  {maxQuantity > 0 && maxQuantity < 10 && (
                    <span className="text-sm text-gray-500">(max {maxQuantity})</span>
                  )}
                </div>

                {/* Add to Cart Button */}
                <div className="w-full sm:w-auto">
                  {isOutOfStock ? (
                    <Button
                      variant="secondary"
                      size="lg"
                      fullWidth={true}
                      disabled={true}
                      className="w-full sm:w-auto"
                    >
                      Out of Stock
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="lg"
                      fullWidth={true}
                      isLoading={addItemMutation.isPending}
                      loadingText={showAddedMessage ? 'Added!' : 'Adding...'}
                      onClick={handleAddToCart}
                      className="w-full sm:w-auto"
                    >
                      {showAddedMessage ? 'Added!' : 'Add to Cart'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}

export function ProductDetailPage() {
  return (
    <ErrorBoundary>
      <ProductDetailContent />
    </ErrorBoundary>
  );
}

export default ProductDetailPage;