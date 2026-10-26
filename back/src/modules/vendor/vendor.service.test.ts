import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VendorService, VendorError } from './vendor.service';
import { Vendor, VendorStatus, InMemoryVendorRepository } from './vendor.domain';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';
import { config } from '../../config';

describe('Vendor Service', () => {
  let vendorRepo: InMemoryVendorRepository;
  let personRepo: InMemoryPersonRepository;
  let vendorService: VendorService;

  beforeEach(() => {
    vendorRepo = new InMemoryVendorRepository();
    personRepo = new InMemoryPersonRepository();
    vendorService = new VendorService(vendorRepo, personRepo, config);
  });

  describe('onboardVendor', () => {
    it('should onboard a new vendor for a person with VENDOR role', async () => {
      const person = Person.create({
        name: 'John Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'john@vendor.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      const vendor = await vendorService.onboardVendor(person.id, {
        storeName: 'John\'s Electronics',
        slug: 'johns-electronics'
      });

      expect(vendor).toBeDefined();
      expect(vendor.personId).toBe(person.id);
      expect(vendor.storeName).toBe('John\'s Electronics');
      expect(vendor.slug).toBe('johns-electronics');
      expect(vendor.status).toBe(VendorStatus.ACTIVE); // Auto-publish per CD-041
      expect(vendor.commissionPct).toBe(config.commissionPct);
    });

    it('should onboard a new vendor for a person with CONSUMER role (becoming VENDOR)', async () => {
      const person = Person.create({
        name: 'Jane Consumer',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'jane@consumer.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.CONSUMER);
      await personRepo.save(person);

      const vendor = await vendorService.onboardVendor(person.id, {
        storeName: 'Jane\'s Shop',
        slug: 'janes-shop'
      });

      expect(vendor).toBeDefined();
      expect(vendor.personId).toBe(person.id);
      expect(vendor.status).toBe(VendorStatus.ACTIVE);
      
      // Verify person now has VENDOR role too (CD-002)
      const updatedPerson = await personRepo.findById(person.id);
      expect(updatedPerson!.roles).toContain(PersonRole.VENDOR);
    });

    it('should use global commission config (CD-045)', async () => {
      const person = Person.create({
        name: 'Test Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'test@vendor.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      const vendor = await vendorService.onboardVendor(person.id, {
        storeName: 'Test Store',
        slug: 'test-store'
      });

      expect(vendor.commissionPct).toBe(config.commissionPct);
    });

    it('should reject onboarding for non-existent person', async () => {
      await expect(vendorService.onboardVendor('non-existent', {
        storeName: 'Test Store',
        slug: 'test-store'
      })).rejects.toThrow(VendorError.PERSON_NOT_FOUND);
    });

    it('should reject onboarding for person with ADMIN role (exclusive)', async () => {
      const person = Person.create({
        name: 'Admin User',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'admin@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.ADMIN);
      await personRepo.save(person);

      await expect(vendorService.onboardVendor(person.id, {
        storeName: 'Admin Store',
        slug: 'admin-store'
      })).rejects.toThrow(VendorError.ADMIN_CANNOT_BE_VENDOR);
    });

    it('should reject duplicate slug', async () => {
      const person1 = Person.create({
        name: 'Vendor 1',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor1@example.com', isPrimary: true }],
        addresses: []
      });
      person1.addRole(PersonRole.VENDOR);
      await personRepo.save(person1);

      const person2 = Person.create({
        name: 'Vendor 2',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000292' },
        contactInfos: [{ type: 'email', value: 'vendor2@example.com', isPrimary: true }],
        addresses: []
      });
      person2.addRole(PersonRole.VENDOR);
      await personRepo.save(person2);

      await vendorService.onboardVendor(person1.id, {
        storeName: 'Store 1',
        slug: 'same-slug'
      });

      await expect(vendorService.onboardVendor(person2.id, {
        storeName: 'Store 2',
        slug: 'same-slug'
      })).rejects.toThrow(VendorError.SLUG_ALREADY_EXISTS);
    });

    it('should reject duplicate vendor for same person', async () => {
      const person = Person.create({
        name: 'Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      await vendorService.onboardVendor(person.id, {
        storeName: 'Store 1',
        slug: 'store-1'
      });

      await expect(vendorService.onboardVendor(person.id, {
        storeName: 'Store 2',
        slug: 'store-2'
      })).rejects.toThrow(VendorError.PERSON_ALREADY_HAS_VENDOR);
    });

    it('should reject invalid storeName', async () => {
      const person = Person.create({
        name: 'Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      await expect(vendorService.onboardVendor(person.id, {
        storeName: '',
        slug: 'test-store'
      })).rejects.toThrow(VendorError.STORE_NAME_REQUIRED);
    });

    it('should reject invalid slug format', async () => {
      const person = Person.create({
        name: 'Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      await expect(vendorService.onboardVendor(person.id, {
        storeName: 'Test Store',
        slug: 'Invalid_Slug!'
      })).rejects.toThrow(VendorError.INVALID_SLUG_FORMAT);
    });
  });

  describe('getVendorById', () => {
    it('should return vendor by ID', async () => {
      const person = Person.create({
        name: 'Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      const created = await vendorService.onboardVendor(person.id, {
        storeName: 'Test Store',
        slug: 'test-store'
      });

      const vendor = await vendorService.getVendorById(created.id);
      expect(vendor).not.toBeNull();
      expect(vendor!.id).toBe(created.id);
    });

    it('should return null for non-existent vendor', async () => {
      const vendor = await vendorService.getVendorById('non-existent');
      expect(vendor).toBeNull();
    });
  });

  describe('getVendorByPersonId', () => {
    it('should return vendor by personId', async () => {
      const person = Person.create({
        name: 'Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      const created = await vendorService.onboardVendor(person.id, {
        storeName: 'Test Store',
        slug: 'test-store'
      });

      const vendor = await vendorService.getVendorByPersonId(person.id);
      expect(vendor).not.toBeNull();
      expect(vendor!.id).toBe(created.id);
    });

    it('should return null for person without vendor', async () => {
      const person = Person.create({
        name: 'Consumer',
        mainInfo: { taxIdType: 'CPF', taxIdValue: '52998224725' },
        contactInfos: [{ type: 'email', value: 'consumer@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.CONSUMER);
      await personRepo.save(person);

      const vendor = await vendorService.getVendorByPersonId(person.id);
      expect(vendor).toBeNull();
    });
  });

  describe('suspendVendor', () => {
    it('should suspend vendor (terminal state per CD-063)', async () => {
      const person = Person.create({
        name: 'Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      const created = await vendorService.onboardVendor(person.id, {
        storeName: 'Test Store',
        slug: 'test-store'
      });

      const suspended = await vendorService.suspendVendor(created.id);
      expect(suspended.status).toBe(VendorStatus.SUSPENDED);
    });

    it('should reject suspending non-existent vendor', async () => {
      await expect(vendorService.suspendVendor('non-existent'))
        .rejects.toThrow(VendorError.VENDOR_NOT_FOUND);
    });
  });

  describe('updateVendor', () => {
    it('should update vendor storeName', async () => {
      const person = Person.create({
        name: 'Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);

      const created = await vendorService.onboardVendor(person.id, {
        storeName: 'Test Store',
        slug: 'test-store'
      });

      const updated = await vendorService.updateVendor(created.id, {
        storeName: 'Updated Store'
      });

      expect(updated.storeName).toBe('Updated Store');
    });

    it('should reject updating non-existent vendor', async () => {
      await expect(vendorService.updateVendor('non-existent', {
        storeName: 'Updated Store'
      })).rejects.toThrow(VendorError.VENDOR_NOT_FOUND);
    });
  });
});