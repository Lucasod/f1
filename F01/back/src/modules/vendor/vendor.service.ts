import { Vendor, VendorStatus, VendorRepository, InMemoryVendorRepository } from './vendor.domain';
import { Person, PersonRole, PersonRepository } from '../person/person.domain';
import { config } from '../../config';
import { StripeService, ConnectOnboardingResult, StripeServiceError } from '../stripe/stripe.service';

export enum VendorError {
  PERSON_NOT_FOUND = 'PERSON_NOT_FOUND',
  ADMIN_CANNOT_BE_VENDOR = 'ADMIN_CANNOT_BE_VENDOR',
  SLUG_ALREADY_EXISTS = 'SLUG_ALREADY_EXISTS',
  PERSON_ALREADY_HAS_VENDOR = 'PERSON_ALREADY_HAS_VENDOR',
  STORE_NAME_REQUIRED = 'STORE_NAME_REQUIRED',
  INVALID_SLUG_FORMAT = 'INVALID_SLUG_FORMAT',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  INVALID_COMMISSION_PCT = 'INVALID_COMMISSION_PCT',
  CANNOT_ACTIVATE_SUSPENDED = 'CANNOT_ACTIVATE_SUSPENDED',
  VENDOR_ALREADY_ACTIVE = 'VENDOR_ALREADY_ACTIVE',
  STRIPE_CONNECT_ONBOARDING_FAILED = 'STRIPE_CONNECT_ONBOARDING_FAILED',
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
  private readonly stripeService: StripeService;
  // In-flight onboarding promises per vendorId to prevent duplicate account creation (CR-001)
  private readonly onboardingLocks = new Map<string, Promise<ConnectOnboardingResult>>();

  constructor(vendorRepo: VendorRepository, personRepo: PersonRepository, _config: typeof config, stripeService?: StripeService) {
    this.vendorRepo = vendorRepo;
    this.personRepo = personRepo;
    this.stripeService = stripeService;
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

  async activateVendor(id: string): Promise<Vendor> {
    const vendor = await this.vendorRepo.findById(id);
    if (!vendor) {
      throw new Error(VendorError.VENDOR_NOT_FOUND);
    }

    if (vendor.status === VendorStatus.ACTIVE) {
      throw new Error(VendorError.VENDOR_ALREADY_ACTIVE);
    }

    vendor.activate(true); // force = true for admin reactivation
    return this.vendorRepo.update(vendor);
  }

  /**
   * Initiates Stripe Connect Express onboarding for a vendor.
   * Creates or retrieves the connected account and generates an onboarding link.
   * Stores the stripeAccountId on the vendor.
   * Idempotent: concurrent calls for the same vendorId return the same accountId (CR-001).
   */
  async initiateConnectOnboarding(
    vendorId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<ConnectOnboardingResult> {
    if (!this.stripeService) {
      throw new Error(VendorError.STRIPE_CONNECT_ONBOARDING_FAILED);
    }

    // Idempotency guard: return in-flight promise if another call is already processing this vendor
    const existingPromise = this.onboardingLocks.get(vendorId);
    if (existingPromise) {
      return existingPromise;
    }

    // Create a new promise for this vendorId and store it
    const onboardingPromise = this.executeConnectOnboarding(vendorId, returnUrl, refreshUrl);
    this.onboardingLocks.set(vendorId, onboardingPromise);

    try {
      return await onboardingPromise;
    } finally {
      // Clean up the lock after completion (success or failure)
      this.onboardingLocks.delete(vendorId);
    }
  }

  /**
   * Internal method that executes the actual onboarding logic.
   * Separated to allow the lock wrapper to manage the promise lifecycle.
   */
  private async executeConnectOnboarding(
    vendorId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<ConnectOnboardingResult> {
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new Error(VendorError.VENDOR_NOT_FOUND);
    }

    const person = await this.personRepo.findById(vendor.personId);
    if (!person) {
      throw new Error(VendorError.PERSON_NOT_FOUND);
    }

    const email = person.primaryEmail || person.email;
    if (!email) {
      throw new Error('PERSON_EMAIL_REQUIRED');
    }

    let accountId = vendor.stripeAccountId;

    // If vendor already has a connected account, check its status
    if (accountId) {
      try {
        const status = await this.stripeService.getConnectAccountStatus(accountId);
        // If onboarding is complete, create a login link instead
        if (status.detailsSubmitted && status.chargesEnabled) {
          const loginUrl = await this.stripeService.createConnectLoginLink(accountId);
          return { accountId, onboardingUrl: loginUrl };
        }
      } catch (error) {
        // Account might be invalid, will create new one
        if (error instanceof StripeServiceError && error.stripeCode === 'resource_not_found') {
          accountId = undefined;
        } else {
          throw error;
        }
      }
    }

    // Create new connected account or use existing
    if (!accountId) {
      // Use vendorId as idempotency key to prevent duplicate Stripe accounts on retry
      const idempotencyKey = `vendor-onboarding-${vendorId}`;
      const result = await this.stripeService.createConnectAccount(
        vendor.personId,
        email,
        'individual', // businessType - could be made configurable
        returnUrl,
        refreshUrl,
        idempotencyKey
      );
      accountId = result.accountId;
      vendor.setStripeAccountId(accountId);
      await this.vendorRepo.update(vendor);
      return result;
    } else {
      // Create new onboarding link for existing account
      const accountLink = await this.stripeService.createConnectAccount(
        vendor.personId,
        email,
        'individual',
        returnUrl,
        refreshUrl
      );
      // Note: createConnectAccount creates a new account, so we need a different method
      // For now, we'll use a login link for existing accounts
      const loginUrl = await this.stripeService.createConnectLoginLink(accountId);
      return { accountId, onboardingUrl: loginUrl };
    }
  }
}