import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutAttemptRepository, MongoCheckoutAttemptRepository } from './checkout-attempt.mongo.repository';
import { AcceptedSnapshotV1, CheckoutAttempt, attemptIdentity, snapshotHash } from './checkout-attempt';

function candidate(): CheckoutAttempt {
  const snapshot: AcceptedSnapshotV1 = { schemaVersion: 1, calculationVersion: 'coupon-quote-v1', currency: 'BRL', personId: 'buyer',
    cart: { id: 'buyer', version: 1, generation: null, fingerprint: snapshotHash([]) },
    address: { id: 'address', street: 'Street', number: '1', neighborhood: '', city: 'City', state: 'SP' }, selections: [],
    grossMinor: 0, eligibleMinor: 0, discountMinor: 0, netMinor: 0, commissionBps: 1000, commissionBasis: 'netMinor', shippingMinor: 0, feeMinor: 0, groups: [] };
  return { id: attemptIdentity('buyer', 'request-0001'), owner: 'buyer', requestFingerprint: snapshotHash(['address']), input: { shippingAddressId: 'address', selections: [] }, version: 1, state: 'PROPOSED', proposedSnapshot: snapshot, proposedHash: snapshotHash(snapshot) };
}

describe('checkout attempt storage protocol', () => {
  it('has canonical owner-scoped identities and insertion-order-independent detached snapshot hashes', () => {
    expect(attemptIdentity('buyer', 'request-0001')).not.toBe(attemptIdentity('other', 'request-0001'));
    expect(snapshotHash({ b: [1, 2], a: 3 })).toBe(snapshotHash({ a: 3, b: [1, 2] }));
    expect(() => attemptIdentity('buyer', '../bad')).toThrow('INVALID_REQUEST_ID');
  });
  it('matches detached create, parallel acceptance, immutable replay and superseded-proposal CAS in local fallback', async () => {
    const repo = new InMemoryCheckoutAttemptRepository(); const p = candidate();
    const [a, b] = await Promise.all([repo.createOrRead(p), repo.createOrRead(p)]); expect(a).toEqual(b);
    p.proposedSnapshot.address.street = 'local mutation';
    expect((await repo.find('buyer', p.id))!.proposedSnapshot.address.street).toBe('Street');
    expect(await repo.find('other', p.id)).toBeNull();
    await expect(repo.createOrRead({ ...a, requestFingerprint: snapshotHash('different') })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    const [accepted, retry] = await Promise.all([repo.acceptIfCurrent(a), repo.acceptIfCurrent(b)]);
    expect(accepted).toEqual(retry); expect(accepted.version).toBe(2);
    expect(await repo.replaceProposal(a, a.proposedSnapshot)).toEqual(accepted);
    await expect(repo.replaceProposal(accepted, accepted.proposedSnapshot)).rejects.toMatchObject({ code: 'ATTEMPT_CONFLICT' });
    expect((await repo.find('buyer', p.id))!.acceptedHash).toBe(a.proposedHash);
  });
  it('returns recoverable uncertainty rather than claiming a changed proposal when CAS did not apply', async () => {
    const p = candidate();
    const db = { collection: () => ({ findOne: async () => ({ ...structuredClone(p), _id: p.id }), updateOne: async () => { throw new Error('unavailable before write'); } }) };
    const repo = new MongoCheckoutAttemptRepository(db as any);
    await expect(repo.replaceProposal(p, { ...p.proposedSnapshot, address: { ...p.proposedSnapshot.address, number: '2' } })).rejects.toMatchObject({ code: 'ATTEMPT_UNAVAILABLE', status: 503 });
  });
  it('rejects corrupted stored hashes and missing read-after-unknown rather than fabricating success', async () => {
    const p = candidate();
    const corrupt = new MongoCheckoutAttemptRepository({ collection: () => ({ findOne: async () => ({ ...p, _id: p.id, proposedHash: 'bad' }) }) } as any);
    await expect(corrupt.find('buyer', p.id)).rejects.toMatchObject({ code: 'ATTEMPT_UNAVAILABLE' });
    const missing = new MongoCheckoutAttemptRepository({ collection: () => ({ insertOne: async () => { throw new Error('unknown'); }, findOne: async () => null }) } as any);
    await expect(missing.createOrRead(p)).rejects.toMatchObject({ code: 'ATTEMPT_UNAVAILABLE' });
  });
});
