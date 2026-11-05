import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { CartItem } from '@/shared/api/cart';
import { Product } from '@/shared/api/product';
import { productApi } from '@/shared/api/product';

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
 * Debounce hook for quantity changes
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook to manage debounced quantities for multiple cart items.
 * Returns a record of debounced quantities keyed by productId.
 */
function useDebouncedQuantities(
  items: Array<{ productId: string; quantity: number }>,
  delay: number
): { debounced: Record<string, number>; setQuantity: (productId: string, quantity: number) => void } {
  // Create a stable key for the items to avoid infinite loops
  const itemsKey = useMemo(() => items.map((i) => `${i.productId}:${i.quantity}`).join(','), [items]);

  // Create a map of productId -> quantity for initial values
  const initialQuantities = useMemo(
    () => Object.fromEntries(items.map((item) => [item.productId, item.quantity])),
    [itemsKey]
  );

  // Use a single debounced object to avoid calling hooks in a loop
  const [debouncedQuantities, setDebouncedQuantities] = useState<Record<string, number>>(initialQuantities);

  // Update debounced quantities when items change (new items added/removed)
  useEffect(() => {
    setDebouncedQuantities((prev) => {
      const next = { ...prev };
      items.forEach((item) => {
        if (next[item.productId] === undefined) {
          next[item.productId] = item.quantity;
        }
      });
      // Remove quantities for items that no longer exist
      Object.keys(next).forEach((key) => {
        if (!items.some((item) => item.productId === key)) {
          delete next[key];
        }
      });
      return next;
    });
  }, [itemsKey]);

  // Debounce the quantities object
  const debounced = useDebounce(debouncedQuantities, delay);

  // Return a function to update a specific quantity
  const setQuantity = useCallback((productId: string, quantity: number) => {
    setDebouncedQuantities((prev) => ({ ...prev, [productId]: quantity }));
  }, []);

  return { debounced, setQuantity };
}

/**
 * Cart item with product details for display
 */
interface CartItemWithProduct extends CartItem {
  product?: Product | null;
  productLoading: boolean;
  productError: string | null;
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

export function CartPage() {
  const navigate = useNavigate();
  const { data: cartData, isLoading: cartLoading, error: cartError, refetch: refetchCart } = useCart();
  const { useUpdateQuantity, useRemoveItem } = useCartMutations();

  // State for product details
  const [itemsWithProducts, setItemsWithProducts] = useState<CartItemWithProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{ productId: string; itemName: string } | null>(null);
  const [quantityErrors, setQuantityErrors] = useState<Record<string, string>>({});

  // Mutations
  const updateQuantityMutation = useUpdateQuantity();
  const removeItemMutation = useRemoveItem();

  // Stable reference for items passed to debounced quantities hook
  const debouncedItems = useMemo(
    () => itemsWithProducts.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    [itemsWithProducts]
  );

  // Debounced quantities for each item - using custom hook to avoid calling hooks in loop
  const { debounced: debouncedQuantities, setQuantity: setDebouncedQuantity } = useDebouncedQuantities(
    debouncedItems,
    500
  );

  // Fetch product details for cart items
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
            ? { ...i, product, productLoading: false, productError: product ? null : 'Produto não encontrado' }
            : i
        )
      );
    });

    setProductsLoading(false);
  }, [cartData?.cart?.items]);

  // Handle quantity change with debounce
  const handleQuantityChange = useCallback(
    (productId: string, newQuantity: number) => {
      // Validate minimum
      if (newQuantity < 1) return;

      // Find item to check max stock
      const item = itemsWithProducts.find((i) => i.productId === productId);
      const maxStock = item?.product?.quantity;

      if (maxStock !== undefined && newQuantity > maxStock) {
        setQuantityErrors((prev) => ({
          ...prev,
          [productId]: `Maximum stock: ${maxStock}`,
        }));
        return;
      }

      // Clear error for this item
      setQuantityErrors((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });

      // Update debounced quantity locally for immediate UI feedback
      setDebouncedQuantity(productId, newQuantity);

      // Debounced mutation
      updateQuantityMutation.mutate({ productId, quantity: newQuantity }, {
        onError: (error) => {
          setQuantityErrors((prev) => ({
            ...prev,
            [productId]: error.message || 'Erro ao atualizar quantidade',
          }));
        },
      });
    },
    [itemsWithProducts, updateQuantityMutation, setDebouncedQuantity]
  );

  // Handle remove item
  const handleRemoveClick = useCallback((productId: string, itemName: string) => {
    setRemoveConfirm({ productId, itemName });
  }, []);

  const handleRemoveConfirm = useCallback(() => {
    if (removeConfirm) {
      removeItemMutation.mutate(removeConfirm.productId, {
        onError: (error) => {
          // Could show toast/error alert
          console.error('Failed to remove item:', error);
        },
      });
      setRemoveConfirm(null);
    }
  }, [removeConfirm, removeItemMutation]);

  const handleRemoveCancel = useCallback(() => {
    setRemoveConfirm(null);
  }, []);

  // Calculate totals
  const subtotal = itemsWithProducts.reduce((sum, item) => {
    const quantity = debouncedQuantities[item.productId] ?? item.quantity;
    return sum + quantity * item.unitPrice;
  }, 0);

  const isCartEmpty = itemsWithProducts.length === 0;

  // Loading state
  if (cartLoading || productsLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <Spinner size="lg" label="Carregando carrinho" withStatusRole />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (cartError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ErrorAlert
            message="Could not load cart. Try again."
            title="Erro ao carregar carrinho"
            variant="error"
            action={{
              label: 'Tentar novamente',
              onClick: () => refetchCart(),
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
          <EmptyState
            icon={EmptyStateIcons.cart}
            title="Your cart is empty"
            description="Add products to your cart to start shopping."
            action={{
              label: 'Continuar comprando',
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
          <h1 className="text-3xl font-bold text-gray-900">Carrinho de Compras</h1>
          <p className="mt-1 text-gray-600">
            {itemsWithProducts.length} item{itemsWithProducts.length !== 1 ? 's' : ''} no carrinho
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Cart Items */}
          <div className="lg:col-span-2">
            <Card variant="bordered" padding="none">
              <div className="divide-y divide-gray-200">
                {itemsWithProducts.map((item) => {
                  const product = item.product;
                  const quantity = debouncedQuantities[item.productId] ?? item.quantity;
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
                            src={product.images[0]}
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
                                {product?.name || `Produto ${item.productId.slice(0, 8)}...`}
                              </h3>
                              <p className="text-sm text-gray-500 mt-1">
                                Vendido por: <span className="font-medium">{product?.vendorId || item.vendorId}</span>
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
                            value={quantity}
                            onChange={(e) => {
                              const value = parseInt(e.target.value, 10) || 1;
                              handleQuantityChange(item.productId, value);
                            }}
                            error={quantityError}
                            aria-label={`Quantidade de ${product?.name || 'produto'}`}
                            className="text-center"
                            disabled={updateQuantityMutation.isPending}
                          />
                          {maxStock !== undefined && (
                            <p className="text-xs text-gray-500 mt-1 text-center">
                              Estoque: {maxStock}
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
                            onClick={() => handleRemoveClick(item.productId, product?.name || 'este item')}
                            disabled={removeItemMutation.isPending}
                            aria-label={`Remover ${product?.name || 'item'} do carrinho`}
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
                            <span className="sr-only">Remover</span>
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
                <CardTitle as="h2">Resumo do Pedido</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium text-gray-900">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Frete</span>
                  <span className="font-medium text-gray-900">Calculado no checkout</span>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex justify-between text-base">
                    <span className="font-semibold text-gray-900">Total</span>
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
                  disabled={isCartEmpty || updateQuantityMutation.isPending || removeItemMutation.isPending}
                  onClick={() => navigate('/checkout')}
                >
                  Ir para o Checkout
                </Button>
                <Button
                  fullWidth
                  variant="ghost"
                  onClick={() => navigate('/products')}
                >
                  Continuar comprando
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
        title="Remover item do carrinho"
        message={`Tem certeza que deseja remover "${removeConfirm?.itemName}" do carrinho?`}
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        variant="danger"
        isLoading={removeItemMutation.isPending}
      />
    </div>
  );
}