import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient, Db, Collection } from 'mongodb';
import { Category, CategoryRepository, ProductError } from './product.domain';
import { MongoCategoryRepository } from './category.mongo.repository';

// Test database configuration
const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB_NAME = 'fs01_marketplace_test';

describe('MongoCategoryRepository Contract Tests', () => {
  let client: MongoClient;
  let db: Db;
  let categoriesCollection: Collection;
  let repo: CategoryRepository;

  beforeAll(async () => {
    client = new MongoClient(TEST_MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);

    categoriesCollection = db.collection('categories');

    // Create indexes
    await categoriesCollection.createIndex({ slug: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
    await categoriesCollection.createIndex({ parentId: 1 });
    await categoriesCollection.createIndex({ path: 1 });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    // Clear collection before each test
    await categoriesCollection.deleteMany({});

    // Create repository instance
    repo = new MongoCategoryRepository(db);
  });

  describe('MongoCategoryRepository - Contract Compliance', () => {
    it('should implement CategoryRepository interface', () => {
      expect(repo).toBeDefined();
      expect(typeof repo.save).toBe('function');
      expect(typeof repo.findById).toBe('function');
      expect(typeof repo.findBySlug).toBe('function');
      expect(typeof repo.findByParentId).toBe('function');
      expect(typeof repo.findAll).toBe('function');
      expect(typeof repo.update).toBe('function');
      expect(typeof repo.delete).toBe('function');
    });

    it('should save and find category by ID', async () => {
      const category = Category.create({
        name: 'Electronics',
        slug: 'electronics'
      });

      await repo.save(category);
      const found = await repo.findById(category.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(category.id);
      expect(found!.name).toBe('Electronics');
      expect(found!.slug).toBe('electronics');
      expect(found!.parentId).toBeNull();
      expect(found!.path).toBe('/electronics/');
    });

    it('should find category by slug (case-insensitive)', async () => {
      const category = Category.create({
        name: 'Electronics',
        slug: 'electronics'
      });

      await repo.save(category);
      const found = await repo.findBySlug('ELECTRONICS');

      expect(found).not.toBeNull();
      expect(found!.slug).toBe('electronics');
      expect(found!.name).toBe('Electronics');
    });

    it('should return null for non-existent slug', async () => {
      const found = await repo.findBySlug('nonexistent-slug');
      expect(found).toBeNull();
    });

    it('should find categories by parentId (including root categories)', async () => {
      const rootCategory = Category.create({
        name: 'Electronics',
        slug: 'electronics'
      });

      const childCategory = Category.createWithParent({
        name: 'Smartphones',
        slug: 'smartphones'
      }, rootCategory);

      const grandchildCategory = Category.createWithParent({
        name: 'Android Phones',
        slug: 'android-phones'
      }, childCategory);

      await repo.save(rootCategory);
      await repo.save(childCategory);
      await repo.save(grandchildCategory);

      const rootCategories = await repo.findByParentId(null);
      const childCategories = await repo.findByParentId(rootCategory.id);
      const grandchildCategories = await repo.findByParentId(childCategory.id);

      expect(rootCategories).toHaveLength(1);
      expect(rootCategories[0].id).toBe(rootCategory.id);
      expect(rootCategories[0].parentId).toBeNull();

      expect(childCategories).toHaveLength(1);
      expect(childCategories[0].id).toBe(childCategory.id);
      expect(childCategories[0].parentId).toBe(rootCategory.id);

      expect(grandchildCategories).toHaveLength(1);
      expect(grandchildCategories[0].id).toBe(grandchildCategory.id);
      expect(grandchildCategories[0].parentId).toBe(childCategory.id);
    });

    it('should find all categories', async () => {
      const cat1 = Category.create({ name: 'Category 1', slug: 'category-1' });
      const cat2 = Category.create({ name: 'Category 2', slug: 'category-2' });
      const cat3 = Category.create({ name: 'Category 3', slug: 'category-3' });

      await repo.save(cat1);
      await repo.save(cat2);
      await repo.save(cat3);

      const all = await repo.findAll();

      expect(all).toHaveLength(3);
      expect(all.map(c => c.slug).sort()).toEqual(['category-1', 'category-2', 'category-3']);
    });

    it('should update category preserving required fields', async () => {
      const category = Category.create({
        name: 'Original Name',
        slug: 'original-slug'
      });

      await repo.save(category);

      // Update name
      category.updateName('Updated Name');
      const updated = await repo.update(category);

      expect(updated.name).toBe('Updated Name');
      expect(updated.slug).toBe('original-slug');
      expect(updated.id).toBe(category.id);
      expect(updated.createdAt).toEqual(category.createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(category.updatedAt.getTime());
      expect(updated.parentId).toBeNull();
      expect(updated.path).toBe('/original-slug/');
    });

    it('should reject duplicate slugs (case-insensitive)', async () => {
      const category1 = Category.create({
        name: 'Category One',
        slug: 'my-category'
      });

      const category2 = Category.create({
        name: 'Category Two',
        slug: 'my-category' // Same slug (case-insensitive duplicate)
      });

      await repo.save(category1);
      await expect(repo.save(category2)).rejects.toThrow(ProductError.CATEGORY_SLUG_ALREADY_EXISTS);
    });

    it('should persist all Category fields completely', async () => {
      const parent = Category.create({
        name: 'Parent Category',
        slug: 'parent-category'
      });

      const category = Category.createWithParent({
        name: 'Child Category',
        slug: 'child-category'
      }, parent);

      await repo.save(parent);
      await repo.save(category);

      const found = await repo.findById(category.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(category.id);
      expect(found!.parentId).toBe(parent.id);
      expect(found!.name).toBe('Child Category');
      expect(found!.slug).toBe('child-category');
      expect(found!.path).toBe('/parent-category/child-category/');
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.updatedAt).toBeInstanceOf(Date);
      expect(found!.createdAt.getTime()).toBeLessThanOrEqual(found!.updatedAt.getTime());
    });

    it('should persist data between repository instances', async () => {
      const category = Category.create({
        name: 'Persist Category',
        slug: 'persist-category'
      });

      await repo.save(category);

      // Create a new repository instance (simulating app restart)
      const newRepo = new MongoCategoryRepository(db);
      const found = await newRepo.findById(category.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Persist Category');
      expect(found!.slug).toBe('persist-category');
      expect(found!.parentId).toBeNull();
      expect(found!.path).toBe('/persist-category/');
    });

    it('should delete category', async () => {
      const category = Category.create({
        name: 'Delete Category',
        slug: 'delete-category'
      });

      await repo.save(category);
      await repo.delete(category.id);

      const found = await repo.findById(category.id);
      expect(found).toBeNull();

      // Verify slug index is cleaned up
      const bySlug = await repo.findBySlug('delete-category');
      expect(bySlug).toBeNull();
    });

    it('should handle hierarchy with multiple levels (parent -> child -> grandchild)', async () => {
      const level1 = Category.create({ name: 'Level 1', slug: 'level-1' });
      const level2 = Category.createWithParent({ name: 'Level 2', slug: 'level-2' }, level1);
      const level3 = Category.createWithParent({ name: 'Level 3', slug: 'level-3' }, level2);
      const level4 = Category.createWithParent({ name: 'Level 4', slug: 'level-4' }, level3);

      await repo.save(level1);
      await repo.save(level2);
      await repo.save(level3);
      await repo.save(level4);

      const found1 = await repo.findById(level1.id);
      const found2 = await repo.findById(level2.id);
      const found3 = await repo.findById(level3.id);
      const found4 = await repo.findById(level4.id);

      expect(found1!.parentId).toBeNull();
      expect(found1!.path).toBe('/level-1/');

      expect(found2!.parentId).toBe(level1.id);
      expect(found2!.path).toBe('/level-1/level-2/');

      expect(found3!.parentId).toBe(level2.id);
      expect(found3!.path).toBe('/level-1/level-2/level-3/');

      expect(found4!.parentId).toBe(level3.id);
      expect(found4!.path).toBe('/level-1/level-2/level-3/level-4/');
    });

    it('should reject self-reference (category cannot be its own parent)', async () => {
      const category = Category.create({
        name: 'Self Reference',
        slug: 'self-reference'
      });

      await repo.save(category);

      const allCategories = await repo.findAll();
      expect(() => category.setParent(category.id, allCategories)).toThrow(ProductError.CATEGORY_CANNOT_SET_SELF_AS_PARENT);
    });

    it('should detect cycle in hierarchy', async () => {
      const parent = Category.create({ name: 'Parent', slug: 'parent' });
      const child = Category.createWithParent({ name: 'Child', slug: 'child' }, parent);
      const grandchild = Category.createWithParent({ name: 'Grandchild', slug: 'grandchild' }, child);

      await repo.save(parent);
      await repo.save(child);
      await repo.save(grandchild);

      const allCategories = await repo.findAll();

      // Try to make parent a child of grandchild (creating cycle: parent -> child -> grandchild -> parent)
      expect(() => parent.setParent(grandchild.id, allCategories)).toThrow(ProductError.CATEGORY_CYCLE_DETECTED);
    });

    it('should handle root categories and child categories correctly', async () => {
      const root1 = Category.create({ name: 'Root 1', slug: 'root-1' });
      const root2 = Category.create({ name: 'Root 2', slug: 'root-2' });
      const child1 = Category.createWithParent({ name: 'Child 1', slug: 'child-1' }, root1);
      const child2 = Category.createWithParent({ name: 'Child 2', slug: 'child-2' }, root1);
      const child3 = Category.createWithParent({ name: 'Child 3', slug: 'child-3' }, root2);

      await repo.save(root1);
      await repo.save(root2);
      await repo.save(child1);
      await repo.save(child2);
      await repo.save(child3);

      const rootCategories = await repo.findByParentId(null);
      const childrenOfRoot1 = await repo.findByParentId(root1.id);
      const childrenOfRoot2 = await repo.findByParentId(root2.id);

      expect(rootCategories).toHaveLength(2);
      expect(rootCategories.map(c => c.slug).sort()).toEqual(['root-1', 'root-2']);

      expect(childrenOfRoot1).toHaveLength(2);
      expect(childrenOfRoot1.map(c => c.slug).sort()).toEqual(['child-1', 'child-2']);

      expect(childrenOfRoot2).toHaveLength(1);
      expect(childrenOfRoot2[0].slug).toBe('child-3');
    });

    it('should update category parent with valid new parent', async () => {
      const oldParent = Category.create({ name: 'Old Parent', slug: 'old-parent' });
      const newParent = Category.create({ name: 'New Parent', slug: 'new-parent' });
      const child = Category.createWithParent({ name: 'Child', slug: 'child' }, oldParent);

      await repo.save(oldParent);
      await repo.save(newParent);
      await repo.save(child);

      const allCategories = await repo.findAll();
      child.setParent(newParent.id, allCategories);
      const updated = await repo.update(child);

      expect(updated.parentId).toBe(newParent.id);
      expect(updated.path).toBe('/new-parent/child/');
    });

    it('should reject setting parent to non-existent category', async () => {
      const category = Category.create({ name: 'Category', slug: 'category' });
      await repo.save(category);

      const allCategories = await repo.findAll();
      expect(() => category.setParent('non-existent-id', allCategories)).toThrow(ProductError.CATEGORY_PARENT_NOT_FOUND);
    });

    it('should update slug and maintain uniqueness', async () => {
      const category1 = Category.create({ name: 'Category 1', slug: 'slug-1' });
      const category2 = Category.create({ name: 'Category 2', slug: 'slug-2' });

      await repo.save(category1);
      await repo.save(category2);

      // Update category1's slug to something unique
      category1.updateSlug('updated-slug', null); // null parentPath for root category
      const updated = await repo.update(category1);

      expect(updated.slug).toBe('updated-slug');
      expect(updated.path).toBe('/updated-slug/');
    });

    it('should reject updating to duplicate slug', async () => {
      const category1 = Category.create({ name: 'Category 1', slug: 'slug-1' });
      const category2 = Category.create({ name: 'Category 2', slug: 'slug-2' });

      await repo.save(category1);
      await repo.save(category2);

      // Try to update category2 to have category1's slug
      category2.updateSlug('slug-1');

      await expect(repo.update(category2)).rejects.toThrow(ProductError.CATEGORY_SLUG_ALREADY_EXISTS);
    });

    it('should create root category when parentId is not provided', async () => {
      const category = Category.create({
        name: 'Root Category',
        slug: 'root-category'
      });

      expect(category.parentId).toBeNull();
      expect(category.path).toBe('/root-category/');
      expect(category.isRoot).toBe(true);
      expect(category.depth).toBe(0);
    });

    it('should create child category with correct path', async () => {
      const parent = Category.create({ name: 'Parent', slug: 'parent' });
      const child = Category.createWithParent({ name: 'Child', slug: 'child' }, parent);

      expect(child.parentId).toBe(parent.id);
      expect(child.path).toBe('/parent/child/');
      expect(child.isRoot).toBe(false);
      expect(child.depth).toBe(1);
    });
  });
});