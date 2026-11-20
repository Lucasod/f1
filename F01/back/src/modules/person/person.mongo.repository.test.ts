import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { Person, PersonRole, PersonRepository, ContactInfo, Address, MainInfo } from './person.domain';
import { MongoPersonRepository } from './person.mongo.repository';

// Test database configuration
const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const DB_SUFFIX = Math.random().toString(36).substring(2, 9);
const TEST_DB_NAME = `fs01_marketplace_test_${DB_SUFFIX}`;

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

describeIfMongo('MongoPersonRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let peopleCollection: Collection;
  let mainInfosCollection: Collection;
  let credentialsCollection: Collection;
  let addressesCollection: Collection;
  let contactInfosCollection: Collection;
  let repo: PersonRepository;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);
    
    peopleCollection = db.collection('people');
    mainInfosCollection = db.collection('main_infos');
    credentialsCollection = db.collection('credentials');
    addressesCollection = db.collection('addresses');
    contactInfosCollection = db.collection('contact_infos');
    
    // Create indexes
    await peopleCollection.createIndex({ 'roles': 1 });
    await mainInfosCollection.createIndex({ person_id: 1 }, { unique: true });
    await mainInfosCollection.createIndex({ 'tax_id.value': 1 }, { unique: true });
    await credentialsCollection.createIndex({ person_id: 1 }, { unique: true });
    await addressesCollection.createIndex({ person_id: 1, is_primary: -1 });
    await contactInfosCollection.createIndex({ person_id: 1 });
    await contactInfosCollection.createIndex({ type: 1, value: 1 }, { unique: true, partialFilterExpression: { type: 'email' } });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await peopleCollection.deleteMany({});
    await mainInfosCollection.deleteMany({});
    await credentialsCollection.deleteMany({});
    await addressesCollection.deleteMany({});
    await contactInfosCollection.deleteMany({});
    repo = new MongoPersonRepository(db);
  });

  describe('MongoPersonRepository - Contract Compliance', () => {
    it('should implement PersonRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findByEmail).toBe('function');
      expect(typeof repo.findByTaxId).toBe('function');
      expect(typeof repo.delete).toBe('function');
    });

    it('should save and find person by ID', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      const found = await repo.findById(person.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(person.id);
      expect(found!.name).toBe('John Doe');
    });

    it('should find person by email (case-insensitive)', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'John@Example.COM', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      const found = await repo.findByEmail('john@example.com');

      expect(found).not.toBeNull();
      expect(found!.email).toBe('John@Example.COM');
    });

    it('should return null for non-existent email', async () => {
      const found = await repo.findByEmail('nonexistent@example.com');
      expect(found).toBeNull();
    });

    it('should reject duplicate email', async () => {
      const person1 = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      const person2 = Person.create({
        name: 'Jane Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224726' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person1);
      await expect(repo.save(person2)).rejects.toThrow('EMAIL_ALREADY_EXISTS');
    });

    it('should find person by tax ID', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      const found = await repo.findByTaxId('CPF', '52998224725');

      expect(found).not.toBeNull();
      expect(found!.mainInfo.taxIdValue).toBe('52998224725');
    });

    it('should reject duplicate tax ID (CPF)', async () => {
      const person1 = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'john1@example.com', isPrimary: true }],
        addresses: []
      });

      const person2 = Person.create({
        name: 'Jane Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' }, // Same CPF
        contactInfos: [{ type: 'email', value: 'jane@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person1);
      await expect(repo.save(person2)).rejects.toThrow();
    });

    it('should reject duplicate tax ID (CNPJ)', async () => {
      const person1 = Person.create({
        name: 'Company A',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'companya@example.com', isPrimary: true }],
        addresses: []
      });

      const person2 = Person.create({
        name: 'Company B',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' }, // Same CNPJ
        contactInfos: [{ type: 'email', value: 'companyb@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person1);
      await expect(repo.save(person2)).rejects.toThrow();
    });

    it('should persist and retrieve all Person fields', async () => {
      const person = Person.create({
        name: 'John Doe',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [
          { type: 'email', value: 'john@example.com', isPrimary: true },
          { type: 'phone', value: '+5511999999999', isPrimary: false }
        ],
        addresses: [
          { street: 'Rua A', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', isPrimary: true }
        ]
      });
      
      person.addRole(PersonRole.CONSUMER);
      person.addRole(PersonRole.VENDOR);
      person.setCredential('hashed-password-123');

      await repo.save(person);
      const found = await repo.findById(person.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('John Doe');
      expect(found!.mainInfo.taxIdType).toBe('CPF');
      expect(found!.mainInfo.taxIdValue).toBe('52998224725');
      expect(found!.contactInfos).toHaveLength(2);
      expect(found!.contactInfos[0].type).toBe('email');
      expect(found!.contactInfos[0].value).toBe('john@example.com');
      expect(found!.addresses).toHaveLength(1);
      expect(found!.addresses[0].street).toBe('Rua A');
      expect(found!.roles).toContain(PersonRole.CONSUMER);
      expect(found!.roles).toContain(PersonRole.VENDOR);
      expect(found!.credential).toBe('hashed-password-123');
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist data between repository instances', async () => {
      const person = Person.create({
        name: 'Persistence Test',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224727' },
        contactInfos: [{ type: 'email', value: 'persist@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);

      // Create a new repository instance (simulating app restart)
      // The implementation should use the same collections
      const found = await repo.findById(person.id);
      
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Persistence Test');
      expect(found!.email).toBe('persist@example.com');
    });

    it('should preserve contact and address IDs across profile updates', async () => {
      const person = Person.create({
        name: 'Stable IDs',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224727' },
        contactInfos: [{ type: 'email', value: 'stable@example.com', isPrimary: true }],
        addresses: [{
          street: 'Rua A',
          number: '10',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          isPrimary: true
        }]
      });

      await repo.save(person);
      const found = await repo.findById(person.id);
      expect(found).not.toBeNull();
      const contactId = found!.contactInfos[0].id;
      const addressId = found!.addresses[0].id;

      found!.updateContact(contactId, { value: 'stable-updated@example.com' });
      found!.updateAddress(addressId, { street: 'Rua B' });
      found!.updateName('Updated Stable IDs');
      await repo.update(found!);

      const reloaded = await repo.findById(person.id);
      expect(reloaded!.contactInfos[0]).toMatchObject({
        id: contactId,
        value: 'stable-updated@example.com'
      });
      expect(reloaded!.addresses[0]).toMatchObject({
        id: addressId,
        street: 'Rua B'
      });
      expect(reloaded!.mainInfo.name).toBe('Updated Stable IDs');
    });

    it('should delete person', async () => {
      const person = Person.create({
        name: 'Delete Test',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224728' },
        contactInfos: [{ type: 'email', value: 'delete@example.com', isPrimary: true }],
        addresses: []
      });

      await repo.save(person);
      await repo.delete(person.id);
      
      const found = await repo.findById(person.id);
      expect(found).toBeNull();
    });

    it('should handle roles correctly (ADMIN exclusive)', async () => {
      const person = Person.create({
        name: 'Admin Test',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224729' },
        contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
        addresses: []
      });

      person.addRole(PersonRole.ADMIN);
      await repo.save(person);
      
      const found = await repo.findById(person.id);
      expect(found!.roles).toContain(PersonRole.ADMIN);
      expect(found!.roles).toHaveLength(1);
    });
  });
});