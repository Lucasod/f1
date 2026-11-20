import { Db } from 'mongodb';
import { AcceptedSnapshotV1, AttemptError, CheckoutAttempt, CheckoutAttemptRepository, snapshotHash } from './checkout-attempt';

type AttemptDocument = CheckoutAttempt & { _id: string };

export class MongoCheckoutAttemptRepository implements CheckoutAttemptRepository {
  private readonly collection;
  constructor(db: Db) { this.collection = db.collection<AttemptDocument>('checkout_attempts'); }

  async find(owner: string, id: string): Promise<CheckoutAttempt | null> {
    const doc = await this.collection.findOne({ _id: id, owner });
    if (!doc) return null;
    const { _id, ...record } = doc;
    if (_id !== record.id || snapshotHash(record.proposedSnapshot) !== record.proposedHash ||
      (record.state === 'ACCEPTED' && (!record.acceptedSnapshot || snapshotHash(record.acceptedSnapshot) !== record.acceptedHash || record.acceptedHash !== record.proposedHash))) {
      throw new AttemptError('ATTEMPT_UNAVAILABLE', 503);
    }
    return structuredClone(record);
  }

  async createOrRead(candidate: CheckoutAttempt): Promise<CheckoutAttempt> {
    try { await this.collection.insertOne({ ...structuredClone(candidate), _id: candidate.id }); }
    catch {
      // Both duplicate-key and unknown applied insert are reconciled by authority.
      const stored = await this.find(candidate.owner, candidate.id);
      if (!stored) throw new AttemptError('ATTEMPT_UNAVAILABLE', 503);
      if (stored.requestFingerprint !== candidate.requestFingerprint) throw new AttemptError('REQUEST_CONFLICT', 409);
      return stored;
    }
    return structuredClone(candidate);
  }

  private async cas(current: CheckoutAttempt, set: Partial<CheckoutAttempt>): Promise<CheckoutAttempt> {
    try {
      await this.collection.updateOne({ _id: current.id, owner: current.owner, state: current.state, version: current.version, proposedHash: current.proposedHash }, { $set: structuredClone(set), $inc: { version: 1 } });
    } catch {
      // An exception is not proof the write failed. Read below; never blind retry.
    }
    const stored = await this.find(current.owner, current.id);
    if (!stored) throw new AttemptError('ATTEMPT_UNAVAILABLE', 503);
    if (stored.version === current.version) throw new AttemptError('ATTEMPT_UNAVAILABLE', 503);
    return stored;
  }

  async replaceProposal(current: CheckoutAttempt, snapshot: AcceptedSnapshotV1 | null, error?: string): Promise<CheckoutAttempt> {
    if (current.state === 'ACCEPTED') throw new AttemptError('ATTEMPT_CONFLICT', 409);
    return this.cas(current, snapshot
      ? { state: 'PROPOSED', proposedSnapshot: snapshot, proposedHash: snapshotHash(snapshot), proposalError: '' }
      : { state: 'SUPERSEDED', proposalError: error ?? 'QUOTE_UNAVAILABLE' });
  }

  async acceptIfCurrent(current: CheckoutAttempt): Promise<CheckoutAttempt> {
    if (current.state !== 'PROPOSED') throw new AttemptError('ATTEMPT_CONFLICT', 409, current);
    const stored = await this.cas(current, { state: 'ACCEPTED', acceptedSnapshot: current.proposedSnapshot, acceptedHash: current.proposedHash, acceptedAt: new Date().toISOString() });
    if (stored.state === 'ACCEPTED' && stored.acceptedHash === current.proposedHash) return stored;
    throw new AttemptError('ATTEMPT_CONFLICT', 409, stored);
  }
}

/** Explicit local fallback, with the same detached insert/CAS protocol. */
export class InMemoryCheckoutAttemptRepository extends MongoCheckoutAttemptRepository {
  constructor() {
    const documents = new Map<string, AttemptDocument>();
    super({ collection: () => ({
      insertOne: async (doc: AttemptDocument) => {
        if (documents.has(doc._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        documents.set(doc._id, structuredClone(doc));
      },
      findOne: async (filter: Record<string, unknown>) => structuredClone([...documents.values()].find(doc => Object.entries(filter).every(([k, v]) => (doc as any)[k] === v)) ?? null),
      updateOne: async (filter: Record<string, unknown>, update: any) => {
        const doc = [...documents.values()].find(doc => Object.entries(filter).every(([k, v]) => (doc as any)[k] === v));
        if (!doc) return { matchedCount: 0 };
        Object.assign(doc, structuredClone(update.$set)); doc.version += update.$inc.version;
        return { matchedCount: 1 };
      },
    }) } as unknown as Db);
  }
}
