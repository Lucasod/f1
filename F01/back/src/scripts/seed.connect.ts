import { createHash } from 'crypto';
import type Stripe from 'stripe';
import { validatePostResetStripeEnvironment } from './seed.stripe-reconciliation';

export interface SeedVendor { id: string; personId: string }
export interface SeedConnectStore {
  start(run: string, platform: string): Promise<void>;
  finish(run: string): Promise<void>;
  prepare(vendor: SeedVendor, run: string): Promise<{ accountId?: string; startedAt: Date; attempt?: number }>;
  retryRejected(vendor: SeedVendor, run: string, attempt: number): Promise<void>;
  commit(vendor: SeedVendor, run: string, account: Stripe.Account): Promise<void>;
}
export const validateConnectSeedEnvironment = validatePostResetStripeEnvironment;

export async function provisionSeedConnect(stripe: Stripe, store: SeedConnectStore, vendors: SeedVendor[], run: string, environment: NodeJS.ProcessEnv): Promise<Stripe.Account[]> {
  const platform = validateConnectSeedEnvironment(environment);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(run)) throw new Error('SEED_CONNECT_INVALID_RUN_ID');
  if (vendors.length !== 3 || new Set(vendors.map(v => v.id)).size !== 3) throw new Error('SEED_CONNECT_EXPECTS_THREE_VENDORS');
  if ((await stripe.accounts.retrieveCurrent()).id !== platform) throw new Error('SEED_STRIPE_ACCOUNT_MISMATCH');
  await store.start(run, platform);
  const result: Stripe.Account[] = [];
  for (const vendor of vendors) {
    const pending = await store.prepare(vendor, run);
    const metadata = { source: 'f01_seed_connect', seed_run_id: run, vendor_id: vendor.id, person_id: vendor.personId, platform_account_id: platform };
    let account: Stripe.Account;
      if (pending.accountId) {
        account = (await stripe.v2.core.accounts.retrieve(pending.accountId)) as unknown as Stripe.Account;
      } else {
      if (Date.now() - pending.startedAt.getTime() > 23 * 60 * 60 * 1000) throw new Error('SEED_CONNECT_RECONCILIATION_REQUIRED');
      const attempt = pending.attempt ?? 0;
      const key = createHash('sha256').update(JSON.stringify([platform, run, vendor.id])).digest('hex');
      const create = (n: number) => stripe.v2.core.accounts.create({ dashboard: 'express', identity: { country: 'BR', entity_type: 'individual' }, configuration: { merchant: { capabilities: {} } }, defaults: { responsibilities: { losses_collector: 'application', fees_collector: 'application' } }, metadata } as any, { idempotencyKey: `f01-seed-${key}${n ? `-${n}` : ''}` });
      try {
        account = (await create(attempt)) as unknown as Stripe.Account;
      } catch (error: any) {
        const rejected = error?.statusCode === 400 && error?.headers?.['idempotent-replayed'] === 'true' && error?.message === "You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.";
        if (!rejected) throw error;
        await store.retryRejected(vendor, run, attempt);
        const retry = await store.prepare(vendor, run);
        if (retry.accountId) account = (await stripe.v2.core.accounts.retrieve(retry.accountId)) as unknown as Stripe.Account;
        else account = (await create(retry.attempt ?? 0)) as unknown as Stripe.Account;
      }
    }
    if (!account || (account as Stripe.Account & { livemode?: boolean }).livemode === true || Object.entries(metadata).some(([key, value]) => account.metadata?.[key] !== value)) throw new Error('SEED_CONNECT_ACCOUNT_IDENTITY_MISMATCH');
    if (!pending.accountId) await store.commit(vendor, run, account);
    result.push(account);
  }
  await store.finish(run);
  return result;
}
