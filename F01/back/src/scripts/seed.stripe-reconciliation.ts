import type Stripe from 'stripe';
import type { Person, PersonRepository } from '../modules/person/person.domain';
import type { Vendor, VendorRepository } from '../modules/vendor/vendor.domain';

type StripeSeedObject = { id: string; metadata: Record<string, string> | null };

type Link = { person: Person; customer?: StripeSeedObject; vendor: Vendor | null; account?: StripeSeedObject };

export async function reconcileSeedStripeLinks(
  people: Pick<PersonRepository, 'findById' | 'update'>,
  vendors: Pick<VendorRepository, 'findByPersonId' | 'update'>,
  personIds: string[],
  customers: StripeSeedObject[],
  accounts: StripeSeedObject[],
): Promise<void> {
  const links: Link[] = [];
  for (const personId of personIds) {
    const person = await people.findById(personId);
    if (!person) throw new Error('SEED_PERSON_NOT_FOUND');
    const vendor = await vendors.findByPersonId(personId);
    const matchingCustomers = customers.filter(c => c.metadata?.personId === personId && c.metadata?.source === 'marketplace_checkout');
    const matchingAccounts = accounts.filter(a => a.metadata?.personId === personId && a.metadata?.source === 'marketplace_vendor_onboarding');
    if (matchingCustomers.length > 1 || matchingAccounts.length > 1) throw new Error('SEED_STRIPE_AMBIGUOUS');
    const customer = matchingCustomers[0];
    const account = vendor ? matchingAccounts[0] : undefined;
    if ((customer && person.stripeCustomerId && person.stripeCustomerId !== customer.id) ||
        (account && vendor?.stripeAccountId && vendor.stripeAccountId !== account.id)) {
      throw new Error('SEED_STRIPE_CONFLICT');
    }
    links.push({ person, customer, vendor, account });
  }
  for (const { person, customer, vendor, account } of links) {
    if (customer && !person.stripeCustomerId) {
      person.setStripeCustomerId(customer.id);
      await people.update(person);
    }
    if (vendor && account && !vendor.stripeAccountId) {
      vendor.setStripeAccountId(account.id);
      await vendors.update(vendor);
    }
  }
}

export async function reconcileSeedStripeAfterReset(
  stripe: Stripe,
  people: Pick<PersonRepository, 'findById' | 'update'>,
  vendors: Pick<VendorRepository, 'findByPersonId' | 'update'>,
  personIds: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const expectedAccount = validatePostResetStripeEnvironment(environment);
  const platform = await stripe.accounts.retrieveCurrent();
  if (platform.id !== expectedAccount) throw new Error('SEED_STRIPE_ACCOUNT_MISMATCH');
  const customers: StripeSeedObject[] = [];
  for await (const customer of stripe.customers.list({ limit: 100 })) {
    if (!customer.deleted) customers.push({ id: customer.id, metadata: customer.metadata });
  }
  const accounts: StripeSeedObject[] = [];
  for await (const account of stripe.accounts.list({ limit: 100 })) {
    accounts.push({ id: account.id, metadata: account.metadata ?? null });
  }
  await reconcileSeedStripeLinks(people, vendors, personIds, customers, accounts);
}

export function validatePostResetStripeEnvironment(environment: NodeJS.ProcessEnv): string {
  const key = environment.STRIPE_SECRET_KEY?.trim() ?? '';
  if (environment.NODE_ENV === 'production' || !/^(sk|rk)_test_/.test(key)) {
    throw new Error('SEED_STRIPE_TEST_MODE_REQUIRED');
  }
  const expectedAccount = environment.SEED_STRIPE_ACCOUNT_ID?.trim();
  if (!expectedAccount) throw new Error('SEED_STRIPE_ACCOUNT_REQUIRED');
  return expectedAccount;
}
