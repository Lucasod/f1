import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Invoice, InvoiceStatus, InvoiceError, InvoiceRepository } from './invoice.domain';
import { MongoInvoiceRepository } from './invoice.mongo.repository';

const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const DB_SUFFIX = Math.random().toString(36).substring(2, 9);
const TEST_DB_NAME = `fs01_marketplace_test_${DB_SUFFIX}`;

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

describeIfMongo('MongoInvoiceRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let invoicesCollection: Collection;
  let repo: InvoiceRepository;
  let dbNameForDrop: string;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);
    dbNameForDrop = TEST_DB_NAME;

    invoicesCollection = db.collection('invoices');

    await invoicesCollection.createIndex({ orderId: 1 }, { unique: true });
    await invoicesCollection.createIndex({ emissionAt: -1 });
    await invoicesCollection.createIndex({ status: 1 });
  });

  afterAll(async () => {
    await client.db(dbNameForDrop).dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    // Clear collection for test isolation
    await invoicesCollection.deleteMany({});
    
    repo = new MongoInvoiceRepository(db);
  });

  describe('MongoInvoiceRepository - Contract Compliance', () => {
    it('should implement InvoiceRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findByOrderId).toBe('function');
      expect(typeof repo.findAll).toBe('function');
      expect(typeof repo.update).toBe('function');
    });

    it('should save and find invoice by ID', async () => {
      const invoice = createTestInvoice();

      await repo.save(invoice);
      const found = await repo.findById(invoice.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(invoice.id);
      expect(found!.orderId).toBe(invoice.orderId);
      expect(found!.vendorId).toBe(invoice.vendorId);
      expect(found!.status).toBe(InvoiceStatus.PENDING);
    });

    it('should find invoice by order ID', async () => {
      const invoice = createTestInvoice({ orderId: 'order-1' });
      await repo.save(invoice);

      const found = await repo.findByOrderId('order-1');
      expect(found).not.toBeNull();
      expect(found!.orderId).toBe('order-1');

      const notFound = await repo.findByOrderId('non-existent');
      expect(notFound).toBeNull();
    });

    it('should find all invoices sorted by createdAt descending', async () => {
      const invoice1 = createTestInvoice({ orderId: 'order-a' });
      await new Promise(resolve => setTimeout(resolve, 20));
      const invoice2 = createTestInvoice({ orderId: 'order-b' });
      await new Promise(resolve => setTimeout(resolve, 20));
      const invoice3 = createTestInvoice({ orderId: 'order-c' });

      await repo.save(invoice1);
      await repo.save(invoice2);
      await repo.save(invoice3);

      const all = await repo.findAll();

      expect(all).toHaveLength(3);
      expect(all[0].id).toBe(invoice3.id);
      expect(all[1].id).toBe(invoice2.id);
      expect(all[2].id).toBe(invoice1.id);
    });

    it('should update existing invoice (status change)', async () => {
      const invoice = createTestInvoice();
      await repo.save(invoice);

      const found = await repo.findById(invoice.id);
      expect(found).not.toBeNull();

      found!.markSent();
      await repo.update(found!);

      const updated = await repo.findById(invoice.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe(InvoiceStatus.SENT);
      expect(updated!.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist all Invoice fields', async () => {
      const emissionAt = new Date('2026-01-15T10:00:00.000Z');
      const invoice = createTestInvoice({
        orderId: 'order-x',
        vendorId: 'vendor-x',
        emissionAt,
        pdfUrl: 'https://example.com/invoice.pdf',
        pdfPath: 'invoices/2026/01/invoice.pdf',
        status: InvoiceStatus.GENERATED,
      });

      await repo.save(invoice);
      const found = await repo.findById(invoice.id);

      expect(found).not.toBeNull();
      expect(found!.orderId).toBe('order-x');
      expect(found!.vendorId).toBe('vendor-x');
      expect(found!.emissionAt).toBeInstanceOf(Date);
      expect(found!.emissionAt.getTime()).toBe(emissionAt.getTime());
      expect(found!.pdfUrl).toBe('https://example.com/invoice.pdf');
      expect(found!.pdfPath).toBe('invoices/2026/01/invoice.pdf');
      expect(found!.status).toBe(InvoiceStatus.GENERATED);
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent invoice', async () => {
      const found = await repo.findById('non-existent-id');
      expect(found).toBeNull();
    });

    it('should return null for order with no invoice', async () => {
      const found = await repo.findByOrderId('non-existent-order');
      expect(found).toBeNull();
    });

    it('should enforce unique constraint on orderId', async () => {
      const invoice1 = createTestInvoice({ orderId: 'order-unique' });
      await repo.save(invoice1);

      const invoice2 = createTestInvoice({ orderId: 'order-unique' });
      await expect(repo.save(invoice2)).rejects.toThrow();
    });
  });
});

function createTestInvoice(overrides: Partial<{
  orderId: string;
  vendorId: string;
  emissionAt: Date;
  pdfUrl: string;
  pdfPath: string;
  status: InvoiceStatus;
}> = {}): Invoice {
  return Invoice.create({
    orderId: overrides.orderId ?? 'test-order-1',
    vendorId: overrides.vendorId ?? 'test-vendor',
    emissionAt: overrides.emissionAt,
    pdfUrl: overrides.pdfUrl,
    pdfPath: overrides.pdfPath,
    status: overrides.status,
  });
}
