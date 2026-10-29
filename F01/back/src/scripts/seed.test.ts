import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSeed, resetDeterministicIdGenerator } from './seed.js';
import { InMemoryPersonRepository } from '../modules/person/person.domain.js';
import { InMemoryVendorRepository } from '../modules/vendor/vendor.domain.js';
import { InMemoryProductRepository, InMemoryCategoryRepository } from '../modules/product/product.domain.js';
import { SeedRepositories } from '../shared/seed.types.js';

describe('Seed Integration', () => {
  let personRepo: InMemoryPersonRepository;
  let vendorRepo: InMemoryVendorRepository;
  let categoryRepo: InMemoryCategoryRepository;
  let productRepo: InMemoryProductRepository;
  let repositories: SeedRepositories;

  beforeEach(() => {
    // Reset the deterministic ID generator for consistent test runs
    resetDeterministicIdGenerator();
    
    // Create fresh repository instances for each test
    personRepo = new InMemoryPersonRepository();
    vendorRepo = new InMemoryVendorRepository();
    categoryRepo = new InMemoryCategoryRepository();
    productRepo = new InMemoryProductRepository();

    repositories = {
      personRepo,
      vendorRepo,
      categoryRepo,
      productRepo,
    };
  });

  describe('runSeed', () => {
    it('should accept repository instances and populate them', async () => {
      await runSeed(repositories);

      // Verify categories were created
      const categories = await categoryRepo.findAll();
      expect(categories.length).toBe(6);

      // Verify vendors were created via personRepo (since InMemoryVendorRepository doesn't have findAll)
      const persons = Array.from((personRepo as any).persons.values());
      const vendorPersons = persons.filter((p: any) => p.roles.includes('VENDOR'));
      expect(vendorPersons.length).toBe(3);

      // Verify products were created
      const products = await productRepo.findAll();
      expect(products.length).toBe(12);
    });

    it('should create exactly 6 categories with correct hierarchy', async () => {
      await runSeed(repositories);

      const categories = await categoryRepo.findAll();
      expect(categories.length).toBe(6);

      // Verify root categories (no parent)
      const rootCategories = categories.filter(c => c.parentId === null);
      expect(rootCategories.length).toBe(4); // Electronics, Clothing, Home & Garden, Books
      
      const rootCategoryNames = rootCategories.map(c => c.name).sort();
      expect(rootCategoryNames).toEqual(['Books', 'Clothing', 'Electronics', 'Home & Garden']);

      // Verify child categories
      const childCategories = categories.filter(c => c.parentId !== null);
      expect(childCategories.length).toBe(2);
      const childCategoryNames = childCategories.map(c => c.name).sort();
      expect(childCategoryNames).toEqual(['Laptops', 'Smartphones']);
    });

    it('should create exactly 3 vendors with correct data', async () => {
      await runSeed(repositories);

      // Get all persons with VENDOR role
      const allPersons = Array.from((personRepo as any).persons.values());
      const vendorPersons = allPersons.filter((p: any) => p.roles.includes('VENDOR'));
      expect(vendorPersons.length).toBe(3);

      // Verify vendor details
      const vendorEmails = vendorPersons.map((p: any) => p.email).sort();
      expect(vendorEmails).toEqual(['bookworld@example.com', 'fashionhub@example.com', 'techstore@example.com']);

      const vendorNames = vendorPersons.map((p: any) => p.name).sort();
      expect(vendorNames).toEqual(['Book World', 'Fashion Hub', 'Tech Store']);

      // Verify vendors exist in vendorRepo
      for (const person of vendorPersons) {
        const vendor = await vendorRepo.findByPersonId(person.id);
        expect(vendor).not.toBeNull();
        expect(vendor!.personId).toBe(person.id);
      }
    });

    it('should create exactly 12 products distributed across vendors and categories', async () => {
      await runSeed(repositories);

      const products = await productRepo.findAll();
      expect(products.length).toBe(12);

      // Verify all products are ACTIVE
      expect(products.every(p => p.status === 'active')).toBe(true);

      // Verify products have vendorId and categoryId
      expect(products.every(p => p.vendorId && p.categoryId)).toBe(true);

      // Verify products distributed across 3 vendors
      const vendorIds = new Set(products.map(p => p.vendorId));
      expect(vendorIds.size).toBe(3);

      // Verify products distributed across categories
      const categoryIds = new Set(products.map(p => p.categoryId));
      expect(categoryIds.size).toBeGreaterThan(0);
    });

    it('should be idempotent for all entities - running twice does not duplicate data', async () => {
      // First run
      await runSeed(repositories);
      
      const categoriesAfterFirst = await categoryRepo.findAll();
      const productsAfterFirst = await productRepo.findAll();
      const vendorPersonsAfterFirst = Array.from((personRepo as any).persons.values()).filter((p: any) => p.roles.includes('VENDOR'));

      expect(categoriesAfterFirst.length).toBe(6);
      expect(productsAfterFirst.length).toBe(12);
      expect(vendorPersonsAfterFirst.length).toBe(3);

      // Second run on same repositories - all entities should now be idempotent
      await runSeed(repositories);

      // Verify categories remain unchanged (idempotent)
      const categoriesAfterSecond = await categoryRepo.findAll();
      const productsAfterSecond = await productRepo.findAll();
      const vendorPersonsAfterSecond = Array.from((personRepo as any).persons.values()).filter((p: any) => p.roles.includes('VENDOR'));

      expect(categoriesAfterSecond.length).toBe(6);
      expect(productsAfterSecond.length).toBe(12);
      expect(vendorPersonsAfterSecond.length).toBe(3);

      // Verify same deterministic IDs for categories
      const firstCategoryIds = categoriesAfterFirst.map(c => c.id).sort();
      const secondCategoryIds = categoriesAfterSecond.map(c => c.id).sort();
      expect(firstCategoryIds).toEqual(secondCategoryIds);

      // Verify same deterministic IDs for products
      const firstProductIds = productsAfterFirst.map(p => p.id).sort();
      const secondProductIds = productsAfterSecond.map(p => p.id).sort();
      expect(firstProductIds).toEqual(secondProductIds);

      // Verify same deterministic IDs for vendor persons (same emails)
      const firstVendorEmails = vendorPersonsAfterFirst.map((p: any) => p.email).sort();
      const secondVendorEmails = vendorPersonsAfterSecond.map((p: any) => p.email).sort();
      expect(firstVendorEmails).toEqual(secondVendorEmails);

      // Verify vendor slugs are preserved
      const vendorSlugsAfterFirst = [];
      for (const person of vendorPersonsAfterFirst) {
        const vendor = await vendorRepo.findByPersonId(person.id);
        if (vendor) vendorSlugsAfterFirst.push(vendor.slug);
      }
      const vendorSlugsAfterSecond = [];
      for (const person of vendorPersonsAfterSecond) {
        const vendor = await vendorRepo.findByPersonId(person.id);
        if (vendor) vendorSlugsAfterSecond.push(vendor.slug);
      }
      expect(vendorSlugsAfterFirst.sort()).toEqual(vendorSlugsAfterSecond.sort());
    });

    it('should maintain referential integrity between entities', async () => {
      await runSeed(repositories);

      const products = await productRepo.findAll();
      const categories = await categoryRepo.findAll();
      const categoryIds = new Set(categories.map(c => c.id));

      // Every product's categoryId should reference an existing category
      for (const product of products) {
        expect(categoryIds.has(product.categoryId)).toBe(true);
      }

      // Every product's vendorId should reference an existing vendor
      // Get vendor IDs from vendorRepo by looking up each vendor person
      const allPersons = Array.from((personRepo as any).persons.values());
      const vendorPersons = allPersons.filter((p: any) => p.roles.includes('VENDOR'));
      const vendorIds = new Set<string>();
      for (const person of vendorPersons) {
        const vendor = await vendorRepo.findByPersonId(person.id);
        if (vendor) {
          vendorIds.add(vendor.id);
        }
      }

      for (const product of products) {
        expect(vendorIds.has(product.vendorId)).toBe(true);
      }
    });

    it('should create products with correct vendor-category associations', async () => {
      await runSeed(repositories);

      const products = await productRepo.findAll();
      const categories = await categoryRepo.findAll();
      const categoryMap = new Map(categories.map(c => [c.id, c]));

      // Verify specific product-category associations from seed data
      // Tech Store products
      const techStoreProducts = products.filter(p => p.name.includes('iPhone') || p.name.includes('MacBook') || p.name.includes('iPad') || p.name.includes('AirPods'));
      expect(techStoreProducts.length).toBe(4);

      // Fashion Hub products
      const fashionHubProducts = products.filter(p => p.name.includes('T-Shirt') || p.name.includes('Jeans') || p.name.includes('Dress') || p.name.includes('Jacket'));
      expect(fashionHubProducts.length).toBe(4);

      // Book World products
      const bookWorldProducts = products.filter(p => p.name.includes('Clean Code') || p.name.includes('Design Patterns') || p.name.includes('Pragmatic Programmer') || p.name.includes('Domain-Driven Design'));
      expect(bookWorldProducts.length).toBe(4);

      // Verify each product's category matches expected
      for (const product of techStoreProducts) {
        const category = categoryMap.get(product.categoryId);
        expect(category).toBeDefined();
        expect(['electronics', 'smartphones', 'laptops']).toContain(category!.slug);
      }

      for (const product of fashionHubProducts) {
        const category = categoryMap.get(product.categoryId);
        expect(category).toBeDefined();
        expect(category!.slug).toBe('clothing');
      }

      for (const product of bookWorldProducts) {
        const category = categoryMap.get(product.categoryId);
        expect(category).toBeDefined();
        expect(category!.slug).toBe('books');
      }
    });
  });

  describe('runSeed without repositories (CLI mode)', () => {
    it('should create new repository instances when none provided', async () => {
      // This tests the default behavior when repositories are not passed
      // We can't easily test the internal instances, but we can verify it doesn't throw
      await expect(runSeed()).resolves.not.toThrow();
    });
  });
});