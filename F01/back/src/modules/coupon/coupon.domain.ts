export interface CouponSelection { vendorId: string; code: string }
export interface CouponTerms extends CouponSelection {
  id: string;
  revision: 1;
  discountType: 'percentBps' | 'fixedMinorBRL';
  value: number;
  startsAt: string;
  endsAt: string;
  minimumEligibleMinor?: number;
  includeProducts: string[];
  excludeProducts: string[];
  includeCategories: string[];
  excludeCategories: string[];
}
export interface CouponRepository {
  insert(terms: CouponTerms): Promise<void>;
  find(vendorId: string, code: string): Promise<CouponTerms | null>;
  list(vendorId: string): Promise<CouponTerms[]>;
}
export class CouponError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function canonicalCode(code: unknown): string {
  if (typeof code !== 'string' || !/^[A-Z0-9_-]{1,64}$/.test(code.trim().toUpperCase())) throw new CouponError('INVALID_COUPON');
  return code.trim().toUpperCase();
}
export function couponIdentity(vendorId: string, code: string): string {
  return JSON.stringify([vendorId, canonicalCode(code)]);
}
export function safeMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new CouponError('INVALID_MONEY');
  return value;
}
export function sumMinor(values: number[]): number {
  return values.reduce((sum, value) => safeMinor(sum + safeMinor(value)), 0);
}
export function priceToMinor(price: number): number {
  if (!Number.isFinite(price) || price < 0) throw new CouponError('INVALID_MONEY');
  // Reject sub-cent prices; allow only the representation noise of decimal JS numbers.
  const minor = Math.round(price * 100);
  if (Math.abs(price * 100 - minor) > 0.000001) throw new CouponError('INVALID_MONEY');
  return safeMinor(minor);
}
export function validateTerms(value: unknown, vendorId: string): CouponTerms {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CouponError('INVALID_COUPON');
  const input = value as Record<string, unknown>;
  const allowed = ['code', 'discountType', 'value', 'startsAt', 'endsAt', 'minimumEligibleMinor', 'includeProducts', 'excludeProducts', 'includeCategories', 'excludeCategories'];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new CouponError('INVALID_COUPON');
  const code = canonicalCode(input.code);
  if (input.discountType !== 'percentBps' && input.discountType !== 'fixedMinorBRL') throw new CouponError('INVALID_COUPON');
  if (typeof input.value !== 'number' || safeMinor(input.value) === 0 || (input.discountType === 'percentBps' && input.value > 10000)) throw new CouponError('INVALID_COUPON');
  const dates = [input.startsAt, input.endsAt];
  if (dates.some(d => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().replace('.000Z', 'Z') !== d.replace('.000Z', 'Z'))) throw new CouponError('INVALID_COUPON');
  if (Date.parse(input.startsAt as string) >= Date.parse(input.endsAt as string)) throw new CouponError('INVALID_COUPON');
  const lists = {} as Pick<CouponTerms, 'includeProducts' | 'excludeProducts' | 'includeCategories' | 'excludeCategories'>;
  for (const key of ['includeProducts', 'excludeProducts', 'includeCategories', 'excludeCategories'] as const) {
    const list = input[key] ?? [];
    if (!Array.isArray(list) || list.length > 200 || list.some(id => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(list).size !== list.length) throw new CouponError('INVALID_COUPON');
    lists[key] = [...list].sort();
  }
  const minimum = input.minimumEligibleMinor;
  if (minimum !== undefined && (typeof minimum !== 'number' || !Number.isSafeInteger(minimum) || minimum < 0)) throw new CouponError('INVALID_COUPON');
  return { id: couponIdentity(vendorId, code), vendorId, code, revision: 1, discountType: input.discountType, value: input.value, startsAt: new Date(input.startsAt as string).toISOString(), endsAt: new Date(input.endsAt as string).toISOString(), ...lists, ...(minimum === undefined ? {} : { minimumEligibleMinor: minimum as number }) };
}

export class InMemoryCouponRepository implements CouponRepository {
  private readonly terms = new Map<string, CouponTerms>();
  async insert(terms: CouponTerms): Promise<void> {
    if (this.terms.has(terms.id)) throw new CouponError('COUPON_CONFLICT', 409);
    this.terms.set(terms.id, structuredClone(terms));
  }
  async find(vendorId: string, code: string): Promise<CouponTerms | null> { return structuredClone(this.terms.get(couponIdentity(vendorId, code)) ?? null); }
  async list(vendorId: string): Promise<CouponTerms[]> { return structuredClone([...this.terms.values()].filter(t => t.vendorId === vendorId)); }
}
