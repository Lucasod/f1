import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/providers/AuthProvider';
import { cartApi, Cart, CartItemInput, MergeGuestCartInput } from '@/shared/api/cart';

export function useCart() {
  return useQuery<{ cart: Cart }, Error>({
    queryKey: ['cart'],
    queryFn: () => cartApi.getCart(),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useCartMutations() {
  const queryClient = useQueryClient();

  const invalidateCart = () => {
    queryClient.invalidateQueries({ queryKey: ['cart'] });
  };

  const useAddItem = () =>
    useMutation<{ cart: Cart }, Error, CartItemInput>({
      mutationFn: (input) => cartApi.addItem(input),
      onSuccess: invalidateCart,
    });

  const useUpdateQuantity = () =>
    useMutation<{ cart: Cart }, Error, { productId: string; quantity: number }>({
      mutationFn: ({ productId, quantity }) => cartApi.updateItemQuantity(productId, { quantity }),
      onSuccess: invalidateCart,
    });

  const useRemoveItem = () =>
    useMutation<{ cart: Cart }, Error, string>({
      mutationFn: (productId) => cartApi.removeItem(productId),
      onSuccess: invalidateCart,
    });

  const useMergeGuestCart = () =>
    useMutation<{ cart: Cart }, Error, MergeGuestCartInput>({
      mutationFn: (input) => cartApi.mergeGuestCart(input),
      onSuccess: () => {
        // Clear guest cart ID after successful merge
        cartApi.clearGuestCartId();
        invalidateCart();
      },
    });

  return {
    useAddItem,
    useUpdateQuantity,
    useRemoveItem,
    useMergeGuestCart,
  };
}

/**
 * Hook to merge guest cart after user logs in.
 * Should be called when authentication state changes from unauthenticated to authenticated.
 */
export function useMergeGuestCartOnLogin() {
  const { isAuthenticated } = useAuth();
  const { useMergeGuestCart } = useCartMutations();
  const mergeGuestCartMutation = useMergeGuestCart();

  // This effect runs when user becomes authenticated
  // In practice, this should be triggered by the auth store's login/logout actions
  // For now, we expose the mutation for manual triggering
  const mergeIfNeeded = async () => {
    const guestCartId = localStorage.getItem('guestCartId');
    if (guestCartId && isAuthenticated) {
      await mergeGuestCartMutation.mutateAsync({ guestCartId });
    }
  };

  return {
    mergeIfNeeded,
    isMerging: mergeGuestCartMutation.isPending,
    mergeError: mergeGuestCartMutation.error,
  };
}