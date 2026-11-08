import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthProvider';
import { useCart } from '@/features/cart/useCart';
import { useCheckoutPreview, useCheckoutState, useCheckoutAcceptance } from './useCheckout';
import { checkoutApi, CheckoutPreviewVendorGroup, CheckoutPreviewItem, CheckoutPreviewResponse, CouponSelection } from '@/shared/api/checkout';
import { Address } from '@/shared/api/order';
import { personApi } from '@/shared/api/person';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  CardDescription,
} from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState, EmptyStateIcons } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { Badge } from '@/components/ui/Badge';

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
 * RadioGroup component for accessible radio button groups
 */
interface RadioGroupOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface RadioGroupProps {
  name: string;
  label: string;
  options: RadioGroupOption[];
  value: string | null;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | undefined;
  orientation?: 'vertical' | 'horizontal';
}

function RadioGroup({
  name,
  label,
  options,
  value,
  onChange,
  required,
  error,
  orientation = 'vertical',
}: RadioGroupProps) {
  const errorId = error ? `${name}-error` : undefined;
  const describedBy = errorId ? `${name}-label ${errorId}` : `${name}-label`;

  return (
    <fieldset className="w-full" aria-describedby={describedBy}>
      <legend id={`${name}-label`} className="block text-sm font-medium text-gray-700 mb-3">
        {label}
        {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
      </legend>
      <div
        className={`${orientation === 'horizontal' ? 'flex flex-wrap gap-4' : 'space-y-3'}`}
        role="radiogroup"
        aria-label={label}
        aria-required={required}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={`
              flex items-start gap-3 cursor-pointer transition-colors
              ${orientation === 'horizontal' ? 'flex-1 min-w-[200px]' : ''}
              ${option.disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => !option.disabled && onChange(option.value)}
              disabled={option.disabled}
              className={`
                mt-1 h-4 w-4 text-blue-600 border-gray-300
                focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                disabled:opacity-50
              `}
              aria-describedby={option.description ? `${name}-desc-${option.value}` : undefined}
            />
            <div className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-gray-900">
                {option.label}
              </span>
              {option.description && (
                <p
                  id={`${name}-desc-${option.value}`}
                  className="mt-0.5 text-sm text-gray-500"
                >
                  {option.description}
                </p>
              )}
            </div>
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Fetch user addresses from API
 */
async function fetchUserAddresses(): Promise<Address[]> {
  const { person } = await personApi.getMe();
  return person.addresses;
}

interface CheckoutStep {
  id: string;
  title: string;
  description: string;
}

const CHECKOUT_STEPS: CheckoutStep[] = [
  { id: 'address', title: 'Endereço', description: 'Selecione o endereço de entrega' },
  { id: 'coupon', title: 'Cupom', description: 'Aplique cupons de desconto' },
  { id: 'summary', title: 'Resumo', description: 'Revise seu pedido' },
  { id: 'payment', title: 'Pagamento', description: 'Escolha a forma de pagamento' },
];

export function CheckoutPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: cartData, isLoading: cartLoading, error: cartError, refetch: refetchCart } = useCart();
  const items = cartData?.cart?.items || [];
  const cartKey = JSON.stringify([user?.id, isAuthenticated, cartData?.cart?.id, cartData?.cart?.version, items.map(i => [i.productId, i.vendorId, i.quantity, i.unitPrice]).sort()]);
  const currentCartKey = useRef(cartKey);
  currentCartKey.current = cartKey;
  const quoteRequest = useRef(0);
  const [quote, setQuote] = useState<{ data: CheckoutPreviewResponse; selections: CouponSelection[]; cartKey: string } | null>(null);
  const [couponVendor, setCouponVendor] = useState('');
  
  // Checkout state
  const {
    couponCodes,
    selectedAddressId,
    paymentMethod,
    setSelectedAddressId,
    setPaymentMethod,
   } = useCheckoutState();

  // Checkout preview (totals with coupons)
  const {
    data: previewData,
    isLoading: previewLoading,
    error: previewError,
    refetch: refetchPreview,
  } = useCheckoutPreview(undefined, items.length > 0 && isAuthenticated, cartKey);

  const quoteSourceError = !!cartError || !!previewError;
  const confirmedQuote = !quoteSourceError && quote?.cartKey === cartKey ? quote : null;

  // Addresses
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressesError, setAddressesError] = useState<string | null>(null);
  const acceptanceContext = confirmedQuote && selectedAddressId && !addressesError && isAuthenticated
    ? JSON.stringify([cartKey, selectedAddressId, [...confirmedQuote.selections].sort((a, b) => a.vendorId.localeCompare(b.vendorId))]) : null;
  const acceptance = useCheckoutAcceptance(acceptanceContext, selectedAddressId, confirmedQuote?.selections ?? []);
  const acceptanceSnapshot = acceptance.attempt?.acceptedSnapshot ?? acceptance.attempt?.proposedSnapshot;

  // Coupon input
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | undefined>(undefined);
  const [applyingCoupon, setApplyingCoupon] = useState(false);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLock = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch addresses when authenticated
  const loadAddresses = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setAddresses([]);
      setAddressesLoading(false);
      return;
    }
    setAddressesLoading(true);
    setAddressesError(null);
    try {
      const data = await fetchUserAddresses();
      setAddresses(data);
    } catch {
      setAddressesError('Não foi possível carregar os endereços');
    } finally {
      setAddressesLoading(false);
    }
  }, [isAuthenticated, user]);

  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

  // Invalidate at commit, before pending promise callbacks can publish a stale quote.
  // Recovery with the same cart key must not revive a quote from before the error.
  useLayoutEffect(() => {
    quoteRequest.current++;
    setQuote(null);
    setCouponError(undefined);
    setApplyingCoupon(false);
  }, [cartKey, quoteSourceError]);

  // Handle coupon apply
  const handleApplyCoupon = useCallback(async () => {
    if (quoteSourceError) return;
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    if (!couponVendor) { setCouponError('Select a coupon vendor'); return; }
    const selections = [...(confirmedQuote?.selections.filter(s => s.vendorId !== couponVendor) ?? []), { vendorId: couponVendor, code }];
    const requestId = ++quoteRequest.current;
    const requestedCart = cartKey;
    setQuote(null);
    
    setApplyingCoupon(true);
    setCouponError(undefined);
    
    try {
      const data = await checkoutApi.preview(undefined, selections);
      if (requestId !== quoteRequest.current || currentCartKey.current !== requestedCart) return;
      if (data?.purchasable !== false || data.calculationVersion !== 'coupon-quote-v1' || !selections.every(s => data.vendorGroups.some(g => g.id === s.vendorId && g.coupon?.code === s.code))) throw new Error('Invalid coupon quote');
      setQuote({ data, selections, cartKey: requestedCart });
      setCouponInput('');
    } catch (error) {
      if (requestId !== quoteRequest.current || currentCartKey.current !== requestedCart) return;
      setQuote(null);
      const message = error instanceof Error ? error.message : 'Invalid coupon';
      setCouponError(message);
    } finally {
      if (requestId === quoteRequest.current) setApplyingCoupon(false);
    }
  }, [couponInput, couponVendor, confirmedQuote, cartKey, quoteSourceError]);

  // Handle remove coupon
  const handleRemoveCoupon = useCallback(() => {
    quoteRequest.current++;
    setQuote(null);
    setApplyingCoupon(false);
    setCouponError(undefined);
    refetchPreview();
  }, [refetchPreview]);

  // Validate form before submit
  const validateForm = useCallback((): boolean => {
    if (!selectedAddressId) {
      setSubmitError('Select delivery address');
      return false;
    }
    if (!paymentMethod) {
      setSubmitError('Select payment method');
      return false;
    }
    setSubmitError(null);
    return true;
  }, [selectedAddressId, paymentMethod]);

  // Calculate subtotal from cart items
  const isCartEmpty = items.length === 0;

  // Preview data
  const preview = quoteSourceError ? undefined : confirmedQuote?.data ?? previewData;
  const vendorGroups: CheckoutPreviewVendorGroup[] = preview?.vendorGroups || [];
  const totalAmount = preview?.totalAmount ?? 0;
  const previewSubtotal = vendorGroups.reduce((sum, vg) => sum + vg.subtotal, 0);
  const subtotal = preview
    ? vendorGroups.reduce((sum, group) => sum + group.items.reduce((itemSum, item) => itemSum + item.totalPrice, 0), 0)
    : items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountAmount = preview?.discountAmount ?? 0;
  const shippingAmount = preview ? totalAmount - previewSubtotal : 0;
  const unavailablePreviewLabel = previewLoading && !previewError ? 'Calculating...' : 'Unavailable';

  // Address options for radio group
  const addressOptions = useMemo(() => addresses.map((addr) => ({
    value: addr.id,
    label: `${addr.street}, ${addr.number}${addr.neighborhood ? ` - ${addr.neighborhood}` : ''}`,
    description: `${addr.city} - ${addr.state} ${addr.isPrimary ? '(Principal)' : ''}`,
  })), [addresses]);

  // Payment options
  const paymentOptions = useMemo(() => [
    { value: 'stripe_checkout', label: 'Pagamento seguro via Stripe', description: 'You will be redirected to complete payment' },
  ], []);

  const canSubmit = selectedAddressId && paymentMethod && !isSubmitting && !!preview && !confirmedQuote && !applyingCoupon && preview.purchasable !== false;

  // Handle checkout submit
  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return; // Double-click prevention
    if (applyingCoupon || preview?.purchasable === false) { setSubmitError('Discounted checkout is not available. This is a quote only.'); return; }
    if (!validateForm()) return;
    if (!preview) {
      setSubmitError('Order preview unavailable');
      return;
    }

    if (submitLock.current) return;
    submitLock.current = true;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const response = await checkoutApi.checkout({
        shippingAddressId: selectedAddressId!,
        couponCodes: couponCodes.length > 0 ? couponCodes : undefined,
      });
      window.open(response.checkoutUrl, '_self');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao finalizar pedido';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
      submitLock.current = false;
    }
  }, [isSubmitting, validateForm, preview, selectedAddressId, couponCodes, confirmedQuote, applyingCoupon]);

  // Loading state
  const isInitialLoading = authLoading || cartLoading || addressesLoading;

  // Not authenticated
  const isNotAuthenticated = !isAuthenticated;

  // Cart error state
  const hasCartError = !!cartError;

  // Empty cart state
  const isEmptyCart = isCartEmpty;

  // Render functions for different states
  const renderLoading = () => (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center h-64">
          <Spinner size="lg" label="Carregando checkout" withStatusRole />
        </div>
      </div>
    </div>
  );

  const renderNotAuthenticated = () => (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <ErrorAlert
          message="You need to be logged in to access the checkout."
          title="Access denied"
          variant="error"
          action={{
            label: 'Fazer login',
            onClick: () => navigate('/login'),
          }}
          role="alert"
        />
      </div>
    </div>
  );

  const renderCartError = () => (
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

  const renderEmptyCart = () => (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <EmptyState
          icon={EmptyStateIcons.cart}
          title="Your cart is empty"
          description="Add products to your cart before proceeding to checkout."
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

  const renderCheckoutForm = () => (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Progress Steps */}
        <nav className="mb-8" aria-label="Progresso do checkout" data-testid="checkout-progress-steps">
          <ol className="flex items-center" role="list">
            {CHECKOUT_STEPS.map((step, index) => (
              <li key={step.id} className="flex items-center" data-testid={`checkout-step-${step.id}`}>
                <div className="flex items-center">
                  <span
                    className={`
                      flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium
                      ${index < 3 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}
                    `}
                    aria-current={index === 3 ? 'step' : undefined}
                  >
                    {index + 1}
                  </span>
                  <div className="ml-3 hidden sm:block">
                    <p className="text-sm font-medium text-gray-900">{step.title}</p>
                    <p className="text-xs text-gray-500">{step.description}</p>
                  </div>
                </div>
                {index < CHECKOUT_STEPS.length - 1 && (
                  <div className="flex-1 h-0.5 bg-gray-200 mx-4 sm:mx-0" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
        </nav>

        {/* Submit Error Alert */}
        {submitError && (
          <ErrorAlert
            message={submitError}
            title="Erro ao finalizar pedido"
            variant="error"
            role="alert"
            className="mb-6"
            dismissible
            onDismiss={() => setSubmitError(null)}
          />
        )}

        {/* Preview Error Alert */}
        {previewError && (
          <ErrorAlert
            message={previewError instanceof Error ? previewError.message : 'Não foi possível carregar o resumo do pedido'}
            title="Erro ao carregar preview"
            variant="error"
            action={{
              label: 'Tentar novamente',
              onClick: () => refetchPreview(),
            }}
            role="alert"
            className="mb-6"
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content - Steps */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Address Selection */}
            <Card variant="bordered" padding="lg" data-testid="checkout-step-address">
              <CardHeader>
                <CardTitle as="h2">1. Delivery Address</CardTitle>
                <CardDescription>Selecione o endereço para onde o pedido será entregue</CardDescription>
              </CardHeader>
              <CardContent>
                {addressesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner label="Carregando endereços" withStatusRole />
                  </div>
                ) : addressesError ? (
                  <ErrorAlert
                    message={addressesError}
                    title="Erro ao carregar endereços"
                    variant="error"
                    action={{
                      label: 'Tentar novamente',
                      onClick: () => loadAddresses(),
                    }}
                    role="alert"
                  />
                ) : addresses.length === 0 ? (
                  <EmptyState
                    icon={EmptyStateIcons.profile}
                    title="No addresses registered"
                    description="Add an address to proceed with checkout."
                    action={{
                      label: 'Manage addresses',
                      onClick: () => navigate('/account/addresses'),
                      variant: 'primary',
                    }}
                    centered
                  />
                ) : (
                  <RadioGroup
                    name="shipping-address"
                    label="Delivery address"
                    options={addressOptions}
                    value={selectedAddressId}
                    onChange={setSelectedAddressId}
                    required
                    error={submitError && !selectedAddressId ? 'Selecione um endereço' : undefined}
                  />
                )}
              </CardContent>
            </Card>

            {/* Step 2: Coupon */}
            <Card variant="bordered" padding="lg" data-testid="checkout-step-coupon">
              <CardHeader>
                <CardTitle as="h2">2. Coupon quote</CardTitle>
                <CardDescription>Select a store and validate its coupon for an informational quote.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <label htmlFor="coupon-vendor">Coupon vendor</label>
                <select id="coupon-vendor" value={couponVendor} onChange={e => setCouponVendor(e.target.value)}>
                  <option value="">Select a store</option>
                  {vendorGroups.map(g => <option key={g.id} value={g.id}>{g.vendorName}</option>)}
                </select>
                <div className="flex gap-3">
                  <Input
                    id="coupon-code"
                    type="text"
                    placeholder="Coupon code"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    error={couponError}
                    aria-label="Coupon code"
                    onKeyDown={(e) => e.key === 'Enter' && handleApplyCoupon()}
                    data-testid="coupon-input"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleApplyCoupon}
                    disabled={quoteSourceError}
                    isLoading={applyingCoupon}
                    loadingText="Validating..."
                    data-testid="coupon-apply-button"
                  >
                    Validate coupon
                  </Button>
                </div>
                <p className="text-sm text-gray-500">
                  {confirmedQuote ? 'Finalizar pedido com desconto do cupom.' : 'Selecione um vendedor e um cupom para obter cotação.'}
                </p>

                {confirmedQuote && (
                  <div className="flex flex-wrap gap-2">
                    {confirmedQuote.selections.map(({ vendorId, code }) => (
                      <Badge
                        key={vendorId}
                        variant="success"
                        size="md"
                        className="flex items-center gap-1.5"
                      >
                        {code}
                        <button
                          type="button"
                          onClick={handleRemoveCoupon}
                          className="ml-1 text-green-800 hover:text-green-600 font-bold leading-none"
                          aria-label={`Remove coupon ${code} from ${vendorGroups.find(g => g.id === vendorId)?.vendorName}`}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                {confirmedQuote && selectedAddressId && !addressesError && (
                  <section aria-label="Durable quote acceptance">
                    <Button onClick={acceptance.prepare} disabled={acceptance.busy}>Prepare acceptance</Button>
                    {acceptance.busy && <p role="status">Preparing acceptance...</p>}
                    {acceptance.error && <p role="alert">{acceptance.error}</p>}
                    {acceptance.attempt && acceptanceSnapshot && (
                      <div>
                        <h3>{acceptance.attempt.state === 'ACCEPTED' ? 'Quote accepted' : 'Review server proposal'}</h3>
                        <p>Delivery: {acceptanceSnapshot.address.street}, {acceptanceSnapshot.address.number}, {acceptanceSnapshot.address.neighborhood}, {acceptanceSnapshot.address.city} - {acceptanceSnapshot.address.state}</p>
                        {acceptanceSnapshot.groups.map(group => <div key={group.vendorId}>
                          <h4>{group.vendorName}</h4>
                          {group.items.map(item => <p key={item.key}>{item.productName}: {item.quantity} × {formatCurrency(item.unitMinor / 100)}; net {formatCurrency(item.netMinor / 100)}</p>)}
                          {group.coupon && <p>Coupon {group.coupon.code}: {group.coupon.discountType} {group.coupon.value}; valid {group.coupon.startsAt} to {group.coupon.endsAt}; minimum {formatCurrency((group.coupon.minimumEligibleMinor ?? 0) / 100)}; included products {group.coupon.includeProducts.join(', ') || 'all'}, categories {group.coupon.includeCategories.join(', ') || 'all'}; excluded products {group.coupon.excludeProducts.join(', ') || 'none'}, categories {group.coupon.excludeCategories.join(', ') || 'none'}</p>}
                        </div>)}
                        <p>Proposal total: {formatCurrency(acceptanceSnapshot.netMinor / 100)}; shipping {formatCurrency(acceptanceSnapshot.shippingMinor / 100)}; fees {formatCurrency(acceptanceSnapshot.feeMinor / 100)}</p>
                        {acceptance.attempt.state === 'PROPOSED' && <Button onClick={acceptance.accept} disabled={acceptance.busy}>Accept quote</Button>}
                        {acceptance.attempt.state === 'SUPERSEDED' && <p>Proposal unavailable. Validate a current coupon before preparing a new acceptance.</p>}
                        <Button onClick={acceptance.reload} disabled={acceptance.busy}>Reload acceptance</Button>
                        <p>Payment is not available yet</p>
                      </div>
                    )}
                  </section>
                )}

                {previewLoading && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Spinner size="sm" label="Calculando totais" />
                    <span>Atualizando totais...</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 3: Order Summary */}
            <Card variant="bordered" padding="lg" data-testid="checkout-step-summary">
              <CardHeader>
                <CardTitle as="h2">3. Resumo do Pedido</CardTitle>
                <CardDescription>Revise os itens e valores antes de confirmar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {vendorGroups.length > 0 ? (
                  <>
                    {vendorGroups.map((vendorGroup: CheckoutPreviewVendorGroup) => (
                      <div key={vendorGroup.id} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-gray-900">{vendorGroup.vendorName}</h4>
                          <Badge variant="neutral" size="sm">
                            {vendorGroup.items.length} item{vendorGroup.items.length !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                        <div className="divide-y divide-gray-100">
                          {vendorGroup.items.map((item: CheckoutPreviewItem) => (
                            <div key={item.productId} className="py-2 flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{item.productName}</p>
                                <p className="text-xs text-gray-500">Qtd: {item.quantity} × {formatCurrency(item.unitPrice)}</p>
                              </div>
                              <p className="text-sm font-medium text-gray-900 ml-4">{formatCurrency(item.totalPrice)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between text-sm text-gray-600 border-t border-gray-100 pt-2">
                          <span>Subtotal do vendedor</span>
                          <span className="font-medium text-gray-900">{formatCurrency(vendorGroup.subtotal)}</span>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div key={item.productId} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">Produto {item.productId.slice(0, 8)}...</p>
                          <p className="text-xs text-gray-500">Qtd: {item.quantity} × {formatCurrency(item.unitPrice)}</p>
                        </div>
                        <p className="text-sm font-medium text-gray-900 ml-4">{formatCurrency(item.quantity * item.unitPrice)}</p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-gray-200 pt-4 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal bruto</span>
                    <span className="font-medium text-gray-900">{formatCurrency(subtotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Desconto informado no preview</span>
                      <span className="font-medium">-{formatCurrency(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Frete</span>
                    <span className="font-medium text-gray-900" data-testid="main-shipping-amount">
                      {!preview ? unavailablePreviewLabel : shippingAmount > 0 ? formatCurrency(shippingAmount) : 'free'}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-3">
                    <div className="flex justify-between text-base">
                      <span className="font-semibold text-gray-900">Total</span>
                      <span className="font-bold text-gray-900 text-lg">{preview ? formatCurrency(totalAmount) : unavailablePreviewLabel}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 4: Payment Selection */}
            <Card variant="bordered" padding="lg" data-testid="checkout-step-payment">
              <CardHeader>
                <CardTitle as="h2">4. Forma de Pagamento</CardTitle>
                <CardDescription>Escolha como deseja pagar (ambiente de teste)</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  name="payment-method"
                  label="Forma de pagamento"
                  options={paymentOptions}
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  required
                  error={submitError && !paymentMethod ? 'Select payment method' : undefined}
                />
                <p className="mt-4 text-sm text-gray-500">
                  <span className="font-medium">Nota:</span> Este é um ambiente de demonstração. 
                  Nenhuma cobrança real será realizada.
                </p>
              </CardContent>
            </Card>

            {/* Submit Button */}
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="lg"
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting || !preview}
                isLoading={isSubmitting}
                loadingText="Processando..."
                data-testid="checkout-submit-button"
              >
                Finalizar Pedido
              </Button>
            </div>
          </div>

{/* Order Summary Sidebar */}
            <div className="lg:col-span-1">
              <Card variant="elevated" padding="md" className="sticky top-24" data-testid="checkout-sidebar-summary">
                <CardHeader>
                  <CardTitle as="h2">Resumo</CardTitle>
                </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal bruto</span>
                  <span className="font-medium text-gray-900">{formatCurrency(subtotal)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Desconto informado no preview</span>
                    <span className="font-medium">-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Frete</span>
                  <span className="font-medium text-gray-900" data-testid="sidebar-shipping-amount">
                    {!preview ? unavailablePreviewLabel : shippingAmount > 0 ? formatCurrency(shippingAmount) : 'free'}
                  </span>
                </div>
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex justify-between text-base">
                    <span className="font-semibold text-gray-900">Total</span>
                    <span className="font-bold text-gray-900 text-lg">{preview ? formatCurrency(totalAmount) : unavailablePreviewLabel}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex-col gap-3 pt-6 border-t border-gray-200">
                <p className="text-xs text-gray-500 text-center w-full">
                  {items.length} item{items.length !== 1 ? 's' : ''} no pedido
                </p>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );

  // Single return with conditional rendering
  if (isInitialLoading) return renderLoading();
  if (isNotAuthenticated) return renderNotAuthenticated();
  if (hasCartError) return renderCartError();
  if (isEmptyCart) return renderEmptyCart();
  return renderCheckoutForm();
}
