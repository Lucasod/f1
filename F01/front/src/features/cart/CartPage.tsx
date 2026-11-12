import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart, useCartMutations } from './useCart';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { ConfirmDialog } from '@/components/ui/Modal';
import { CartApiException, CartItem } from '@/shared/api/cart';
import { Product } from '@/shared/api/product';
import { productApi } from '@/shared/api/product';

/**
 * Format currency in USD (English locale)
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/**
 * Cart item with product details for display
 */
interface CartItemWithProduct extends CartItem {
  product?: Product | null;
  productLoading: boolean;
  productError: string | null;
}

// These route/service rejections happen before calling the cart repository.
// Repository-level errors are excluded: legacy recovery can write before rejection.
function isPreWriteRejection(error: unknown, operation: 'update' | 'remove'): boolean {
  if (!(error instanceof CartApiException)) return false;
  if (error.status === 400 && (error.code === 'PRODUCT_ID_REQUIRED' || error.code === 'GUEST_CART_ID_INVALID')) return true;
  return operation === 'update' && (
    (error.status === 400 && error.code === 'INVALID_QUANTITY') ||
    (error.status === 404 && error.code === 'PRODUCT_NOT_FOUND') ||
    (error.status === 409 && error.code === 'PRODUCT_NOT_AVAILABLE')
  );
}

/**
 * Fetch product details for a cart item
 */
async function fetchProductDetails(productId: string): Promise<Product | null> {
  try {
    const response = await productApi.getById(productId);
    return response.product;
  } catch {
    return null;
  }
}

/**
 * Ensures an image reference resolves to a full URL usable as an `` src.
 * Bare S3 keys (e.g. "products/{vendorId}/{productId}/main.webp") are prefixed
 * with the uploads endpoint so they load correctly. Already-full URLs (starting
 * with "/" or "http") are returned as-is.
 */
function toImageUrl(imageRef: string | undefined): string | undefined {
  if (!imageRef) return undefined;
  if (imageRef.startsWith('/') || imageRef.startsWith('http')) return imageRef;
  return `/api/v1/uploads/${imageRef}`;
}

export function CartPage() {
  const navigate = useNavigate();
  const { data: cartData, isLoading: cartLoading, error: cartError, refetch: refetchCart } = useCart();
  const { useUpdateQuantity, useRemoveItem } = useCartMutations();

  // State for product details
  const [itemsWithProducts, setItemsWithProducts] = useState<CartItemWithProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{ productId: string; itemName: string } | null>(null);
  const [quantityErrors, setQuantityErrors] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [unconfirmed, setUnconfirmed] = useState<'write' | 'read' | null>(null);
  const [processing, setProcessing] = useState(false);
  const busy = useRef(false);

  // Mutations
  const updateQuantityMutation = useUpdateQuantity();
  const removeItemMutation = useRemoveItem();

  // Fetch product details for cart items
  useEffect(() => {
    if (!cartData?.cart) return;
    const ids = new Set(cartData.cart.items.map((item) => item.productId));
    const retainCurrent = (entries: Record<string, string>) =>
      Object.fromEntries(Object.entries(entries).filter(([id]) => ids.has(id)));
    setDrafts(retainCurrent);
    setQuantityErrors(retainCurrent);
  }, [cartData?.cart?.items]);

  useEffect(() => {
    if (!cartData?.cart?.items?.length) {
      setItemsWithProducts([]);
      return;
    }

    const items = cartData.cart.items;
    setProductsLoading(true);

    const initialItems: CartItemWithProduct[] = items.map((item) => ({
      ...item,
      product: undefined,
      productLoading: true,
      productError: null,
    }));
    setItemsWithProducts(initialItems);

    // Fetch product details for each item
    items.forEach(async (item) => {
      const product = await fetchProductDetails(item.productId);
      setItemsWithProducts((prev) =>
        prev.map((i) =>
          i.productId === item.productId
            ? { ...i, product, productLoading: false, productError: product ? null : 'Product not found' }
            : i
        )
      );
    });

    setProductsLoading(false);
  }, [cartData?.cart?.items]);

  const reconcile = useCallback(async (uncertainWrite: boolean) => {
    try {
      await refetchCart({ throwOnError: true });
      setUnconfirmed(uncertainWrite ? 'write' : null);
    } catch {
      setUnconfirmed(uncertainWrite ? 'write' : 'read');
    }
  }, [refetchCart]);

  const retryRead = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProcessing(true);
    try { await reconcile(unconfirmed === 'write'); }
    finally { busy.current = false; setProcessing(false); }
  }, [reconcile, unconfirmed]);

  const handleQuantityChange = useCallback(
    async (productId: string, draft: string) => {
      const item = itemsWithProducts.find((i) => i.productId === productId);
      if (!item) return;
      const newQuantity = Number(draft);
      const maxStock = item?.product?.quantity;
      if (!Number.isSafeInteger(newQuantity) || newQuantity < 1 || (maxStock !== undefined && newQuantity > maxStock)) {
        setQuantityErrors((prev) => ({
          ...prev,
          [productId]: maxStock !== undefined ? `Enter a quantity between 1 and ${maxStock}.` : 'Enter a valid quantity.',
        }));
        return;
      }
      setQuantityErrors((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });

      if (newQuantity !== item.quantity) {
        if (busy.current) return;
        busy.current = true;
        setProcessing(true);
        let uncertainWrite = false;
        try {
          await updateQuantityMutation.mutateAsync({ productId, quantity: newQuantity });
          setNotice('');
        } catch (error) {
          uncertainWrite = !isPreWriteRejection(error, 'update');
          setNotice(uncertainWrite ? 'Could not confirm the update.' : 'The update was rejected.');
        }
        try { await reconcile(uncertainWrite); }
        finally { busy.current = false; setProcessing(false); }
      }
      setDrafts((prev) => { const next = { ...prev }; delete next[productId]; return next; });
    },
    [itemsWithProducts, updateQuantityMutation, reconcile]
  );

  // Handle remove item
  const handleRemoveClick = useCallback((productId: string, itemName: string) => {
    setRemoveConfirm({ productId, itemName });
  }, []);

  const handleRemoveConfirm = useCallback(async () => {
    if (removeConfirm) {
      if (busy.current) return;
      busy.current = true;
      setProcessing(true);
      const productId = removeConfirm.productId;
      setRemoveConfirm(null);
      let uncertainWrite = false;
      try {
        await removeItemMutation.mutateAsync(productId);
        setNotice('');
      } catch (error) {
        uncertainWrite = !isPreWriteRejection(error, 'remove');
        setNotice(uncertainWrite ? 'Could not confirm the removal.' : 'The removal was rejected.');
      }
      try { await reconcile(uncertainWrite); }
      finally { busy.current = false; setProcessing(false); }
    }
  }, [removeConfirm, removeItemMutation, reconcile]);

  const handleRemoveCancel = useCallback(() => {
    setRemoveConfirm(null);
  }, []);

  // Calculate totals
  const subtotal = itemsWithProducts.reduce((sum, item) => {
    return sum + item.quantity * item.unitPrice;
  }, 0);

  const isCartEmpty = itemsWithProducts.length === 0;

  // Loading state
  if (processing || cartLoading || productsLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" label={processing ? 'Processing cart' : 'Loading cart'} withStatusRole />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (unconfirmed || (cartError && !cartData)) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ErrorAlert
            message={unconfirmed === 'write' ? `${notice} Cart unconfirmed. Another read cannot guarantee the operation has finished.` : unconfirmed ? 'Cart unconfirmed. Check again before continuing.' : 'Could not load cart. Try again.'}
            title="Cart unavailable"
            variant="error"
            action={{
              label: 'Try again',
              onClick: () => { void retryRead(); },
            }}
            role="alert"
          />
        </div>
      </div>
    );
  }

  // Empty cart state
  if (isCartEmpty) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {notice && <p role="alert">{notice}</p>}
          <EmptyState
            icon={EmptyStateIcons.cart}
            title="Your cart is empty"
            description="Add products to your cart to start shopping."
            action={{
              label: 'Continue shopping',
              onClick: () => navigate('/products'),
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Shopping cart</h1>
          <p className="mt-1 text-gray-600">
            {itemsWithProducts.length} item{itemsWithProducts.length !== 1 ? 's' : ''} in cart
          </p>
        </div>
        {notice && <p role="alert">{notice}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <Card variant="bordered" padding="none">
              <div className="divide-y divide-gray-200">
                {itemsWithProducts.map((item) => {
                  const product = item.product;
                  const quantity = item.quantity;
                  const lineTotal = quantity * item.unitPrice;
                  const quantityError = quantityErrors[item.productId];
                  const maxStock = product?.quantity;
                  const isProductLoading = item.productLoading;
                  const productError = item.productError;

                  return (
                    <div
                      key={item.productId}
                      className="p-6 flex flex-col sm:flex-row sm:items-center gap-4"
                    >
                      {/* Product Image */}
                      <div className="flex-shrink-0 w-24 h-24 sm:w-32 sm:h-32 relative">
                        {isProductLoading ? (
                          <div className="w-full h-full bg-gray-100 rounded-lg animate-pulse" aria-hidden="true" />
                        ) : product?.images?.[0] ? (
                          <img
                            src={toImageUrl(product?.images?.[0])}
                            alt={product.name}
                            className="w-full h-full object-cover rounded-lg"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-100 rounded-lg flex items-center justify-center">
                            <svg
                              className="w-12 h-12 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                          </div>
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="min-w-0">
                          {productError ? (
                            <p className="text-sm text-red-600" role="alert">{productError}</p>
                          ) : (
                            <>
                              <h3 className="font-medium text-gray-900 truncate">
                                {product?.name || `Product ${item.productId.slice(0, 8)}...`}
                              </h3>
                              <p className="text-sm text-gray-500 mt-1">
                                Sold by: <span className="font-medium">{product?.vendorId || item.vendorId}</span>
                              </p>
                              <p className="text-sm text-gray-500">
                                {formatCurrency(item.unitPrice)} / un
                              </p>
                            </>
                          )}
                        </div>

                        {/* Quantity Selector */}
                        <div className="w-full sm:w-48">
                          <Input
                            id={`quantity-${item.productId}`}
                            type="number"
                            min={1}
                            max={maxStock}
                            value={drafts[item.productId] ?? quantity}
                            onChange={(e) => {
                              setDrafts((prev) => ({ ...prev, [item.productId]: e.target.value }));
                            }}
                            onBlur={(e) => { if (drafts[item.productId] !== undefined) void handleQuantityChange(item.productId, e.currentTarget.value); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                              if (e.key === 'Escape') {
                                setDrafts((prev) => { const next = { ...prev }; delete next[item.productId]; return next; });
                                setQuantityErrors((prev) => { const next = { ...prev }; delete next[item.productId]; return next; });
                              }
                            }}
                            error={quantityError}
                            aria-label={`Quantity of ${product?.name || 'product'}`}
                            className="text-center"
                            disabled={updateQuantityMutation.isPending || removeItemMutation.isPending || processing}
                          />
                          <p className="text-xs text-gray-500">Press Enter or leave the field to confirm. Escape cancels.</p>
                          {maxStock !== undefined && (
                            <p className="text-xs text-gray-500 mt-1 text-center">
                              Stock: {maxStock}
                            </p>
                          )}
                        </div>

                        {/* Line Total */}
                        <div className="w-full sm:w-32 text-right sm:text-left">
                          <p className="font-semibold text-gray-900">
                            {formatCurrency(lineTotal)}
                          </p>
                        </div>

                        {/* Remove Button */}
                        <div className="w-full sm:w-auto">
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleRemoveClick(item.productId, product?.name || 'this item')}
                            disabled={removeItemMutation.isPending || updateQuantityMutation.isPending || processing || Object.keys(drafts).length > 0}
                            aria-label={`Remove ${product?.name || 'item'} from cart`}
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                            <span className="sr-only">Remove</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Order Summary Sidebar */}
          <div className="lg:col-span-1">
            <Card variant="elevated" padding="md" className="sticky top-24">
              <CardHeader>
                <CardTitle as="h2">Order summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium text-gray-900">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Shipping</span>
                  <span className="font-medium text-gray-900">Calculated at checkout</span>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex justify-between text-base">
                    <span className="font-semibold text-gray-900">Partial estimate excluding shipping</span>
                    <span className="font-bold text-gray-900 text-lg">
                      {formatCurrency(subtotal)}
                    </span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-3 pt-6 border-t border-gray-200">
                <Button
                  fullWidth
                  size="lg"
                  variant="primary"
                  disabled={isCartEmpty || updateQuantityMutation.isPending || removeItemMutation.isPending || processing || !!unconfirmed || Object.keys(drafts).length > 0}
                  onClick={() => navigate('/checkout')}
                >
                  Proceed to checkout
                </Button>
                <Button
                  fullWidth
                  variant="ghost"
                  disabled={Object.keys(drafts).length > 0 || processing || updateQuantityMutation.isPending || removeItemMutation.isPending}
                  onClick={() => navigate('/products')}
                >
                  Continue shopping
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>

      {/* Remove Item Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!removeConfirm}
        onClose={handleRemoveCancel}
        onConfirm={handleRemoveConfirm}
        title="Remove item from cart"
        message={`Are you sure you want to remove "${removeConfirm?.itemName}" from your cart?`}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={removeItemMutation.isPending}
      />
    </div>
  );
}
