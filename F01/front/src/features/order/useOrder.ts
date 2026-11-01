import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  orderApi,
  OrderListParams,
  OrderListResponse,
  Order,
  OrderVendorGroup,
  OrderVendorGroupStatus,
  OrderStatus,
  VendorOrderGroupsParams,
  VendorOrderGroupsResponse,
} from '@/shared/api/order';

export function useOrders(filters: OrderListParams = {}) {
  return useQuery<OrderListResponse, Error>({
    queryKey: ['orders', filters],
    queryFn: () => orderApi.list(filters),
    staleTime: 2 * 60 * 1000, // 2 minutes
    placeholderData: (previousData) => previousData,
  });
}

export function useOrderDetail(orderId: string | null) {
  return useQuery<{ order: Order }, Error>({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => orderApi.getById(orderId!),
    enabled: !!orderId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    placeholderData: (previousData) => previousData,
  });
}

export function useVendorOrderGroups(filters: VendorOrderGroupsParams = {}) {
  return useQuery<VendorOrderGroupsResponse, Error>({
    queryKey: ['vendor', 'orders', filters],
    queryFn: () => orderApi.getVendorOrderGroups(filters),
    staleTime: 2 * 60 * 1000, // 2 minutes
    placeholderData: (previousData) => previousData,
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
    useMutation<{ vendorGroup: OrderVendorGroup }, Error, { orderId: string; ovgId: string; status: OrderVendorGroupStatus }>({
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

  return {
    useUpdateVendorGroupStatus,
    useUpdateOrderStatus,
  };
}