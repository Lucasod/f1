import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  orderApi,
  OrderListParams,
  OrderListResponse,
  Order,
  OrderVendorGroupStatus,
  OrderStatus,
  VendorOrderGroupsParams,
  VendorOrderGroupsResponse,
} from '@/shared/api/order';
import { useAuthStore, type User } from '@/app/providers/authStore';

export function getOrderQueryScope(user: Pick<User, 'id' | 'roles'> | null | undefined): string {
  return user ? JSON.stringify([user.id, [...user.roles].sort()]) : 'anonymous';
}

export function useOrders(filters: OrderListParams = {}) {
  const user = useAuthStore(state => state.user);

  return useQuery<OrderListResponse, Error>({
    queryKey: ['orders', getOrderQueryScope(user), filters],
    queryFn: () => orderApi.list(filters),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useOrderDetail(orderId: string | null) {
  const user = useAuthStore(state => state.user);

  return useQuery<{ order: Order }, Error>({
    queryKey: ['orders', 'detail', orderId, getOrderQueryScope(user)],
    queryFn: () => orderApi.getById(orderId!),
    enabled: !!orderId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useVendorOrderGroups(filters: VendorOrderGroupsParams = {}) {
  const user = useAuthStore(state => state.user);

  return useQuery<VendorOrderGroupsResponse, Error>({
    queryKey: ['vendor', 'orders', getOrderQueryScope(user), filters],
    queryFn: () => orderApi.getVendorOrderGroups(filters),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useOrderMutations() {
  const queryClient = useQueryClient();

  const invalidateOrders = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const invalidateVendorOrders = () => {
    queryClient.invalidateQueries({ queryKey: ['vendor', 'orders'] });
  };

  const invalidateOrderDetail = (orderId: string) => {
    queryClient.invalidateQueries({ queryKey: ['orders', 'detail', orderId] });
  };

  const useUpdateVendorGroupStatus = () =>
    useMutation<{ order: Order }, Error, { orderId: string; ovgId: string; status: OrderVendorGroupStatus }>({
      mutationFn: ({ orderId, ovgId, status }) => orderApi.updateVendorGroupStatus(orderId, ovgId, status),
      onSuccess: (_data, variables) => {
        invalidateVendorOrders();
        invalidateOrderDetail(variables.orderId);
      },
    });

  const useUpdateOrderStatus = () =>
    useMutation<{ order: Order }, Error, { orderId: string; status: OrderStatus }>({
      mutationFn: ({ orderId, status }) => orderApi.updateOrderStatus(orderId, status),
      onSuccess: (_data, variables) => {
        invalidateOrders();
        invalidateOrderDetail(variables.orderId);
      },
    });

  const useAddOrderComment = () =>
    useMutation<Order, Error, { orderId: string; comment: string }>({
      mutationFn: ({ orderId, comment }) => orderApi.addOrderComment(orderId, comment),
      onSuccess: (_data, variables) => {
        invalidateOrderDetail(variables.orderId);
      },
    });

  return {
    useUpdateVendorGroupStatus,
    useUpdateOrderStatus,
    useAddOrderComment,
  };
}