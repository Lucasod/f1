import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { checkoutApi, CheckoutPreviewResponse, CheckoutInput, CheckoutResponse } from '@/shared/api/checkout';

export function useCheckoutPreview(couponCodes?: string[], enabled = true) {
  return useQuery<CheckoutPreviewResponse, Error>({
    queryKey: ['checkout', 'preview', couponCodes],
    queryFn: () => checkoutApi.preview(couponCodes),
    enabled: enabled,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useCheckoutMutations() {
  const queryClient = useQueryClient();

  const invalidateCart = () => {
    queryClient.invalidateQueries({ queryKey: ['cart'] });
  };

  const useCheckout = () =>
    useMutation<CheckoutResponse, Error, CheckoutInput>({
      mutationFn: (input) => checkoutApi.checkout(input),
      onSuccess: invalidateCart,
    });

  return {
    useCheckout,
  };
}

interface CheckoutState {
  couponCodes: string[];
  selectedAddressId: string | null;
  paymentMethod: string | null;
}

interface UseCheckoutStateReturn extends CheckoutState {
  setCouponCodes: (codes: string[]) => void;
  addCouponCode: (code: string) => void;
  removeCouponCode: (code: string) => void;
  clearCouponCodes: () => void;
  setSelectedAddressId: (addressId: string | null) => void;
  setPaymentMethod: (method: string | null) => void;
  reset: () => void;
}

export function useCheckoutState(): UseCheckoutStateReturn {
  const [state, setState] = React.useState<CheckoutState>({
    couponCodes: [],
    selectedAddressId: null,
    paymentMethod: null,
  });

  const setCouponCodes = React.useCallback((codes: string[]) => {
    setState((prev) => ({ ...prev, couponCodes: codes }));
  }, []);

  const addCouponCode = React.useCallback((code: string) => {
    setState((prev) => {
      if (prev.couponCodes.includes(code)) return prev;
      return { ...prev, couponCodes: [...prev.couponCodes, code] };
    });
  }, []);

  const removeCouponCode = React.useCallback((code: string) => {
    setState((prev) => ({
      ...prev,
      couponCodes: prev.couponCodes.filter((c) => c !== code),
    }));
  }, []);

  const clearCouponCodes = React.useCallback(() => {
    setState((prev) => ({ ...prev, couponCodes: [] }));
  }, []);

  const setSelectedAddressId = React.useCallback((addressId: string | null) => {
    setState((prev) => ({ ...prev, selectedAddressId: addressId }));
  }, []);

  const setPaymentMethod = React.useCallback((method: string | null) => {
    setState((prev) => ({ ...prev, paymentMethod: method }));
  }, []);

  const reset = React.useCallback(() => {
    setState({
      couponCodes: [],
      selectedAddressId: null,
      paymentMethod: null,
    });
  }, []);

  return {
    ...state,
    setCouponCodes,
    addCouponCode,
    removeCouponCode,
    clearCouponCodes,
    setSelectedAddressId,
    setPaymentMethod,
    reset,
  };
}