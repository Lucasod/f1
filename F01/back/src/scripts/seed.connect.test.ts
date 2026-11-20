import { describe, expect, it, vi } from 'vitest';
import { provisionSeedConnect, validateConnectSeedEnvironment } from './seed.connect';

const env = { NODE_ENV: 'test', STRIPE_SECRET_KEY: ['rk', 'test', 'dummy'].join('_'), SEED_STRIPE_ACCOUNT_ID: 'acct_platform' };
function setup() {
  const records = new Map<string, any>();
  const store = {
    start: vi.fn(async () => {}), finish: vi.fn(async () => {}),
    retryRejected: vi.fn(async (vendor: any, run: string) => { const record = records.get(`${run}:${vendor.id}`); record.attempt = (record.attempt || 0) + 1; }),
    prepare: vi.fn(async (vendor: any, run: string) => {
      const k = `${run}:${vendor.id}`;
      if (!records.has(k)) records.set(k, { startedAt: new Date() });
      return records.get(k);
    }),
    commit: vi.fn(async (vendor: any, run: string, account: any) => { records.set(`${run}:${vendor.id}`, { accountId: account.id, startedAt: new Date() }); }),
  };
  const accounts = new Map<string, any>();
  const connectAccounts = {
    create: vi.fn(async (params: any, options: any) => {
      if (!accounts.has(options.idempotencyKey)) accounts.set(options.idempotencyKey, { id: `acct_${accounts.size + 1}`, livemode: false, metadata: params.metadata, capabilities: { transfers: 'inactive' } });
      return accounts.get(options.idempotencyKey);
    }),
    retrieve: vi.fn(async (id: string) => [...accounts.values()].find(a => a.id === id)),
  };
  const stripe = {
    accounts: { retrieveCurrent: vi.fn(async () => ({ id: 'acct_platform' })) },
    v2: { core: { accounts: connectAccounts } },
  };
  const vendors = [{ id: 'v1', personId: 'p1' }, { id: 'v2', personId: 'p2' }, { id: 'v3', personId: 'p3' }];
  return { store, stripe, vendors, accounts };
}
describe('explicit Connect seed', () => {
  it('rejects live keys and production', () => {
    expect(() => validateConnectSeedEnvironment({ ...env, STRIPE_SECRET_KEY: ['sk', 'live', 'dummy'].join('_') })).toThrow('TEST_MODE_REQUIRED');
    expect(() => validateConnectSeedEnvironment({ ...env, NODE_ENV: 'production' })).toThrow('TEST_MODE_REQUIRED');
  });
  it('reuses a run and creates distinct accounts for a new run', async () => {
    const x = setup();
    const execute = (run: string) => provisionSeedConnect(x.stripe as never, x.store as never, x.vendors, run, env);
    await execute('run-0001'); await execute('run-0001'); await execute('run-0002');
    expect(x.accounts.size).toBe(6);
    expect(x.stripe.v2.core.accounts.create).toHaveBeenCalledTimes(6);
  });
  it('resumes a partial failure without duplicating accounts', async () => {
    const x = setup();
    x.store.commit.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(provisionSeedConnect(x.stripe as never, x.store as never, x.vendors, 'run-0001', env)).rejects.toThrow('database unavailable');
    await provisionSeedConnect(x.stripe as never, x.store as never, x.vendors, 'run-0001', env);
    expect(x.accounts.size).toBe(3);
  });
  it('retries a confirmed cached signup rejection with a new stable attempt key', async () => {
    const x = setup();
    x.stripe.v2.core.accounts.create.mockRejectedValueOnce({ statusCode: 400, message: "You can only create new accounts if you've signed up for Connect, which you can do at https://dashboard.stripe.com/connect.", headers: { 'idempotent-replayed': 'true' } });
    await provisionSeedConnect(x.stripe as never, x.store as never, x.vendors, 'run-0001', env);
    expect(x.store.retryRejected).toHaveBeenCalledTimes(1);
    expect(x.accounts.size).toBe(3);
    const first = x.stripe.v2.core.accounts.create.mock.calls[0][1].idempotencyKey;
    const second = x.stripe.v2.core.accounts.create.mock.calls[1][1].idempotencyKey;
    expect(first).not.toBe(second);
  });
  it('rejects platform mismatch before creation', async () => {
    const x = setup(); x.stripe.accounts.retrieveCurrent.mockResolvedValue({ id: 'acct_other' });
    await expect(provisionSeedConnect(x.stripe as never, x.store as never, x.vendors, 'run-0001', env)).rejects.toThrow('ACCOUNT_MISMATCH');
    expect(x.stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  });
});
