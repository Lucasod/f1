import { apiClient } from './client';
import type { Order } from './order';

export interface CouponSelection { vendorId: string; code: string }
export interface CouponTerms extends CouponSelection {
  id: string;
  revision: number;
  discountType: 'percentBps' | 'fixedMinorBRL';
  value: number;
}
export interface QuoteMoney {
  grossMinor?: number;
  eligibleMinor?: number;
  discountMinor?: number;
  netMinor?: number;
}

export interface CheckoutPreviewItem extends QuoteMoney {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface CheckoutPreviewVendorGroup extends QuoteMoney {
  coupon?: CouponTerms;
  id: string;
  vendorName: string;
  subtotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorNet: number;
  items: CheckoutPreviewItem[];
}

export interface CheckoutPreviewResponse extends QuoteMoney {
  currency?: 'BRL';
  calculationVersion?: 'coupon-quote-v1';
  purchasable?: boolean;
  vendorGroups: CheckoutPreviewVendorGroup[];
  totalAmount: number;
  discountAmount?: number;
}

export interface CheckoutInput {
  shippingAddressId: string;
  couponCodes?: string[];
  couponSelections?: CouponSelection[];
}

export interface CheckoutResponse {
  order: Order;
  checkoutUrl: string;
}

export interface AcceptanceMoney { grossMinor: number; eligibleMinor: number; discountMinor: number; netMinor: number }
export interface AcceptedSnapshotV1 extends AcceptanceMoney {
  schemaVersion: 1;
  calculationVersion: 'coupon-quote-v1';
  currency: 'BRL';
  personId: string;
  cart: { id: string; version: number; generation: string | null; fingerprint: string };
  address: { id: string; street: string; number: string; neighborhood: string; city: string; state: string };
  selections: CouponSelection[];
  commissionBps: number;
  commissionBasis: 'netMinor';
  shippingMinor: 0;
  feeMinor: 0;
  groups: (AcceptanceMoney & {
    vendorId: string; vendorName: string; commissionMinor: number; vendorNetMinor: number;
    coupon?: CouponTerms & { startsAt: string; endsAt: string; minimumEligibleMinor?: number; includeProducts: string[]; excludeProducts: string[]; includeCategories: string[]; excludeCategories: string[] };
    items: (AcceptanceMoney & { key: string; productId: string; productName: string; unitMinor: number; quantity: number })[];
  })[];
}
export interface CheckoutAttempt {
  id: string;
  state: 'PROPOSED' | 'ACCEPTED' | 'SUPERSEDED';
  version: number;
  proposedHash: string;
  proposedSnapshot: AcceptedSnapshotV1;
  acceptedHash?: string;
  acceptedSnapshot?: AcceptedSnapshotV1;
  proposalError?: string;
}
export interface PrepareAttemptInput { requestId: string; shippingAddressId: string; couponSelections: CouponSelection[] }

/**
 * Custom error class for checkout API errors that preserves HTTP status and error code.
 * Allows callers to handle different error types (401, 403, 404, 5xx) appropriately.
 */
export class CheckoutApiException extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string, public readonly attempt?: CheckoutAttempt) {
    super(message);
    this.name = 'CheckoutApiException';
    this.status = status;
    this.code = code;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new CheckoutApiException(
      errorData.message || `API error: ${response.status}`,
      response.status,
      errorData.error,
      errorData.attempt
    );
  }
  return response.json();
}

function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach(v => searchParams.append(key, String(v)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });
  return searchParams.toString();
}

export const checkoutApi = {
  async prepareAttempt(input: PrepareAttemptInput): Promise<CheckoutAttempt> {
    const response = await apiClient.post('/api/v1/checkout/attempts', input);
    return (await handleResponse<{ attempt: CheckoutAttempt }>(response)).attempt;
  },
  async acceptAttempt(attempt: CheckoutAttempt): Promise<CheckoutAttempt> {
    const response = await apiClient.post(`/api/v1/checkout/attempts/${encodeURIComponent(attempt.id)}/accept`, { expectedVersion: attempt.version, expectedHash: attempt.proposedHash });
    return (await handleResponse<{ attempt: CheckoutAttempt }>(response)).attempt;
  },
  async getAttempt(id: string): Promise<CheckoutAttempt> {
    const response = await apiClient.get(`/api/v1/checkout/attempts/${encodeURIComponent(id)}`);
    return (await handleResponse<{ attempt: CheckoutAttempt }>(response)).attempt;
  },
  /**
   * Preview checkout totals with optional coupon codes
   */
  async preview(couponCodes?: string[], couponSelections?: CouponSelection[]): Promise<CheckoutPreviewResponse> {
    const query = buildQueryString({ couponCodes, couponSelections: couponSelections?.length ? JSON.stringify(couponSelections) : undefined });
    const response = await apiClient.get(`/api/v1/checkout/preview?${query}`);
    const result = await handleResponse<{ preview: CheckoutPreviewResponse }>(response);
    const preview = result.preview;
    if (couponCodes?.length || couponSelections?.length) validateCouponQuote(preview, couponSelections, couponCodes);
    return preview;
  },

  /**
   * Create order from cart with shipping address and optional coupon codes
   */
  async checkout(input: CheckoutInput): Promise<CheckoutResponse> {
    const response = await apiClient.post('/api/v1/checkout', input);
    return handleResponse<CheckoutResponse>(response);
  },
};

/** A 200 envelope alone is not proof that a coupon was validated. */
function validateCouponQuote(preview: CheckoutPreviewResponse, selections: CouponSelection[] = [], codes: string[] = []): void {
  const invalid = () => { throw new CheckoutApiException('Invalid coupon quote', 502, 'INVALID_COUPON_QUOTE'); };
  const money = (m: QuoteMoney) => {
    if (![m.grossMinor, m.eligibleMinor, m.discountMinor, m.netMinor].every(n => Number.isSafeInteger(n) && n! >= 0) || m.grossMinor! - m.discountMinor! !== m.netMinor || m.eligibleMinor! > m.grossMinor! || m.discountMinor! > m.eligibleMinor!) invalid();
  };
  if (!preview || preview.currency !== 'BRL' || preview.calculationVersion !== 'coupon-quote-v1' || preview.purchasable !== false || !Array.isArray(preview.vendorGroups)) invalid();
  money(preview);
  const confirmed: CouponSelection[] = [];
  const seen = new Set<string>();
  for (const group of preview.vendorGroups) {
    money(group);
    if (seen.has(group.id) || !Array.isArray(group.items)) invalid(); seen.add(group.id);
    for (const item of group.items) {
      money(item);
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.totalPrice !== item.grossMinor! / 100) invalid();
    }
    for (const key of ['grossMinor', 'eligibleMinor', 'discountMinor', 'netMinor'] as const) if (group.items.reduce((n, i) => n + i[key]!, 0) !== group[key]) invalid();
    if (group.subtotal !== group.netMinor! / 100) invalid();
    if (group.coupon) {
      if (group.coupon.vendorId !== group.id || group.coupon.revision !== 1 || !group.coupon.id || !group.coupon.code) invalid();
      confirmed.push(group.coupon);
    } else if (group.discountMinor !== 0) invalid();
  }
  for (const key of ['grossMinor', 'eligibleMinor', 'discountMinor', 'netMinor'] as const) if (preview.vendorGroups.reduce((n, g) => n + g[key]!, 0) !== preview[key]) invalid();
  if (preview.totalAmount !== preview.netMinor! / 100 || preview.discountAmount !== preview.discountMinor! / 100 || confirmed.length !== selections.length + codes.length) invalid();
  for (const selection of selections) if (!confirmed.some(c => c.vendorId === selection.vendorId && c.code === selection.code.trim().toUpperCase())) invalid();
  for (const code of codes) if (confirmed.filter(c => c.code === code.trim().toUpperCase()).length !== 1) invalid();
}
