import { describe, it, expect } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoSeedConnectStore } from './seed.connect.mongo';
import { provisionSeedConnect } from './seed.connect';

const uri = process.env.F01_CONNECT_TEST_URI;
describe.skipIf(!uri)('Connect seed Mongo integration', () => {
  it('resumes a partial commit, serializes runs and keeps the old association', async () => {
    const client = new MongoClient(uri!); await client.connect();
    const db = client.db(`fs01_connect_seed_test_${Date.now()}`);
    try {
      const vendors = ['a', 'b', 'c'].map(id => ({ id, personId: `person-${id}` }));
      await db.collection('vendors').insertMany(vendors.map(v => ({ _id: v.id as never, personId: v.personId })));
      const store = new MongoSeedConnectStore(db);
      const accounts = new Map<string, any>();
      const v2CoreAccounts = {
        create: async (params: any, opts: any) => {
          if (!accounts.has(opts.idempotencyKey)) accounts.set(opts.idempotencyKey, { id: `acct_${accounts.size}`, metadata: params.metadata, capabilities: { transfers: 'inactive' } });
          return accounts.get(opts.idempotencyKey);
        },
        retrieve: async (id: string) => [...accounts.values()].find(a => a.id === id),
      };
      const stripe = { accounts: { retrieveCurrent: async () => ({ id: 'acct_platform' }) }, v2: { core: { accounts: v2CoreAccounts } } };
      const env = { NODE_ENV: 'test', STRIPE_SECRET_KEY: ['rk', 'test', 'dummy'].join('_'), SEED_STRIPE_ACCOUNT_ID: 'acct_platform' };
      const originalCommit = store.commit.bind(store);
      let fail = true;
      store.commit = async (...args) => { if (fail) { fail = false; throw new Error('simulated failure'); } return originalCommit(...args); };
      const execute = (run: string) => provisionSeedConnect(stripe as never, store, vendors, run, env);
      await expect(execute('run-0001')).rejects.toThrow('simulated failure');
      await expect(execute('run-0002')).rejects.toThrow('SEED_CONNECT_RUN_BUSY');
      await execute('run-0001'); await execute('run-0001');
      expect(accounts.size).toBe(3);
      await execute('run-0002');
      expect(accounts.size).toBe(6);
      for (const v of vendors) {
        const doc = await db.collection('vendors').findOne({ _id: v.id as never });
        expect(doc?.seedConnectHistory).toHaveLength(2);
        expect(doc?.seedConnectHistory[1].previousAccountId).toBe(doc?.seedConnectHistory[0].accountId);
        expect(doc?.stripeAccountId).toBe(doc?.seedConnectHistory[1].accountId);
      }
      await expect(execute('run-0001')).rejects.toThrow('SEED_CONNECT_RUN_BUSY_OR_RETIRED');
      const concurrent = await Promise.allSettled([execute('run-0003'), execute('run-0003')]);
      expect(concurrent.some(result => result.status === 'fulfilled')).toBe(true);
      await execute('run-0003');
      expect(accounts.size).toBe(9);
      for (const v of vendors) {
        const doc = await db.collection('vendors').findOne({ _id: v.id as never });
        expect(doc?.seedConnectHistory.filter((entry: any) => entry.run === 'run-0003')).toHaveLength(1);
      }
    } finally { await client.close(); }
  });
});
