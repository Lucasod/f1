import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Payout, PayoutStatus, PayoutRepository } from './payout.domain';
import { MongoPayoutRepository } from './payout.mongo.repository';

const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB_NAME = 'fs01_marketplace_test';

async function isMongoAvailable(uri: string): Promise<boolean> {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}

const mongoAvailable = await isMongoAvailable(TEST_MONGO_URI);
const describeIfMongo = mongoAvailable
  ? describe
  : (name: string, fn: () => void) => describe.skip(`${name} (MongoDB unavailable at ${TEST_MONGO_URI})`, fn);

describeIfMongo('MongoPayoutRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let payoutsCollection: Collection;
  let repo: PayoutRepository;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);

    payoutsCollection = db.collection('payouts');

    await payoutsCollection.createIndex({ vendorId: 1 });
    await payoutsCollection.createIndex({ personId: 1 });
    await payoutsCollection.createIndex({ status: 1 });
    await payoutsCollection.createIndex({ createdAt: -1 });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await payoutsCollection.deleteMany({});
    repo = new MongoPayoutRepository(db);
  });

  describe('MongoPayoutRepository - Contract Compliance', () => {
    it('should implement PayoutRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findByVendorId).toBe('function');
      expect(typeof repo.findByPersonId).toBe('function');
      expect(typeof repo.findAll).toBe('function');
      expect(typeof repo.update).toBe('function');
    });

    it('should save and find payout by ID', async () => {
      const payout = createTestPayout();

      await repo.save(payout);
      const found = await repo.findById(payout.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(payout.id);
      expect(found!.vendorId).toBe(payout.vendorId);
      expect(found!.personId).toBe(payout.personId);
      expect(found!.amount).toBe(payout.amount);
      expect(found!.status).toBe(PayoutStatus.PENDING);
    });

    it('should find payouts by vendor ID', async () => {
      const payout1 = createTestPayout({ vendorId: 'vendor-1', amount: 100 });
      const payout2 = createTestPayout({ vendorId: 'vendor-1', amount: 50 });
      const payout3 = createTestPayout({ vendorId: 'vendor-2', amount: 200 });

      await repo.save(payout1);
      await repo.save(payout2);
      await repo.save(payout3);

      const vendor1Payouts = await repo.findByVendorId('vendor-1');
      const vendor2Payouts = await repo.findByVendorId('vendor-2');

      expect(vendor1Payouts).toHaveLength(2);
      expect(vendor2Payouts).toHaveLength(1);
      expect(vendor1Payouts.every(p => p.vendorId === 'vendor-1')).toBe(true);
      expect(vendor2Payouts[0].vendorId).toBe('vendor-2');
    });

    it('should find payouts by person ID', async () => {
      const payout1 = createTestPayout({ personId: 'person-1', amount: 100 });
      const payout2 = createTestPayout({ personId: 'person-1', amount: 50 });
      const payout3 = createTestPayout({ personId: 'person-2', amount: 200 });

      await repo.save(payout1);
      await repo.save(payout2);
      await repo.save(payout3);

      const person1Payouts = await repo.findByPersonId('person-1');
      const person2Payouts = await repo.findByPersonId('person-2');

      expect(person1Payouts).toHaveLength(2);
      expect(person2Payouts).toHaveLength(1);
      expect(person1Payouts.every(p => p.personId === 'person-1')).toBe(true);
      expect(person2Payouts[0].personId).toBe('person-2');
    });

    it('should find all payouts sorted by createdAt descending', async () => {
      const payout1 = createTestPayout({ vendorId: 'vendor-a' });
      await new Promise(resolve => setTimeout(resolve, 20));
      const payout2 = createTestPayout({ vendorId: 'vendor-b' });
      await new Promise(resolve => setTimeout(resolve, 20));
      const payout3 = createTestPayout({ vendorId: 'vendor-c' });

      await repo.save(payout1);
      await repo.save(payout2);
      await repo.save(payout3);

      const all = await repo.findAll();

      expect(all).toHaveLength(3);
      expect(all[0].id).toBe(payout3.id);
      expect(all[1].id).toBe(payout2.id);
      expect(all[2].id).toBe(payout1.id);
    });

    it('should update existing payout', async () => {
      const payout = createTestPayout();
      await repo.save(payout);

      const found = await repo.findById(payout.id);
      expect(found).not.toBeNull();

      found!.approve();
      await repo.update(found!);

      const updated = await repo.findById(payout.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe(PayoutStatus.APPROVED);
    });

    it('should persist all Payout fields', async () => {
      const payout = createTestPayout({
        vendorId: 'vendor-x',
        personId: 'person-x',
        amount: 299.99,
        bankAccount: 'bank-123',
        reference: 'ref-abc',
      });

      await repo.save(payout);
      const found = await repo.findById(payout.id);

      expect(found).not.toBeNull();
      expect(found!.vendorId).toBe('vendor-x');
      expect(found!.personId).toBe('person-x');
      expect(found!.amount).toBe(299.99);
      expect(found!.status).toBe(PayoutStatus.PENDING);
      expect(found!.bankAccount).toBe('bank-123');
      expect(found!.reference).toBe('ref-abc');
      expect(found!.requestedAt).toBeInstanceOf(Date);
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist payout status transitions', async () => {
      const payout = createTestPayout();
      await repo.save(payout);

      const found = await repo.findById(payout.id);
      expect(found).not.toBeNull();

      found!.approve();
      await repo.update(found!);

      let updated = await repo.findById(payout.id);
      expect(updated!.status).toBe(PayoutStatus.APPROVED);

      updated!.startProcessing();
      await repo.update(updated!);

      updated = await repo.findById(payout.id);
      expect(updated!.status).toBe(PayoutStatus.PROCESSING);

      updated!.complete();
      await repo.update(updated!);

      updated = await repo.findById(payout.id);
      expect(updated!.status).toBe(PayoutStatus.COMPLETED);
      expect(updated!.processedAt).toBeInstanceOf(Date);
    });

    it('should persist failure reason', async () => {
      const payout = createTestPayout();
      await repo.save(payout);

      const found = await repo.findById(payout.id);
      expect(found).not.toBeNull();

      found!.approve();
      found!.startProcessing();
      found!.fail('insufficient funds');
      await repo.update(found!);

      const updated = await repo.findById(payout.id);
      expect(updated!.status).toBe(PayoutStatus.FAILED);
      expect(updated!.failureReason).toBe('insufficient funds');
    });

    it('should return null for non-existent payout', async () => {
      const found = await repo.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should return empty array for vendor with no payouts', async () => {
      const payouts = await repo.findByVendorId('non-existent-vendor');
      expect(payouts).toEqual([]);
    });

    it('should return empty array for person with no payouts', async () => {
      const payouts = await repo.findByPersonId('non-existent-person');
      expect(payouts).toEqual([]);
    });
  });
});

function createTestPayout(overrides: Partial<{
  vendorId: string;
  personId: string;
  amount: number;
  bankAccount: string;
  reference: string;
}> = {}): Payout {
  return Payout.create({
    vendorId: overrides.vendorId ?? 'test-vendor',
    personId: overrides.personId ?? 'test-person',
    amount: overrides.amount ?? 150,
    bankAccount: overrides.bankAccount,
    reference: overrides.reference,
  });
}
