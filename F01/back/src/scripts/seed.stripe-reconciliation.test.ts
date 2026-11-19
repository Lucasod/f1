import { describe, expect, it, vi } from 'vitest';
import { reconcileSeedStripeLinks } from './seed.stripe-reconciliation';

describe('post-reset Stripe seed reconciliation', () => {
  const customer = { id: 'cus_existing', metadata: { personId: 'person-1', source: 'marketplace_checkout' } };
  const account = { id: 'acct_existing', metadata: { personId: 'person-1', source: 'marketplace_vendor_onboarding' } };
  function setup() {
    const person = { id: 'person-1', stripeCustomerId: undefined as string | undefined, setStripeCustomerId(id: string) { this.stripeCustomerId = id; } };
    const vendor = { personId: 'person-1', stripeAccountId: undefined as string | undefined, setStripeAccountId(id: string) { this.stripeAccountId = id; } };
    const people = { findById: vi.fn().mockResolvedValue(person), update: vi.fn().mockResolvedValue(person) };
    const vendors = { findByPersonId: vi.fn().mockResolvedValue(vendor), update: vi.fn().mockResolvedValue(vendor) };
    return { person, vendor, people, vendors };
  }
  it('associates existing matching customer and account without creating Stripe objects', async () => {
    const x = setup();
    await reconcileSeedStripeLinks(x.people as never, x.vendors as never, ['person-1'], [customer], [account]);
    expect(x.person.stripeCustomerId).toBe('cus_existing');
    expect(x.vendor.stripeAccountId).toBe('acct_existing');
    expect(x.people.update).toHaveBeenCalledTimes(1);
    expect(x.vendors.update).toHaveBeenCalledTimes(1);
  });
  it('fails before making any updates if a seed identity has multiple matches', async () => {
    const x = setup();
    await expect(reconcileSeedStripeLinks(x.people as never, x.vendors as never, ['person-1'], [customer, { ...customer, id: 'cus_duplicate' }], [account])).rejects.toThrow('SEED_STRIPE_AMBIGUOUS');
    expect(x.people.update).not.toHaveBeenCalled();
    expect(x.vendors.update).not.toHaveBeenCalled();
  });
  it('does not associate unrelated identities or replace an existing different link', async () => {
    const x = setup(); x.person.stripeCustomerId = 'cus_other';
    await expect(reconcileSeedStripeLinks(x.people as never, x.vendors as never, ['person-1'], [customer], [account])).rejects.toThrow('SEED_STRIPE_CONFLICT');
    expect(x.people.update).not.toHaveBeenCalled();
    expect(x.vendors.update).not.toHaveBeenCalled();
  });
  it('skips absent and non-seed matches', async () => {
    const x = setup();
    await reconcileSeedStripeLinks(x.people as never, x.vendors as never, ['person-1'], [{ ...customer, metadata: { personId: 'other', source: 'marketplace_checkout' } }], []);
    expect(x.people.update).not.toHaveBeenCalled();
    expect(x.vendors.update).not.toHaveBeenCalled();
  });
});

describe('Stripe account safety for post-reset reconciliation', () => {
  it('rejects live credentials before contacting Stripe', async () => {
    const { reconcileSeedStripeAfterReset } = await import('./seed.stripe-reconciliation');
    const accountRead = vi.fn();
    await expect(reconcileSeedStripeAfterReset({ accounts: { retrieveCurrent: accountRead } } as never, {} as never, {} as never, [], { NODE_ENV: 'development', STRIPE_SECRET_KEY: ['live', 'credential'].join('-'), SEED_STRIPE_ACCOUNT_ID: 'acct_expected' })).rejects.toThrow('SEED_STRIPE_TEST_MODE_REQUIRED');
    expect(accountRead).not.toHaveBeenCalled();
  });
  it('rejects a different account before listing or modifying anything', async () => {
    const { reconcileSeedStripeAfterReset } = await import('./seed.stripe-reconciliation');
    const accountRead = vi.fn().mockResolvedValue({ id: 'acct_other' });
    const customerList = vi.fn();
    await expect(reconcileSeedStripeAfterReset({ accounts: { retrieveCurrent: accountRead }, customers: { list: customerList } } as never, {} as never, {} as never, [], { NODE_ENV: 'development', STRIPE_SECRET_KEY: ['rk', 'test', 'dummy'].join('_'), SEED_STRIPE_ACCOUNT_ID: 'acct_expected' })).rejects.toThrow('SEED_STRIPE_ACCOUNT_MISMATCH');
    expect(customerList).not.toHaveBeenCalled();
  });
  it('reads all pages and associates existing matching objects', async () => {
    const { reconcileSeedStripeAfterReset } = await import('./seed.stripe-reconciliation');
    const person = { id: 'p1', stripeCustomerId: undefined as string | undefined, setStripeCustomerId(id: string) { this.stripeCustomerId = id; } };
    const vendor = { personId: 'p1', stripeAccountId: undefined as string | undefined, setStripeAccountId(id: string) { this.stripeAccountId = id; } };
    const people = { findById: vi.fn().mockResolvedValue(person), update: vi.fn() };
    const vendors = { findByPersonId: vi.fn().mockResolvedValue(vendor), update: vi.fn() };
    const customers = { list: vi.fn(() => (async function* () { yield { id: 'cus_other', metadata: { personId: 'other', source: 'marketplace_checkout' } }; yield { id: 'cus_p1', metadata: { personId: 'p1', source: 'marketplace_checkout' } }; })()) };
    const accounts = { retrieveCurrent: vi.fn().mockResolvedValue({ id: 'acct_expected' }), list: vi.fn(() => (async function* () { yield { id: 'acct_p1', metadata: { personId: 'p1', source: 'marketplace_vendor_onboarding' } }; })()) };
    await reconcileSeedStripeAfterReset({ customers, accounts } as never, people as never, vendors as never, ['p1'], { NODE_ENV: 'test', STRIPE_SECRET_KEY: ['rk', 'test', 'dummy'].join('_'), SEED_STRIPE_ACCOUNT_ID: 'acct_expected' });
    expect(person.stripeCustomerId).toBe('cus_p1');
    expect(vendor.stripeAccountId).toBe('acct_p1');
  });

});
