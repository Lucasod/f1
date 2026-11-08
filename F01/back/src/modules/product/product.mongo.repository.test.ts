import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Product, ProductStatus, ProductRepository, ProductError } from './product.domain';
import { MongoProductRepository } from './product.mongo.repository';

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

describeIfMongo('MongoProductRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let productsCollection: Collection;
  let repo: ProductRepository;
  let dbNameForDrop: string;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);
    dbNameForDrop = TEST_DB_NAME;

    productsCollection = db.collection('products');

    await productsCollection.createIndex({ vendorId: 1 });
    await productsCollection.createIndex({ categoryId: 1 });
  });

  afterAll(async () => {
    await client.db(dbNameForDrop).dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    repo = new MongoProductRepository(db);
  });

  describe('MongoProductRepository - Contract Compliance', () => {
    it('should implement ProductRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findByVendorId).toBe('function');
      expect(typeof repo.findByCategoryId).toBe('function');
      expect(typeof repo.findAll).toBe('function');
      expect(typeof repo.update).toBe('function');
      expect(typeof repo.delete).toBe('function');
    });

    it('should save and find product by ID', async () => {
      const product = Product.create({
        vendorId: 'vendor-123',
        categoryId: 'cat-456',
        name: 'Test Product',
        description: 'A great product',
        price: 99.99,
        quantity: 10
      });

      await repo.save(product);
      const found = await repo.findById(product.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(product.id);
      expect(found!.name).toBe('Test Product');
      expect(found!.price).toBe(99.99);
      expect(found!.quantity).toBe(10);
      expect(found!.status).toBe(ProductStatus.ACTIVE);
    });

    it('should find products by vendorId', async () => {
      const product1 = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-1', name: 'P1', description: 'D1', price: 10, quantity: 5 });
      const product2 = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-2', name: 'P2', description: 'D2', price: 20, quantity: 3 });
      const product3 = Product.create({ vendorId: 'vendor-2', categoryId: 'cat-1', name: 'P3', description: 'D3', price: 30, quantity: 7 });

      await repo.save(product1);
      await repo.save(product2);
      await repo.save(product3);

      const vendor1Products = await repo.findByVendorId('vendor-1');
      expect(vendor1Products).toHaveLength(2);
      expect(vendor1Products.every(p => p.vendorId === 'vendor-1')).toBe(true);

      const vendor2Products = await repo.findByVendorId('vendor-2');
      expect(vendor2Products).toHaveLength(1);
    });

    it('should find products by categoryId', async () => {
      const product1 = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-1', name: 'P1', description: 'D1', price: 10, quantity: 5 });
      const product2 = Product.create({ vendorId: 'vendor-2', categoryId: 'cat-1', name: 'P2', description: 'D2', price: 20, quantity: 3 });
      const product3 = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-2', name: 'P3', description: 'D3', price: 30, quantity: 7 });

      await repo.save(product1);
      await repo.save(product2);
      await repo.save(product3);

      const cat1Products = await repo.findByCategoryId('cat-1');
      expect(cat1Products).toHaveLength(2);
      expect(cat1Products.every(p => p.categoryId === 'cat-1')).toBe(true);
    });

    it('should find all products with filters', async () => {
      const p1 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Apple Phone', description: 'Great phone', price: 100, quantity: 5, status: ProductStatus.ACTIVE });
      const p2 = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Banana Tablet', description: 'Nice tablet', price: 200, quantity: 0, status: ProductStatus.OUT_OF_STOCK });
      const p3 = Product.create({ vendorId: 'v2', categoryId: 'c2', name: 'Cherry Laptop', description: 'Powerful laptop', price: 300, quantity: 10, status: ProductStatus.INACTIVE });

      await repo.save(p1);
      await repo.save(p2);
      await repo.save(p3);

      const all = await repo.findAll();
      expect(all).toHaveLength(3);

      const active = await repo.findAll({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Apple Phone');

      const byVendor = await repo.findAll({ vendorId: 'v1' });
      expect(byVendor).toHaveLength(2);

      const search = await repo.findAll({ search: 'phone' });
      expect(search).toHaveLength(1);
      expect(search[0].name).toBe('Apple Phone');

      const sorted = await repo.findAll({ sortBy: 'price_asc' });
      expect(sorted.map(p => p.name)).toEqual(['Apple Phone', 'Banana Tablet', 'Cherry Laptop']);
    });

    it('should update product preserving required fields', async () => {
      const product = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-1', name: 'Original', description: 'Desc', price: 50, quantity: 10 });
      await repo.save(product);

      product.updateDetails({ name: 'Updated', price: 75 });
      const updated = await repo.update(product);

      expect(updated.name).toBe('Updated');
      expect(updated.price).toBe(75);
      expect(updated.description).toBe('Desc');
      expect(updated.vendorId).toBe('vendor-1');
      expect(updated.categoryId).toBe('cat-1');
      expect(updated.id).toBe(product.id);
      expect(updated.createdAt).toEqual(product.createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(product.updatedAt.getTime());
    });

    it('should delete product', async () => {
      const product = Product.create({ vendorId: 'vendor-1', categoryId: 'cat-1', name: 'To Delete', description: 'Desc', price: 10, quantity: 5 });
      await repo.save(product);
      await repo.delete(product.id);

      const found = await repo.findById(product.id);
      expect(found).toBeNull();
    });

    it('should persist all Product fields completely', async () => {
      const product = Product.create({ 
        vendorId: 'vendor-full', 
        categoryId: 'cat-full', 
        name: 'Full Product', 
        description: 'Full description', 
        price: 123.45, 
        quantity: 42,
        status: ProductStatus.INACTIVE,
        images: ['img1.jpg', 'img2.jpg']
      });

      await repo.save(product);
      const found = await repo.findById(product.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(product.id);
      expect(found!.vendorId).toBe('vendor-full');
      expect(found!.categoryId).toBe('cat-full');
      expect(found!.name).toBe('Full Product');
      expect(found!.description).toBe('Full description');
      expect(found!.price).toBe(123.45);
      expect(found!.quantity).toBe(42);
      expect(found!.status).toBe(ProductStatus.INACTIVE);
      expect(found!.images).toEqual(['img1.jpg', 'img2.jpg']);
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
    });

    it('should persist data between repository instances', async () => {
      const product = Product.create({ vendorId: 'vendor-persist', categoryId: 'cat-persist', name: 'Persist', description: 'Test', price: 10, quantity: 5 });
      await repo.save(product);

      const newRepo = new MongoProductRepository(db);
      const found = await newRepo.findById(product.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Persist');
      expect(found!.vendorId).toBe('vendor-persist');
    });

    it('should handle product status transitions', async () => {
      const product = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Status Test', description: 'Test', price: 100, quantity: 10 });
      await repo.save(product);

      product.inactivate();
      let updated = await repo.update(product);
      expect(updated.status).toBe(ProductStatus.INACTIVE);

      product.activate();
      updated = await repo.update(product);
      expect(updated.status).toBe(ProductStatus.ACTIVE);

      product.discontinue();
      updated = await repo.update(product);
      expect(updated.status).toBe(ProductStatus.DISCONTINUED);

      const newProduct = Product.create({ vendorId: 'v2', categoryId: 'c1', name: 'Stock Test', description: 'Test', price: 50, quantity: 10 });
      await repo.save(newProduct);
      newProduct.updateStock(0);
      updated = await repo.update(newProduct);
      expect(updated.status).toBe(ProductStatus.OUT_OF_STOCK);
      expect(updated.quantity).toBe(0);

      newProduct.updateStock(5);
      updated = await repo.update(newProduct);
      expect(updated.status).toBe(ProductStatus.ACTIVE);
      expect(updated.quantity).toBe(5);
    });

    it('should handle image management', async () => {
      const product = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Image Test', description: 'Test', price: 100, quantity: 10 });
      await repo.save(product);

      product.addImage('image1.jpg');
      let updated = await repo.update(product);
      expect(updated.images).toEqual(['image1.jpg']);

      product.addImage('image2.jpg');
      updated = await repo.update(product);
      expect(updated.images).toEqual(['image1.jpg', 'image2.jpg']);

      product.removeImage('image1.jpg');
      updated = await repo.update(product);
      expect(updated.images).toEqual(['image2.jpg']);
    });

    it('should correctly report isAvailable', async () => {
      const activeProduct = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Active', description: 'Test', price: 100, quantity: 10, status: ProductStatus.ACTIVE });
      const outOfStock = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'OOS', description: 'Test', price: 100, quantity: 0, status: ProductStatus.ACTIVE });
      const inactive = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Inactive', description: 'Test', price: 100, quantity: 10, status: ProductStatus.INACTIVE });
      const discontinued = Product.create({ vendorId: 'v1', categoryId: 'c1', name: 'Discontinued', description: 'Test', price: 100, quantity: 10, status: ProductStatus.DISCONTINUED });

      await repo.save(activeProduct);
      await repo.save(outOfStock);
      await repo.save(inactive);
      await repo.save(discontinued);

      const foundActive = await repo.findById(activeProduct.id);
      const foundOOS = await repo.findById(outOfStock.id);
      const foundInactive = await repo.findById(inactive.id);
      const foundDiscontinued = await repo.findById(discontinued.id);

      expect(foundActive!.isAvailable).toBe(true);
      expect(foundOOS!.isAvailable).toBe(false);
      expect(foundInactive!.isAvailable).toBe(false);
      expect(foundDiscontinued!.isAvailable).toBe(false);
    });
  });
});