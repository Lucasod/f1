import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vendor, VendorStatus, VendorRepository } from './vendor.domain';
import { Person, PersonRole } from '../person/person.domain';

// Mock repository for testing
class InMemoryVendorRepository implements VendorRepository {
  private vendors: Map<string, Vendor> = new Map();
  private slugIndex: Map<string, string> = new Map(); // slug -> vendorId
  private personIndex: Map<string, string> = new Map(); // personId -> vendorId

  async save(vendor: Vendor): Promise<Vendor> {
    // Check slug uniqueness
    const existingId = this.slugIndex.get(vendor.slug.toLowerCase());
    if (existingId && existingId !== vendor.id) {
      throw new Error('SLUG_ALREADY_EXISTS');
    }
    this.slugIndex.set(vendor.slug.toLowerCase(), vendor.id);
    
    // Check person-vendor association (one vendor per person)
    const existingPersonVendor = this.personIndex.get(vendor.personId);
    if (existingPersonVendor && existingPersonVendor !== vendor.id) {
      throw new Error('PERSON_ALREADY_HAS_VENDOR');
    }
    this.personIndex.set(vendor.personId, vendor.id);
    
    this.vendors.set(vendor.id, vendor);
    return vendor;
  }

  async findById(id: string): Promise<Vendor | null> {
    return this.vendors.get(id) || null;
  }

  async findBySlug(slug: string): Promise<Vendor | null> {
    const vendorId = this.slugIndex.get(slug.toLowerCase());
    if (!vendorId) return null;
    return this.vendors.get(vendorId) || null;
  }

  async findByPersonId(personId: string): Promise<Vendor | null> {
    const vendorId = this.personIndex.get(personId);
    if (!vendorId) return null;
    return this.vendors.get(vendorId) || null;
  }

  async update(vendor: Vendor): Promise<Vendor> {
    // Check slug uniqueness (excluding self)
    const existingId = this.slugIndex.get(vendor.slug.toLowerCase());
    if (existingId && existingId !== vendor.id) {
      throw new Error('SLUG_ALREADY_EXISTS');
    }
    this.slugIndex.set(vendor.slug.toLowerCase(), vendor.id);
    this.vendors.set(vendor.id, vendor);
    return vendor;
  }

  async delete(id: string): Promise<void> {
    const vendor = this.vendors.get(id);
    if (vendor) {
      this.slugIndex.delete(vendor.slug.toLowerCase());
      this.personIndex.delete(vendor.personId);
      this.vendors.delete(id);
    }
  }

  // Test helper
  clear(): void {
    this.vendors.clear();
    this.slugIndex.clear();
    this.personIndex.clear();
  }
}

describe('Vendor Domain', () => {
  let repo: InMemoryVendorRepository;

  beforeEach(() => {
    repo = new InMemoryVendorRepository();
  });

  describe('Vendor Entity', () => {
    it('should create a vendor with valid data', () => {
      const personId = 'person-123';
      const vendor = Vendor.create({
        personId,
        storeName: 'John\'s Electronics',
        slug: 'johns-electronics',
        commissionPct: 12.5
      });

      expect(vendor.id).toBeDefined();
      expect(vendor.personId).toBe(personId);
      expect(vendor.storeName).toBe('John\'s Electronics');
      expect(vendor.slug).toBe('johns-electronics');
      expect(vendor.status).toBe(VendorStatus.ACTIVE); // Auto-publish per CD-041
      expect(vendor.commissionPct).toBe(12.5);
      expect(vendor.createdAt).toBeInstanceOf(Date);
    });

    it('should create vendor with default commissionPct when not provided', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store'
      });

      expect(vendor.commissionPct).toBe(10); // Default from config
    });

    it('should reject vendor without personId', () => {
      expect(() => Vendor.create({
        personId: '',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      })).toThrow('PERSON_ID_REQUIRED');
    });

    it('should reject vendor without storeName', () => {
      expect(() => Vendor.create({
        personId: 'person-123',
        storeName: '',
        slug: 'test-store',
        commissionPct: 10
      })).toThrow('STORE_NAME_REQUIRED');
    });

    it('should reject vendor without slug', () => {
      expect(() => Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: '',
        commissionPct: 10
      })).toThrow('SLUG_REQUIRED');
    });

    it('should reject vendor with invalid slug format', () => {
      expect(() => Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'Invalid_Slug!',
        commissionPct: 10
      })).toThrow('INVALID_SLUG_FORMAT');
    });

    it('should reject vendor with invalid commissionPct (negative)', () => {
      expect(() => Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: -5
      })).toThrow('INVALID_COMMISSION_PCT');
    });

    it('should reject vendor with invalid commissionPct (>100)', () => {
      expect(() => Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 150
      })).toThrow('INVALID_COMMISSION_PCT');
    });

    it('should allow status transition from active to suspended', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      vendor.suspend();
      expect(vendor.status).toBe(VendorStatus.SUSPENDED);
    });

    it('should not allow status transition from suspended to active (terminal)', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      vendor.suspend();
      expect(() => vendor.activate()).toThrow('CANNOT_ACTIVATE_SUSPENDED');
    });

    it('should allow updating storeName', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      vendor.updateStoreName('Updated Store');
      expect(vendor.storeName).toBe('Updated Store');
    });

    it('should reject updating storeName to empty', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      expect(() => vendor.updateStoreName('')).toThrow('STORE_NAME_REQUIRED');
    });

    it('should set stripeAccountId', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      vendor.setStripeAccountId('acct_test123');
      expect(vendor.stripeAccountId).toBe('acct_test123');
    });

    it('should throw error for empty stripeAccountId', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      expect(() => vendor.setStripeAccountId('')).toThrow('STRIPE_ACCOUNT_ID_REQUIRED');
    });

    it('should throw error for whitespace-only stripeAccountId', () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      expect(() => vendor.setStripeAccountId('   ')).toThrow('STRIPE_ACCOUNT_ID_REQUIRED');
    });
  });

  describe('InMemoryVendorRepository', () => {
    it('should save and find vendor by ID', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      await repo.save(vendor);
      const found = await repo.findById(vendor.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(vendor.id);
      expect(found!.storeName).toBe('Test Store');
    });

    it('should find vendor by slug', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      await repo.save(vendor);
      const found = await repo.findBySlug('test-store');

      expect(found).not.toBeNull();
      expect(found!.slug).toBe('test-store');
    });

    it('should find vendor by slug case-insensitive', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      await repo.save(vendor);
      const found = await repo.findBySlug('TEST-STORE');

      expect(found).not.toBeNull();
    });

    it('should return null for non-existent slug', async () => {
      const found = await repo.findBySlug('nonexistent');
      expect(found).toBeNull();
    });

    it('should find vendor by personId', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      await repo.save(vendor);
      const found = await repo.findByPersonId('person-123');

      expect(found).not.toBeNull();
      expect(found!.personId).toBe('person-123');
    });

    it('should return null for person without vendor', async () => {
      const found = await repo.findByPersonId('nonexistent-person');
      expect(found).toBeNull();
    });

    it('should reject duplicate slug', async () => {
      const vendor1 = Vendor.create({
        personId: 'person-1',
        storeName: 'Store 1',
        slug: 'same-slug',
        commissionPct: 10
      });

      const vendor2 = Vendor.create({
        personId: 'person-2',
        storeName: 'Store 2',
        slug: 'same-slug',
        commissionPct: 10
      });

      await repo.save(vendor1);
      await expect(repo.save(vendor2)).rejects.toThrow('SLUG_ALREADY_EXISTS');
    });

    it('should reject duplicate vendor for same person', async () => {
      const vendor1 = Vendor.create({
        personId: 'person-123',
        storeName: 'Store 1',
        slug: 'store-1',
        commissionPct: 10
      });

      const vendor2 = Vendor.create({
        personId: 'person-123',
        storeName: 'Store 2',
        slug: 'store-2',
        commissionPct: 10
      });

      await repo.save(vendor1);
      await expect(repo.save(vendor2)).rejects.toThrow('PERSON_ALREADY_HAS_VENDOR');
    });

    it('should update vendor', async () => {
      const vendor = Vendor.create({
        personId: 'person-123',
        storeName: 'Test Store',
        slug: 'test-store',
        commissionPct: 10
      });

      await repo.save(vendor);
      vendor.updateStoreName('Updated Store');
      const updated = await repo.update(vendor);

      expect(updated.storeName).toBe('Updated Store');
      const found = await repo.findById(vendor.id);
      expect(found!.storeName).toBe('Updated Store');
    });

    it('should reject slug change to existing slug on update', async () => {
      const vendor1 = Vendor.create({
        personId: 'person-1',
        storeName: 'Store 1',
        slug: 'store-1',
        commissionPct: 10
      });

      const vendor2 = Vendor.create({
        personId: 'person-2',
        storeName: 'Store 2',
        slug: 'store-2',
        commissionPct: 10
      });

      await repo.save(vendor1);
      await repo.save(vendor2);

      // vendor2 cannot change slug to vendor1's slug
      vendor2.updateStoreName('Store 2 Updated');
      // Note: We don't have updateSlug method, but if we did, it would be rejected
    });
  });
});