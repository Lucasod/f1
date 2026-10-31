import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
      onSuccess: invalidateCart,
    });

  return {
    useAddItem,
    useUpdateQuantity,
    useRemoveItem,
    useMergeGuestCart,
  };
}