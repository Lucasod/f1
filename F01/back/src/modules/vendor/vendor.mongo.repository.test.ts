import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Vendor, VendorStatus, VendorRepository } from './vendor.domain';
import { MongoVendorRepository } from './vendor.mongo.repository';

// Test database configuration
const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB_NAME = 'fs01_marketplace_test';

describe('MongoVendorRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let vendorsCollection: Collection;
  let repo: VendorRepository;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);

    vendorsCollection = db.collection('vendors');

    // Create indexes
    await vendorsCollection.createIndex({ slug: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
    await vendorsCollection.createIndex({ personId: 1 }, { unique: true });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    // Clear collection before each test
    await vendorsCollection.deleteMany({});

    // Create repository instance
    repo = new MongoVendorRepository(db);
  });

  describe('MongoVendorRepository - Contract Compliance', () => {
    it('should implement VendorRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findBySlug).toBe('function');
      expect(typeof repo.findByPersonId).toBe('function');
      expect(typeof repo.update).toBe('function');
      expect(typeof repo.delete).toBe('function');
    });

    it('should save and find vendor by ID', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'My Store',
        slug: 'my-store',
        commissionPct: 15
      });

      await repo.save(vendor);
      const found = await repo.findById(vendor.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(vendor.id);
      expect(found!.storeName).toBe('My Store');
      expect(found!.slug).toBe('my-store');
      expect(found!.personId).toBe('person-123');
      expect(found!.commissionPct).toBe(15);
      expect(found!.status).toBe(VendorStatus.ACTIVE);
    });

    it('should find vendor by slug (case-insensitive)', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'My Store',
        slug: 'My-Store',
        commissionPct: 10
      });

      await repo.save(vendor);
      const found = await repo.findBySlug('my-store');

      expect(found).not.toBeNull();
      expect(found!.slug).toBe('my-store');
      expect(found!.storeName).toBe('My Store');
    });

    it('should return null for non-existent slug', async () => {
      const found = await repo.findBySlug('nonexistent-slug');
      expect(found).toBeNull();
    });

    it('should find vendor by personId', async () => {
      const vendor = Vendor.create({
        personId: 'person-456',
        storeName: 'Vendor Store',
        slug: 'vendor-store',
        commissionPct: 12
      });

      await repo.save(vendor);
      const found = await repo.findByPersonId('person-456');

      expect(found).not.toBeNull();
      expect(found!.personId).toBe('person-456');
      expect(found!.storeName).toBe('Vendor Store');
    });

    it('should return null for non-existent personId', async () => {
      const found = await repo.findByPersonId('nonexistent-person');
      expect(found).toBeNull();
    });

    it('should update vendor preserving required fields', async () => {
      const vendor = Vendor.create({
        personId: 'person-789',
        storeName: 'Original Store',
        slug: 'original-store',
        commissionPct: 8
      });

      await repo.save(vendor);

      // Update store name
      vendor.updateStoreName('Updated Store');
      const updated = await repo.update(vendor);

      expect(updated.storeName).toBe('Updated Store');
      expect(updated.slug).toBe('original-store');
      expect(updated.personId).toBe('person-789');
      expect(updated.commissionPct).toBe(8);
      expect(updated.status).toBe(VendorStatus.ACTIVE);
      expect(updated.id).toBe(vendor.id);
      expect(updated.createdAt).toEqual(vendor.createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(vendor.updatedAt.getTime());
    });

    it('should reject duplicate slugs (case-insensitive)', async () => {
      const vendor1 = Vendor.create({
        personId: 'person-111',
        storeName: 'Store One',
        slug: 'my-store',
        commissionPct: 10
      });

      const vendor2 = Vendor.create({
        personId: 'person-222',
        storeName: 'Store Two',
        slug: 'MY-STORE', // Same slug, different case
        commissionPct: 15
      });

      await repo.save(vendor1);
      await expect(repo.save(vendor2)).rejects.toThrow('SLUG_ALREADY_EXISTS');
    });

    it('should reject duplicate personId associations (1:1 rule)', async () => {
      const vendor1 = Vendor.create({
        personId: 'shared-person',
        storeName: 'Store One',
        slug: 'store-one',
        commissionPct: 10
      });

      const vendor2 = Vendor.create({
        personId: 'shared-person', // Same personId
        storeName: 'Store Two',
        slug: 'store-two',
        commissionPct: 15
      });

      await repo.save(vendor1);
      await expect(repo.save(vendor2)).rejects.toThrow('PERSON_ALREADY_HAS_VENDOR');
    });

    it('should persist all Vendor fields completely', async () => {
      const vendor = Vendor.create({
        personId: 'person-full',
        storeName: 'Full Fields Store',
        slug: 'full-fields-store',
        commissionPct: 20
      });

      vendor.suspend();

      await repo.save(vendor);
      const found = await repo.findById(vendor.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(vendor.id);
      expect(found!.personId).toBe('person-full');
      expect(found!.storeName).toBe('Full Fields Store');
      expect(found!.slug).toBe('full-fields-store');
      expect(found!.status).toBe(VendorStatus.SUSPENDED);
      expect(found!.commissionPct).toBe(20);
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
      expect(found!.createdAt.getTime()).toBeLessThanOrEqual(found!.updatedAt.getTime());
    });

    it('should persist data between repository instances', async () => {
      const vendor = Vendor.create({
        personId: 'person-persist',
        storeName: 'Persist Store',
        slug: 'persist-store',
        commissionPct: 18
      });

      await repo.save(vendor);

      // Create a new repository instance (simulating app restart)
      const newRepo = new MongoVendorRepository(db);
      const found = await newRepo.findById(vendor.id);

      expect(found).not.toBeNull();
      expect(found!.storeName).toBe('Persist Store');
      expect(found!.slug).toBe('persist-store');
      expect(found!.personId).toBe('person-persist');
      expect(found!.commissionPct).toBe(18);
    });

    it('should delete vendor', async () => {
      const vendor = Vendor.create({
        personId: 'person-delete',
        storeName: 'Delete Store',
        slug: 'delete-store',
        commissionPct: 10
      });

      await repo.save(vendor);
      await repo.delete(vendor.id);

      const found = await repo.findById(vendor.id);
      expect(found).toBeNull();

      // Verify slug and personId indexes are cleaned up
      const bySlug = await repo.findBySlug('delete-store');
      const byPerson = await repo.findByPersonId('person-delete');
      expect(bySlug).toBeNull();
      expect(byPerson).toBeNull();
    });

    it('should use default commissionPct of 10 when not provided', async () => {
      const vendor = Vendor.create({
        personId: 'person-default',
        storeName: 'Default Commission',
        slug: 'default-commission'
      });

      await repo.save(vendor);
      const found = await repo.findById(vendor.id);

      expect(found).not.toBeNull();
      expect(found!.commissionPct).toBe(10);
    });
  });
});