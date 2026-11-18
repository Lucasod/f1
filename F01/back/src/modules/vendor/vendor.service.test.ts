import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VendorService, VendorError } from './vendor.service';
import { Vendor, VendorStatus, InMemoryVendorRepository } from './vendor.domain';
import { Person, PersonRole, InMemoryPersonRepository } from '../person/person.domain';
import { config } from '../../config';
import { StripeService, ConnectOnboardingResult } from '../stripe/stripe.service';

describe('Vendor Service', () => {
  let vendorRepo: InMemoryVendorRepository;
  let personRepo: InMemoryPersonRepository;
  let vendorService: VendorService;
  let mockStripeService: StripeService;

  beforeEach(() => {
    vendorRepo = new InMemoryVendorRepository();
    personRepo = new InMemoryPersonRepository();

    mockStripeService = {
      createConnectAccount: vi.fn().mockResolvedValue({
        accountId: 'acct_test123',
        onboardingUrl: 'https://connect.stripe.com/onboard/acct_test123'
      } as ConnectOnboardingResult),
      getConnectAccountStatus: vi.fn().mockResolvedValue({
        accountId: 'acct_test123',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        capabilities: { transfers: 'active' },
        requirements: { currently_due: [], eventually_due: [], past_due: [] }
      }),
      createConnectLoginLink: vi.fn().mockResolvedValue('https://dashboard.stripe.com/login/acct_test123')
    } as unknown as StripeService;

    vendorService = new VendorService(vendorRepo, personRepo, config, mockStripeService);
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
      person.setCredential('existing-hash');
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
      expect(updatedPerson!.roles).toEqual([PersonRole.CONSUMER, PersonRole.VENDOR]);
      expect(updatedPerson!.id).toBe(person.id);
      expect(updatedPerson!.credential).toBe('existing-hash');
      expect(await personRepo.findByEmail('jane@consumer.com')).toBe(updatedPerson);
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

  describe('initiateConnectOnboarding', () => {
    let vendorId: string;
    let personId: string;

    beforeEach(async () => {
      const person = Person.create({
        name: 'Test Vendor',
        mainInfo: { taxIdType: 'CNPJ', taxIdValue: '11222333000181' },
        contactInfos: [{ type: 'email', value: 'vendor@example.com', isPrimary: true }],
        addresses: []
      });
      person.addRole(PersonRole.VENDOR);
      await personRepo.save(person);
      personId = person.id;

      const vendor = await vendorService.onboardVendor(personId, {
        storeName: 'Test Store',
        slug: 'test-store'
      });
      vendorId = vendor.id;
    });

    it('should initiate Connect onboarding for new vendor', async () => {
      const result = await vendorService.initiateConnectOnboarding(vendorId, 'https://app.example.com/return', 'https://app.example.com/refresh');

      expect(result).toEqual({
        accountId: 'acct_test123',
        onboardingUrl: 'https://connect.stripe.com/onboard/acct_test123'
      });
      expect(mockStripeService.createConnectAccount).toHaveBeenCalledWith(
        personId,
        'vendor@example.com',
        'individual',
        'https://app.example.com/return',
        'https://app.example.com/refresh',
        expect.stringMatching(/^vendor-onboarding-/)
      );

      // Verify stripeAccountId is saved on vendor
      const updatedVendor = await vendorRepo.findById(vendorId);
      expect(updatedVendor!.stripeAccountId).toBe('acct_test123');
    });

    it('should return login link for vendor with completed onboarding', async () => {
      // Pre-set stripeAccountId
      const vendor = await vendorRepo.findById(vendorId);
      vendor!.setStripeAccountId('acct_existing123');
      await vendorRepo.update(vendor!);

      mockStripeService.getConnectAccountStatus.mockResolvedValue({
        accountId: 'acct_existing123',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        capabilities: { transfers: 'active' },
        requirements: { currently_due: [], eventually_due: [], past_due: [] }
      });
      mockStripeService.createConnectLoginLink.mockResolvedValue('https://dashboard.stripe.com/login/acct_existing123');

      const result = await vendorService.initiateConnectOnboarding(vendorId, 'https://app.example.com/return', 'https://app.example.com/refresh');

      expect(result).toEqual({
        accountId: 'acct_existing123',
        onboardingUrl: 'https://dashboard.stripe.com/login/acct_existing123'
      });
      expect(mockStripeService.getConnectAccountStatus).toHaveBeenCalledWith('acct_existing123');
      expect(mockStripeService.createConnectLoginLink).toHaveBeenCalledWith('acct_existing123');
    });

    it('should throw VENDOR_NOT_FOUND for non-existent vendor', async () => {
      await expect(vendorService.initiateConnectOnboarding('non-existent', 'return', 'refresh'))
        .rejects.toThrow(VendorError.VENDOR_NOT_FOUND);
    });

    it('should throw PERSON_NOT_FOUND if vendor person not found', async () => {
      // Create vendor with non-existent personId
      const vendor = Vendor.create({
        personId: 'non-existent-person',
        storeName: 'Test Store',
        slug: 'test-store-2',
        commissionPct: 10
      });
      vendor.id = 'vendor-2';
      await vendorRepo.save(vendor);

      await expect(vendorService.initiateConnectOnboarding(vendor.id, 'return', 'refresh'))
        .rejects.toThrow(VendorError.PERSON_NOT_FOUND);
    });

    it('should throw STRIPE_CONNECT_ONBOARDING_FAILED when StripeService not configured', async () => {
      const vendorServiceWithoutStripe = new VendorService(vendorRepo, personRepo, config);
      await expect(vendorServiceWithoutStripe.initiateConnectOnboarding(vendorId, 'return', 'refresh'))
        .rejects.toThrow(VendorError.STRIPE_CONNECT_ONBOARDING_FAILED);
    });

    it('should handle concurrent calls idempotently (CR-001)', async () => {
      // Track call count to verify Stripe is only called once
      let callCount = 0;
      mockStripeService.createConnectAccount.mockImplementation(async () => {
        callCount++;
        return {
          accountId: 'acct_test123',
          onboardingUrl: 'https://connect.stripe.com/onboard/acct_test123'
        } as ConnectOnboardingResult;
      });

      // Fire multiple concurrent requests for the same vendorId
      const promises = [
        vendorService.initiateConnectOnboarding(vendorId, 'https://app.example.com/return', 'https://app.example.com/refresh'),
        vendorService.initiateConnectOnboarding(vendorId, 'https://app.example.com/return', 'https://app.example.com/refresh'),
        vendorService.initiateConnectOnboarding(vendorId, 'https://app.example.com/return', 'https://app.example.com/refresh'),
      ];

      const results = await Promise.all(promises);

      // All calls should return the same accountId
      expect(results[0].accountId).toBe('acct_test123');
      expect(results[1].accountId).toBe('acct_test123');
      expect(results[2].accountId).toBe('acct_test123');

      // Stripe should only be called once due to the lock
      expect(callCount).toBe(1);
      expect(mockStripeService.createConnectAccount).toHaveBeenCalledTimes(1);

      // Verify stripeAccountId is saved on vendor
      const updatedVendor = await vendorRepo.findById(vendorId);
      expect(updatedVendor!.stripeAccountId).toBe('acct_test123');
    });

    it('should handle sequential calls idempotently after first completes', async () => {
      let callCount = 0;
      mockStripeService.createConnectAccount.mockImplementation(async () => {
        callCount++;
        return {
          accountId: 'acct_test123',
          onboardingUrl: 'https://connect.stripe.com/onboard/acct_test123'
        } as ConnectOnboardingResult;
      });

      // First call
      const result1 = await vendorService.initiateConnectOnboarding(vendorId, 'https://app.example.com/return', 'https://app.example.com/refresh');
      expect(result1.accountId).toBe('acct_test123');

      // Second call (sequential, after first completes)
      const result2 = await vendorService.initiateConnectOnboarding(vendorId, 'https://app.example.com/return', 'https://app.example.com/refresh');
      expect(result2.accountId).toBe('acct_test123');

      // Stripe should only be called once because vendor now has stripeAccountId
      expect(callCount).toBe(1);
      expect(mockStripeService.createConnectAccount).toHaveBeenCalledTimes(1);
    });
  });
});