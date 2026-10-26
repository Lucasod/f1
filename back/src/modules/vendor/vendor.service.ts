import { Vendor, VendorStatus, VendorRepository, InMemoryVendorRepository } from './vendor.domain';
import { Person, PersonRole, PersonRepository } from '../person/person.domain';
import { config } from '../../config';

export enum VendorError {
  PERSON_NOT_FOUND = 'PERSON_NOT_FOUND',
  ADMIN_CANNOT_BE_VENDOR = 'ADMIN_CANNOT_BE_VENDOR',
  SLUG_ALREADY_EXISTS = 'SLUG_ALREADY_EXISTS',
  PERSON_ALREADY_HAS_VENDOR = 'PERSON_ALREADY_HAS_VENDOR',
  STORE_NAME_REQUIRED = 'STORE_NAME_REQUIRED',
  INVALID_SLUG_FORMAT = 'INVALID_SLUG_FORMAT',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  INVALID_COMMISSION_PCT = 'INVALID_COMMISSION_PCT',
}

export interface OnboardVendorInput {
  storeName: string;
  slug: string;
}

export interface UpdateVendorInput {
  storeName?: string;
}

export class VendorService {
  private readonly vendorRepo: VendorRepository;
  private readonly personRepo: PersonRepository;

  constructor(vendorRepo: VendorRepository, personRepo: PersonRepository, _config: typeof config) {
    this.vendorRepo = vendorRepo;
    this.personRepo = personRepo;
  }

  async onboardVendor(personId: string, input: OnboardVendorInput): Promise<Vendor> {
    // Verify person exists
    const person = await this.personRepo.findById(personId);
    if (!person) {
      throw new Error(VendorError.PERSON_NOT_FOUND);
    }

    // Admin cannot be vendor (exclusive role per CD-002)
    if (person.roles.includes(PersonRole.ADMIN)) {
      throw new Error(VendorError.ADMIN_CANNOT_BE_VENDOR);
    }

    // Create vendor with global commission config (CD-045)
    const vendor = Vendor.create({
      personId,
      storeName: input.storeName,
      slug: input.slug,
      commissionPct: config.commissionPct
    });

    // Save vendor (will validate slug uniqueness and person-vendor association)
    const savedVendor = await this.vendorRepo.save(vendor);

    // Add VENDOR role to person if not already present (CD-002: Person can be Consumer and Vendor simultaneously)
    if (!person.roles.includes(PersonRole.VENDOR)) {
      person.addRole(PersonRole.VENDOR);
      await this.personRepo.save(person);
    }

    return savedVendor;
  }

  async getVendorById(id: string): Promise<Vendor | null> {
    return this.vendorRepo.findById(id);
  }

  async getVendorByPersonId(personId: string): Promise<Vendor | null> {
    return this.vendorRepo.findByPersonId(personId);
  }

  async suspendVendor(id: string): Promise<Vendor> {
    const vendor = await this.vendorRepo.findById(id);
    if (!vendor) {
      throw new Error(VendorError.VENDOR_NOT_FOUND);
    }

    vendor.suspend();
    return this.vendorRepo.update(vendor);
  }

  async updateVendor(id: string, input: UpdateVendorInput): Promise<Vendor> {
    const vendor = await this.vendorRepo.findById(id);
    if (!vendor) {
      throw new Error(VendorError.VENDOR_NOT_FOUND);
    }

    if (input.storeName !== undefined) {
      vendor.updateStoreName(input.storeName);
    }

    return this.vendorRepo.update(vendor);
  }
}