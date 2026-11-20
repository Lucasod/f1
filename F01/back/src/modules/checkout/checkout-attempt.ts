import { createHash } from 'node:crypto';
import { CouponSelection, CouponTerms } from '../coupon/coupon.domain';

export interface SnapshotMoney {
  grossMinor: number;
  eligibleMinor: number;
  discountMinor: number;
  netMinor: number;
}
export interface AcceptedSnapshotV1 extends SnapshotMoney {
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
  groups: (SnapshotMoney & {
    vendorId: string; vendorName: string; coupon?: CouponTerms;
    commissionMinor: number; vendorNetMinor: number;
    items: (SnapshotMoney & { key: string; productId: string; productName: string; unitMinor: number; quantity: number })[];
  })[];
}
export interface CheckoutAttempt {
  id: string;
  owner: string;
  requestFingerprint: string;
  input: { shippingAddressId: string; selections: CouponSelection[] };
  state: 'PROPOSED' | 'ACCEPTED' | 'SUPERSEDED';
  version: number;
  proposedSnapshot: AcceptedSnapshotV1;
  proposedHash: string;
  proposalError?: string;
  acceptedSnapshot?: AcceptedSnapshotV1;
  acceptedHash?: string;
  acceptedAt?: string;
}
export class AttemptError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly attempt?: CheckoutAttempt) { super(code); }
}

// Explicit recursive canonicalization avoids object insertion order as hash authority.
export function snapshotHash(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function attemptIdentity(owner: string, requestId: string): string {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new AttemptError('INVALID_REQUEST_ID', 400);
  return snapshotHash([owner, requestId]);
}
export interface CheckoutAttemptRepository {
  find(owner: string, id: string): Promise<CheckoutAttempt | null>;
  createOrRead(candidate: CheckoutAttempt): Promise<CheckoutAttempt>;
  replaceProposal(current: CheckoutAttempt, snapshot: AcceptedSnapshotV1 | null, error?: string): Promise<CheckoutAttempt>;
  acceptIfCurrent(current: CheckoutAttempt): Promise<CheckoutAttempt>;
}
