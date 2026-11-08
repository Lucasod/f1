import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { checkoutApi, CheckoutPreviewResponse, CheckoutInput, CheckoutResponse, CheckoutAttempt, CheckoutApiException, CouponSelection } from '@/shared/api/checkout';

/** No query cache stores acceptance/address data. Persist only retry identity, never the snapshot. */
export function useCheckoutAcceptance(context: string | null, addressId: string | null, selections: CouponSelection[]) {
  const [state, setState] = React.useState<{ context: string; attempt?: CheckoutAttempt; busy: boolean; error?: string }>({ context: '', busy: false });
  const generation = React.useRef(0);
  const activeContext = React.useRef(context);
  activeContext.current = context;
  const lock = React.useRef(false);
  React.useLayoutEffect(() => {
    generation.current++; lock.current = false;
    setState({ context: context ?? '', busy: false });
    return () => { generation.current++; };
  }, [context]);
  const run = async (operation: 'prepare' | 'accept' | 'reload') => {
    if (!context || !addressId || lock.current) return;
    lock.current = true;
    const version = generation.current;
    const current = state.context === context ? state.attempt : undefined;
    setState({ context, attempt: current, busy: true });
    try {
      let result: CheckoutAttempt;
      if (operation === 'prepare') {
        let stored: { context: string; requestId: string } | null = null;
        try { stored = JSON.parse(sessionStorage.getItem('checkout.acceptance.retry') ?? 'null'); } catch { /* invalid local metadata is not an acceptance */ }
        const requestId = stored?.context === context ? stored.requestId : crypto.randomUUID();
        // Storage must succeed BEFORE sending. Otherwise lost-response recovery is not reliable.
        sessionStorage.setItem('checkout.acceptance.retry', JSON.stringify({ context, requestId }));
        result = await checkoutApi.prepareAttempt({ requestId, shippingAddressId: addressId, couponSelections: selections });
      } else {
        if (!current) return;
        result = operation === 'accept' ? await checkoutApi.acceptAttempt(current) : await checkoutApi.getAttempt(current.id);
      }
      if (version === generation.current && activeContext.current === context) setState({ context, attempt: result, busy: false });
    } catch (error) {
      if (version !== generation.current || activeContext.current !== context) return;
      const changed = error instanceof CheckoutApiException && error.code === 'QUOTE_CHANGED';
      setState({ context, attempt: changed ? error.attempt : current, busy: false,
        error: changed ? 'Quote changed. Review the new proposal and explicitly accept again.' : 'Acceptance unavailable. Retry with the same request identity.' });
    } finally {
      if (version === generation.current) lock.current = false;
    }
  };
  const visible = context && state.context === context ? state : { busy: false, attempt: undefined, error: undefined };
  return { ...visible, prepare: () => run('prepare'), accept: () => run('accept'), reload: () => run('reload') };
}

export function useCheckoutPreview(couponCodes?: string[], enabled = true, cartKey?: string) {
  return useQuery<CheckoutPreviewResponse, Error>({
    queryKey: ['checkout', 'preview', couponCodes, cartKey],
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
