import type { Db, Document } from 'mongodb';
import type Stripe from 'stripe';
import type { SeedConnectStore, SeedVendor } from './seed.connect';

export class MongoSeedConnectStore implements SeedConnectStore {
  constructor(private readonly db: Db) {}
  async start(run: string, platform: string): Promise<void> {
    const locks = this.db.collection('seed_connect_control');
    try {
      const r = await locks.updateOne(
        { _id: 'f01' as never, platform, $or: [{ run }, { state: 'completed', completedRuns: { $ne: run } }] },
        { $set: { run, platform, state: 'active' }, $setOnInsert: { completedRuns: [] } }, { upsert: true },
      );
      if (!r.matchedCount && !r.upsertedCount) throw new Error('SEED_CONNECT_RUN_BUSY');
    } catch (error: any) {
      if (error?.code === 11000) throw new Error('SEED_CONNECT_RUN_BUSY_OR_RETIRED');
      throw error;
    }
  }
  async finish(run: string): Promise<void> {
    const r = await this.db.collection('seed_connect_control').updateOne(
      { _id: 'f01' as never, run }, { $set: { state: 'completed' }, $addToSet: { completedRuns: run } } as any,
    );
    if (!r.matchedCount) throw new Error('SEED_CONNECT_RUN_LOST');
  }
  async prepare(vendor: SeedVendor, run: string): Promise<{ accountId?: string; startedAt: Date; attempt?: number }> {
    const coll = this.db.collection('vendors');
    const doc = await coll.findOne({ _id: vendor.id as never, personId: vendor.personId });
    if (!doc) throw new Error('SEED_CONNECT_VENDOR_NOT_FOUND');
    const history = (doc.seedConnectHistory || []) as Document[];
    const previous = history.find(h => h.run === run);
    if (previous) {
      if (doc.stripeAccountId !== previous.accountId) throw new Error('SEED_CONNECT_RETIRED_RUN');
      return { accountId: previous.accountId, startedAt: previous.createdAt };
    }
    const startedAt = new Date();
    const r = await coll.updateOne({ _id: vendor.id as never, personId: vendor.personId, seedConnectPending: { $exists: false }, stripeAccountId: doc.stripeAccountId ?? { $exists: false } },
      { $set: { seedConnectPending: { run, startedAt, previousAccountId: doc.stripeAccountId ?? null } } });
    const current = await coll.findOne({ _id: vendor.id as never, personId: vendor.personId });
    if (current?.seedConnectPending?.run !== run) throw new Error('SEED_CONNECT_VENDOR_BUSY');
    return { startedAt: current.seedConnectPending.startedAt, attempt: current.seedConnectPending.attempt ?? 0 };
  }
  async retryRejected(vendor: SeedVendor, run: string, attempt: number): Promise<void> {
    const attemptFilter = attempt === 0 ? { $in: [0, null] } : attempt;
    await this.db.collection('vendors').updateOne(
      { _id: vendor.id as never, personId: vendor.personId, 'seedConnectPending.run': run, 'seedConnectPending.attempt': attemptFilter },
      { $set: { 'seedConnectPending.attempt': attempt + 1 } },
    );
  }
  async commit(vendor: SeedVendor, run: string, account: Stripe.Account): Promise<void> {
    const coll = this.db.collection('vendors');
    const doc = await coll.findOne({ _id: vendor.id as never, personId: vendor.personId, 'seedConnectPending.run': run });
    if (!doc) {
      const existing = await coll.findOne({ _id: vendor.id as never, stripeAccountId: account.id, seedConnectHistory: { $elemMatch: { run, accountId: account.id } } });
      if (existing) return;
      throw new Error('SEED_CONNECT_COMMIT_CONFLICT');
    }
    const previous = doc.seedConnectPending.previousAccountId;
    const filter: Document = { _id: vendor.id, personId: vendor.personId, 'seedConnectPending.run': run, stripeAccountId: previous === null ? { $exists: false } : previous };
    const entry = { run, accountId: account.id, platform: account.metadata?.platform_account_id, previousAccountId: previous, createdAt: new Date() };
    const r = await coll.updateOne(filter, { $set: { stripeAccountId: account.id, updatedAt: new Date() }, $push: { seedConnectHistory: entry }, $unset: { seedConnectPending: '' } } as any);
    if (!r.matchedCount) {
      const existing = await coll.findOne({ _id: vendor.id as never, stripeAccountId: account.id, seedConnectHistory: { $elemMatch: { run, accountId: account.id } } });
      if (!existing) throw new Error('SEED_CONNECT_COMMIT_CONFLICT');
    }
  }
}
