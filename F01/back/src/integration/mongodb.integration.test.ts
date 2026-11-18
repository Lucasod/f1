import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Person, PersonRole, PersonRepository, ContactInfo, Address, MainInfo } from '../modules/person/person.domain';
import { Vendor, VendorStatus, VendorRepository } from '../modules/vendor/vendor.domain';
import { Category, CategoryRepository, ProductError } from '../modules/product/product.domain';
import { Product, ProductStatus, ProductRepository } from '../modules/product/product.domain';
import { MongoPersonRepository } from '../modules/person/person.mongo.repository';
import { MongoVendorRepository } from '../modules/vendor/vendor.mongo.repository';
import { MongoCategoryRepository } from '../modules/product/category.mongo.repository';
import { MongoProductRepository } from '../modules/product/product.mongo.repository';
import { ACCOUNTS, createMongoSeedRepositories, runDevelopmentSeed, runSeed } from '../scripts/seed';
import { SeedRepositories } from '../shared/seed.types';
import { AuthService } from '../modules/auth/auth.service';

// Test database configuration
const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB_NAME = 'fs01_marketplace_integration_test';

// MongoDB availability check utility
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

// Check MongoDB availability before registering tests
const mongoAvailable = await isMongoAvailable(TEST_MONGO_URI);
const describeIfMongo = mongoAvailable
  ? describe
  : (name: string, fn: () => void) => describe.skip(`${name} (MongoDB unavailable at ${TEST_MONGO_URI})`, fn);

describeIfMongo('MongoDB Integration Tests', () => {
  let client: MongoClient;
  let db: Db;
  
  // Collections for index verification
  let peopleCollection: Collection;
  let mainInfosCollection: Collection;
  let credentialsCollection: Collection;
  let addressesCollection: Collection;
  let contactInfosCollection: Collection;
  let vendorsCollection: Collection;
  let categoriesCollection: Collection;
  let productsCollection: Collection;

  // Repository instances
  let personRepo: PersonRepository;
  let vendorRepo: VendorRepository;
  let categoryRepo: CategoryRepository;
  let productRepo: ProductRepository;

  // Track seeded data IDs for persistence verification
  let seededPersonIds: string[] = [];
  let seededVendorIds: string[] = [];
  let seededCategoryIds: string[] = [];
  let seededProductIds: string[] = [];

  beforeAll(async () => {
    // Initialize MongoDB connection
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);

    // Get collection references
    peopleCollection = db.collection('people');
    mainInfosCollection = db.collection('main_infos');
    credentialsCollection = db.collection('credentials');
    addressesCollection = db.collection('addresses');
    contactInfosCollection = db.collection('contact_infos');
    vendorsCollection = db.collection('vendors');
    categoriesCollection = db.collection('categories');
    productsCollection = db.collection('products');

    // Create indexes for all collections
    // Person indexes
    await peopleCollection.createIndex({ roles: 1 });
    await mainInfosCollection.createIndex({ person_id: 1 }, { unique: true });
    await mainInfosCollection.createIndex({ 'tax_id.value': 1 }, { unique: true });
    await credentialsCollection.createIndex({ person_id: 1 }, { unique: true });
    await addressesCollection.createIndex({ person_id: 1, is_primary: -1 });
    await contactInfosCollection.createIndex({ person_id: 1 });
    await contactInfosCollection.createIndex(
      { type: 1, value: 1 },
      { unique: true, partialFilterExpression: { type: 'email' } }
    );

    // Vendor indexes
    await vendorsCollection.createIndex({ slug: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
    await vendorsCollection.createIndex({ personId: 1 }, { unique: true });

    // Category indexes
    await categoriesCollection.createIndex({ slug: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
    await categoriesCollection.createIndex({ parentId: 1 });
    await categoriesCollection.createIndex({ path: 1 });

    // Product indexes
    await productsCollection.createIndex({ vendorId: 1 });
    await productsCollection.createIndex({ categoryId: 1 });
    await productsCollection.createIndex(
      { seedIdentity: 1 },
      { unique: true, partialFilterExpression: { seedIdentity: { $type: 'string' } } }
    );

    // Create repository instances
    personRepo = new MongoPersonRepository(db);
    vendorRepo = new MongoVendorRepository(db);
    categoryRepo = new MongoCategoryRepository(db);
    productRepo = new MongoProductRepository(db);
  });

  afterAll(async () => {
    // Graceful connection closing
    await client.close();
  });

  beforeEach(async () => {
    // Clear all collections before each test
    await Promise.all([
      peopleCollection.deleteMany({}),
      mainInfosCollection.deleteMany({}),
      credentialsCollection.deleteMany({}),
      addressesCollection.deleteMany({}),
      contactInfosCollection.deleteMany({}),
      vendorsCollection.deleteMany({}),
      categoriesCollection.deleteMany({}),
      productsCollection.deleteMany({}),
    ]);

    // Reset seeded IDs tracker
    seededPersonIds = [];
    seededVendorIds = [];
    seededCategoryIds = [];
    seededProductIds = [];

    // Create fresh repository instances
    personRepo = new MongoPersonRepository(db);
    vendorRepo = new MongoVendorRepository(db);
    categoryRepo = new MongoCategoryRepository(db);
    productRepo = new MongoProductRepository(db);
  });

  describe('1. MongoDB Connection Initialization', () => {
    it('should establish connection to MongoDB', async () => {
      expect(client).toBeDefined();
      expect(db).toBeDefined();
      
      // Verify connection is alive by pinging
      const adminDb = client.db('admin');
      await adminDb.command({ ping: 1 });
    });

    it('should access the test database', async () => {
      expect(db.databaseName).toBe(TEST_DB_NAME);
    });
  });

  describe('2. Index Creation for All Collections', () => {
    it('should have all person-related indexes created', async () => {
      const peopleIndexes = await peopleCollection.indexes();
      const mainInfoIndexes = await mainInfosCollection.indexes();
      const credentialIndexes = await credentialsCollection.indexes();
      const addressIndexes = await addressesCollection.indexes();
      const contactIndexes = await contactInfosCollection.indexes();

      // Verify people indexes
      expect(peopleIndexes.some(idx => idx.key.roles === 1)).toBe(true);

      // Verify main_infos indexes
      expect(mainInfoIndexes.some(idx => idx.key.person_id === 1 && idx.unique === true)).toBe(true);
      expect(mainInfoIndexes.some(idx => idx.key['tax_id.value'] === 1 && idx.unique === true)).toBe(true);

      // Verify credentials indexes
      expect(credentialIndexes.some(idx => idx.key.person_id === 1 && idx.unique === true)).toBe(true);

      // Verify addresses indexes
      expect(addressIndexes.some(idx => idx.key.person_id === 1 && idx.key.is_primary === -1)).toBe(true);

      // Verify contact_infos indexes
      expect(contactIndexes.some(idx => idx.key.person_id === 1)).toBe(true);
      const emailUniqueIndex = contactIndexes.find(idx => idx.key.type === 1 && idx.key.value === 1 && idx.unique === true);
      expect(emailUniqueIndex).toBeDefined();
      expect(emailUniqueIndex?.partialFilterExpression?.type).toBe('email');
    });

    it('should have vendor indexes created', async () => {
      const vendorIndexes = await vendorsCollection.indexes();
      
      expect(vendorIndexes.some(idx => idx.key.slug === 1 && idx.unique === true)).toBe(true);
      expect(vendorIndexes.some(idx => idx.key.personId === 1 && idx.unique === true)).toBe(true);
    });

    it('should have category indexes created', async () => {
      const categoryIndexes = await categoriesCollection.indexes();
      
      expect(categoryIndexes.some(idx => idx.key.slug === 1 && idx.unique === true)).toBe(true);
      expect(categoryIndexes.some(idx => idx.key.parentId === 1)).toBe(true);
      expect(categoryIndexes.some(idx => idx.key.path === 1)).toBe(true);
    });

    it('should have product indexes created', async () => {
      const productIndexes = await productsCollection.indexes();
      
      expect(productIndexes.some(idx => idx.key.vendorId === 1)).toBe(true);
      expect(productIndexes.some(idx => idx.key.categoryId === 1)).toBe(true);
    });
  });

  describe('3. MongoDB Repositories Integration with Services', () => {
    it('should create all repository instances correctly', () => {
      expect(personRepo).toBeInstanceOf(MongoPersonRepository);
      expect(vendorRepo).toBeInstanceOf(MongoVendorRepository);
      expect(categoryRepo).toBeInstanceOf(MongoCategoryRepository);
      expect(productRepo).toBeInstanceOf(MongoProductRepository);

      // Verify all implement their respective interfaces
      expect(typeof personRepo.save).toBe('function');
      expect(typeof personRepo.findById).toBe('function');
      expect(typeof personRepo.findByEmail).toBe('function');
      expect(typeof personRepo.findByTaxId).toBe('function');
      expect(typeof personRepo.delete).toBe('function');

      expect(typeof vendorRepo.save).toBe('function');
      expect(typeof vendorRepo.findById).toBe('function');
      expect(typeof vendorRepo.findBySlug).toBe('function');
      expect(typeof vendorRepo.findByPersonId).toBe('function');
      expect(typeof vendorRepo.update).toBe('function');
      expect(typeof vendorRepo.delete).toBe('function');

      expect(typeof categoryRepo.save).toBe('function');
      expect(typeof categoryRepo.findById).toBe('function');
      expect(typeof categoryRepo.findBySlug).toBe('function');
      expect(typeof categoryRepo.findByParentId).toBe('function');
      expect(typeof categoryRepo.findAll).toBe('function');
      expect(typeof categoryRepo.update).toBe('function');
      expect(typeof categoryRepo.delete).toBe('function');

      expect(typeof productRepo.save).toBe('function');
      expect(typeof productRepo.findById).toBe('function');
      expect(typeof productRepo.findByVendorId).toBe('function');
      expect(typeof productRepo.findByCategoryId).toBe('function');
      expect(typeof productRepo.findAll).toBe('function');
      expect(typeof productRepo.update).toBe('function');
      expect(typeof productRepo.delete).toBe('function');
    });

    it('should save and retrieve Person through repository', async () => {
      const person = Person.create({
        name: 'Integration Test User',
        mainInfo: { name: 'Integration Test User', taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'integration@test.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.CONSUMER);

      const saved = await personRepo.save(person);
      expect(saved.id).toBe(person.id);
      expect(saved.name).toBe('Integration Test User');

      const found = await personRepo.findById(person.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Integration Test User');
      expect(found!.roles).toContain(PersonRole.CONSUMER);
    });

    it('should save and retrieve Vendor through repository', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Integration Store',
        slug: 'integration-store',
        commissionPct: 15
      });

      const saved = await vendorRepo.save(vendor);
      expect(saved.id).toBe(vendor.id);
      expect(saved.storeName).toBe('Integration Store');

      const found = await vendorRepo.findById(vendor.id);
      expect(found).not.toBeNull();
      expect(found!.storeName).toBe('Integration Store');
      expect(found!.slug).toBe('integration-store');
    });

    it('should save and retrieve Category through repository', async () => {
      const category = Category.create({
        name: 'Integration Category',
        slug: 'integration-category',
        parentId: null
      });

      const saved = await categoryRepo.save(category);
      expect(saved.id).toBe(category.id);
      expect(saved.name).toBe('Integration Category');

      const found = await categoryRepo.findById(category.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Integration Category');
      expect(found!.slug).toBe('integration-category');
    });

    it('should save and retrieve Product through repository', async () => {
      const product = Product.create({
        vendorId: 'vendor-123',
        categoryId: 'cat-456',
        name: 'Integration Product',
        description: 'Test product for integration',
        price: 99.99,
        quantity: 10
      });

      const saved = await productRepo.save(product);
      expect(saved.id).toBe(product.id);
      expect(saved.name).toBe('Integration Product');

      const found = await productRepo.findById(product.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Integration Product');
      expect(found!.price).toBe(99.99);
    });
  });

  describe('4. Seed Running with MongoDB Repositories (Idempotent)', () => {
    it('should run seed successfully with MongoDB repositories', async () => {
      // Create a compatible repositories object for the seed function
      // The seed function uses the interface methods, so MongoDB repos work with type assertion
      const mongoRepositories: SeedRepositories = {
        personRepo: personRepo as any,
        vendorRepo: vendorRepo as any,
        categoryRepo: categoryRepo as any,
        productRepo: productRepo as any,
      };

      await runSeed(mongoRepositories);

      // Verify categories were created (6 categories: 4 root + 2 children)
      const categories = await categoryRepo.findAll();
      expect(categories.length).toBe(6);

      // Verify vendors were created (3 vendors)
      const allPersons = await Promise.all(
        categories.map(() => personRepo.findById('dummy')) // placeholder to force async
      );
      
      // Get persons by checking all - we'll use a different approach
      // Since we can't easily iterate all persons, verify through vendor repo
      const vendors = await Promise.all(
        ['tech-store', 'fashion-hub', 'book-world'].map(slug => vendorRepo.findBySlug(slug))
      );
      expect(vendors.every(v => v !== null)).toBe(true);
      expect(vendors.length).toBe(3);

      // Verify products were created (12 products)
      const products = await productRepo.findAll();
      expect(products.length).toBe(12);
      expect(products.every(p => p.status === ProductStatus.ACTIVE)).toBe(true);

      // Track IDs for persistence test
      seededCategoryIds = categories.map(c => c.id);
      seededVendorIds = vendors.map(v => v!.id);
      seededProductIds = products.map(p => p.id);

      // Get vendor persons to track person IDs
      for (const vendor of vendors) {
        if (vendor) {
          const person = await personRepo.findById(vendor.personId);
          if (person) seededPersonIds.push(person.id);
        }
      }
    });

    it('should be idempotent - running seed twice does not duplicate data', async () => {
      const mongoRepositories: SeedRepositories = {
        personRepo: personRepo as any,
        vendorRepo: vendorRepo as any,
        categoryRepo: categoryRepo as any,
        productRepo: productRepo as any,
      };

      // First run
      await runSeed(mongoRepositories);
      const categoriesAfterFirst = await categoryRepo.findAll();
      const productsAfterFirst = await productRepo.findAll();
      
      // Count vendor persons
      const vendorPersonsAfterFirst: any[] = [];
      for (const vendor of await Promise.all(['tech-store', 'fashion-hub', 'book-world'].map(s => vendorRepo.findBySlug(s)))) {
        if (vendor) {
          const person = await personRepo.findById(vendor.personId);
          if (person) vendorPersonsAfterFirst.push(person);
        }
      }

      expect(categoriesAfterFirst.length).toBe(6);
      expect(productsAfterFirst.length).toBe(12);
      expect(vendorPersonsAfterFirst.length).toBe(3);

      // Second run on same repositories
      await runSeed(mongoRepositories);

      // Verify counts remain unchanged
      const categoriesAfterSecond = await categoryRepo.findAll();
      const productsAfterSecond = await productRepo.findAll();
      
      const vendorPersonsAfterSecond: any[] = [];
      for (const vendor of await Promise.all(['tech-store', 'fashion-hub', 'book-world'].map(s => vendorRepo.findBySlug(s)))) {
        if (vendor) {
          const person = await personRepo.findById(vendor.personId);
          if (person) vendorPersonsAfterSecond.push(person);
        }
      }

      expect(categoriesAfterSecond.length).toBe(6);
      expect(productsAfterSecond.length).toBe(12);
      expect(vendorPersonsAfterSecond.length).toBe(3);

      // Verify same deterministic IDs
      const firstCategoryIds = categoriesAfterFirst.map(c => c.id).sort();
      const secondCategoryIds = categoriesAfterSecond.map(c => c.id).sort();
      expect(firstCategoryIds).toEqual(secondCategoryIds);

      const firstProductIds = productsAfterFirst.map(p => p.id).sort();
      const secondProductIds = productsAfterSecond.map(p => p.id).sort();
      expect(firstProductIds).toEqual(secondProductIds);

      const firstVendorEmails = vendorPersonsAfterFirst.map(p => p.email).sort();
      const secondVendorEmails = vendorPersonsAfterSecond.map(p => p.email).sort();
      expect(firstVendorEmails).toEqual(secondVendorEmails);
    });

    it('recreates missing demo accounts in MongoDB without reseeding an existing catalog', async () => {
      const mongoRepositories = createMongoSeedRepositories(db);

      await runSeed(mongoRepositories);
      const productsBefore = await productRepo.findAll();
      for (const account of ACCOUNTS) {
        await personRepo.delete(account.id);
      }

      await runDevelopmentSeed(mongoRepositories);

      const productsAfter = await productRepo.findAll();
      expect(productsAfter.map(product => product.id).sort())
        .toEqual(productsBefore.map(product => product.id).sort());

      const authService = new AuthService(personRepo, 'seed-test-secret', '24h');
      for (const account of ACCOUNTS) {
        const { person } = await authService.login({
          email: account.email,
          password: account.password,
        });
        expect(person.id).toBe(account.id);
        expect(person.roles).toEqual([account.role]);
      }

      const consumer = await personRepo.findByEmail('consumer@example.com');
      expect(consumer?.addresses).toHaveLength(1);
      expect(await peopleCollection.countDocuments({ roles: 'ADMIN' })).toBe(1);
      expect(await peopleCollection.countDocuments({ roles: 'CONSUMER' })).toBe(4);
    });

    it('should maintain referential integrity between seeded entities', async () => {
      const mongoRepositories: SeedRepositories = {
        personRepo: personRepo as any,
        vendorRepo: vendorRepo as any,
        categoryRepo: categoryRepo as any,
        productRepo: productRepo as any,
      };

      await runSeed(mongoRepositories);

      const products = await productRepo.findAll();
      const categories = await categoryRepo.findAll();
      const categoryIds = new Set(categories.map(c => c.id));

      // Every product's categoryId should reference an existing category
      for (const product of products) {
        expect(categoryIds.has(product.categoryId)).toBe(true);
      }

      // Every product's vendorId should reference an existing vendor
      const vendorIds = new Set<string>();
      for (const slug of ['tech-store', 'fashion-hub', 'book-world']) {
        const vendor = await vendorRepo.findBySlug(slug);
        if (vendor) vendorIds.add(vendor.id);
      }

      for (const product of products) {
        expect(vendorIds.has(product.vendorId)).toBe(true);
      }
    });
  });

  describe('5. Data Persistence After App Restart Simulation', () => {
    it('should persist Person data after creating new repository instances', async () => {
      const person = Person.create({
        name: 'Persistence Test User',
        mainInfo: { name: 'Persistence Test User', taxIdType: 'CPF', taxIdValue: '52998224799' },
        contactInfos: [{ type: 'email', value: 'persist@test.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.CONSUMER);

      await personRepo.save(person);
      const originalId = person.id;

      // Simulate app restart by creating new repository instances
      const newPersonRepo = new MongoPersonRepository(db);
      const found = await newPersonRepo.findById(originalId);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(originalId);
      expect(found!.name).toBe('Persistence Test User');
      expect(found!.email).toBe('persist@test.com');
      expect(found!.roles).toContain(PersonRole.CONSUMER);
    });

    it('should persist Vendor data after creating new repository instances', async () => {
      const vendor = Vendor.create({
        personId: 'person-persist-1',
        storeName: 'Persist Store',
        slug: 'persist-store',
        commissionPct: 18
      });

      await vendorRepo.save(vendor);
      const originalId = vendor.id;

      // Simulate app restart
      const newVendorRepo = new MongoVendorRepository(db);
      const found = await newVendorRepo.findById(originalId);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(originalId);
      expect(found!.storeName).toBe('Persist Store');
      expect(found!.slug).toBe('persist-store');
      expect(found!.commissionPct).toBe(18);
    });

    it('should persist Category data after creating new repository instances', async () => {
      const category = Category.create({
        name: 'Persist Category',
        slug: 'persist-category',
        parentId: null
      });

      await categoryRepo.save(category);
      const originalId = category.id;

      // Simulate app restart
      const newCategoryRepo = new MongoCategoryRepository(db);
      const found = await newCategoryRepo.findById(originalId);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(originalId);
      expect(found!.name).toBe('Persist Category');
      expect(found!.slug).toBe('persist-category');
      expect(found!.path).toBe('/persist-category/');
    });

    it('should persist Product data after creating new repository instances', async () => {
      const product = Product.create({
        vendorId: 'vendor-persist',
        categoryId: 'cat-persist',
        name: 'Persist Product',
        description: 'Test persistence',
        price: 10,
        quantity: 5
      });

      await productRepo.save(product);
      const originalId = product.id;

      // Simulate app restart
      const newProductRepo = new MongoProductRepository(db);
      const found = await newProductRepo.findById(originalId);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(originalId);
      expect(found!.name).toBe('Persist Product');
      expect(found!.vendorId).toBe('vendor-persist');
      expect(found!.categoryId).toBe('cat-persist');
    });

    it('should persist seeded data after simulating app restart', async () => {
      const mongoRepositories: SeedRepositories = {
        personRepo: personRepo as any,
        vendorRepo: vendorRepo as any,
        categoryRepo: categoryRepo as any,
        productRepo: productRepo as any,
      };

      // Run seed
      await runSeed(mongoRepositories);

      // Capture initial state
      const initialCategories = await categoryRepo.findAll();
      const initialProducts = await productRepo.findAll();
      const initialVendors = await Promise.all(
        ['tech-store', 'fashion-hub', 'book-world'].map(s => vendorRepo.findBySlug(s))
      );
      const initialVendorIds = initialVendors.filter(v => v !== null).map(v => v!.id);
      const initialCategoryIds = initialCategories.map(c => c.id);
      const initialProductIds = initialProducts.map(p => p.id);

      // Simulate app restart - create ALL new repository instances
      const newPersonRepo = new MongoPersonRepository(db);
      const newVendorRepo = new MongoVendorRepository(db);
      const newCategoryRepo = new MongoCategoryRepository(db);
      const newProductRepo = new MongoProductRepository(db);

      // Verify all seeded data persists
      const persistedCategories = await newCategoryRepo.findAll();
      expect(persistedCategories.length).toBe(6);
      expect(persistedCategories.map(c => c.id).sort()).toEqual(initialCategoryIds.sort());

      const persistedProducts = await newProductRepo.findAll();
      expect(persistedProducts.length).toBe(12);
      expect(persistedProducts.map(p => p.id).sort()).toEqual(initialProductIds.sort());

      const persistedVendors = await Promise.all(
        ['tech-store', 'fashion-hub', 'book-world'].map(s => newVendorRepo.findBySlug(s))
      );
      const persistedVendorIds = persistedVendors.filter(v => v !== null).map(v => v!.id);
      expect(persistedVendorIds.sort()).toEqual(initialVendorIds.sort());

      // Verify referential integrity still holds
      for (const product of persistedProducts) {
        expect(initialCategoryIds).toContain(product.categoryId);
        expect(initialVendorIds).toContain(product.vendorId);
      }
    });
  });

  describe('6. Graceful Connection Closing', () => {
    it('should close connection properly', async () => {
      // Create a separate client for this test to not affect other tests
      const testClient = new MongoClient(TEST_MONGO_URI);
      await testClient.connect();
      
      // Connection should be open
      const adminDb = testClient.db('admin');
      await expect(adminDb.command({ ping: 1 })).resolves.toBeDefined();

      // Close connection
      await testClient.close();

      // Connection should be closed
      await expect(adminDb.command({ ping: 1 })).rejects.toThrow();
    });

    it('should handle multiple close calls gracefully', async () => {
      // Create a separate client for this test
      const testClient = new MongoClient(TEST_MONGO_URI);
      await testClient.connect();
      
      await testClient.close();
      // Second close should not throw
      await expect(testClient.close()).resolves.not.toThrow();
    });
  });

  describe('End-to-End Integration Flow', () => {
    it('should complete full cycle: connect -> index -> repo -> seed -> persist -> restart -> verify -> close', async () => {
      // This test verifies the complete integration flow
      // 1. Connection already established in beforeAll
      // 2. Indexes already created in beforeAll
      // 3. Repositories already created in beforeAll

      // 4. Run seed
      const mongoRepositories: SeedRepositories = {
        personRepo: personRepo as any,
        vendorRepo: vendorRepo as any,
        categoryRepo: categoryRepo as any,
        productRepo: productRepo as any,
      };

      await runSeed(mongoRepositories);

      // 5. Verify seed data
      const categories = await categoryRepo.findAll();
      const products = await productRepo.findAll();
      const vendors = await Promise.all(
        ['tech-store', 'fashion-hub', 'book-world'].map(s => vendorRepo.findBySlug(s))
      );

      expect(categories.length).toBe(6);
      expect(products.length).toBe(12);
      expect(vendors.filter(v => v !== null).length).toBe(3);

      // 6. Simulate app restart
      const newPersonRepo = new MongoPersonRepository(db);
      const newVendorRepo = new MongoVendorRepository(db);
      const newCategoryRepo = new MongoCategoryRepository(db);
      const newProductRepo = new MongoProductRepository(db);

      // 7. Verify data persists after restart
      const persistedCategories = await newCategoryRepo.findAll();
      const persistedProducts = await newProductRepo.findAll();
      const persistedVendors = await Promise.all(
        ['tech-store', 'fashion-hub', 'book-world'].map(s => newVendorRepo.findBySlug(s))
      );

      expect(persistedCategories.length).toBe(6);
      expect(persistedProducts.length).toBe(12);
      expect(persistedVendors.filter(v => v !== null).length).toBe(3);

      // Verify IDs match
      expect(persistedCategories.map(c => c.id).sort()).toEqual(categories.map(c => c.id).sort());
      expect(persistedProducts.map(p => p.id).sort()).toEqual(products.map(p => p.id).sort());
      expect(persistedVendors.filter(v => v !== null).map(v => v!.id).sort())
        .toEqual(vendors.filter(v => v !== null).map(v => v!.id).sort());

      // 8. Connection will be closed in afterAll
    });
  });
});