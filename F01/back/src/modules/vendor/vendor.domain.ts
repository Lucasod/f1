export enum VendorStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended'
}

export interface VendorData {
  id?: string;
  personId: string;
  storeName: string;
  slug: string;
  status?: VendorStatus;
  commissionPct: number;
  stripeAccountId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

export class Vendor {
  public readonly id: string;
  public readonly personId: string;
  public storeName: string;
  public readonly slug: string;
  public status: VendorStatus;
  public readonly commissionPct: number;
  public readonly createdAt: Date;
  public updatedAt: Date;
  public readonly stripeAccountId: string | undefined;

  private constructor(data: VendorData) {
    this.id = data.id || generateId();
    this.personId = data.personId;
    this.storeName = data.storeName;
    this.slug = data.slug;
    this.status = data.status || VendorStatus.ACTIVE;
    this.commissionPct = data.commissionPct;
    this.stripeAccountId = data.stripeAccountId;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  static create(data: Omit<VendorData, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { commissionPct?: number }): Vendor {
    if (!data.personId || data.personId.trim().length === 0) {
      throw new Error('PERSON_ID_REQUIRED');
    }

    const trimmedStoreName = data.storeName.trim();
    if (!trimmedStoreName || trimmedStoreName.length === 0) {
      throw new Error('STORE_NAME_REQUIRED');
    }
    if (trimmedStoreName.length < 2) {
      throw new Error('STORE_NAME_TOO_SHORT');
    }

    const trimmedSlug = data.slug.trim().toLowerCase();
    if (!trimmedSlug || trimmedSlug.length === 0) {
      throw new Error('SLUG_REQUIRED');
    }
    if (trimmedSlug.length < 2) {
      throw new Error('INVALID_SLUG_FORMAT');
    }

    if (!validateSlug(trimmedSlug)) {
      throw new Error('INVALID_SLUG_FORMAT');
    }

    const commissionPct = data.commissionPct ?? 10;
    if (commissionPct < 0 || commissionPct > 100) {
      throw new Error('INVALID_COMMISSION_PCT');
    }

    return new Vendor({
      ...data,
      storeName: trimmedStoreName,
      slug: trimmedSlug,
      commissionPct,
      status: VendorStatus.ACTIVE
    });
  }

  suspend(): void {
    if (this.status === VendorStatus.SUSPENDED) {
      return;
    }
    this.status = VendorStatus.SUSPENDED;
    this.updatedAt = new Date();
  }

  activate(force: boolean = false): void {
    if (this.status === VendorStatus.ACTIVE) {
      return;
    }
    if (this.status === VendorStatus.SUSPENDED && !force) {
      throw new Error('CANNOT_ACTIVATE_SUSPENDED');
    }
    this.status = VendorStatus.ACTIVE;
    this.updatedAt = new Date();
  }

  updateStoreName(newStoreName: string): void {
    const trimmedStoreName = newStoreName.trim();
    if (!trimmedStoreName || trimmedStoreName.length === 0) {
      throw new Error('STORE_NAME_REQUIRED');
    }
    if (trimmedStoreName.length < 2) {
      throw new Error('STORE_NAME_TOO_SHORT');
    }
    this.storeName = trimmedStoreName;
    this.updatedAt = new Date();
  }

  setStripeAccountId(accountId: string): void {
    if (!accountId || accountId.trim().length === 0) {
      throw new Error('STRIPE_ACCOUNT_ID_REQUIRED');
    }
    (this as any).stripeAccountId = accountId.trim();
    this.updatedAt = new Date();
  }

  static reconstruct(data: VendorData): Vendor {
    return new Vendor(data);
  }
}

export interface VendorRepository {
  save(vendor: Vendor): Promise<Vendor>;
  findById(id: string): Promise<Vendor | null>;
  findBySlug(slug: string): Promise<Vendor | null>;
  findByPersonId(personId: string): Promise<Vendor | null>;
  update(vendor: Vendor): Promise<Vendor>;
  delete(id: string): Promise<void>;
}

export class InMemoryVendorRepository implements VendorRepository {
  private vendors: Map<string, Vendor> = new Map();
  private slugIndex: Map<string, string> = new Map();
  private personIndex: Map<string, string> = new Map();

  async countAll(): Promise<number> {
    return this.vendors.size;
  }

  async save(vendor: Vendor): Promise<Vendor> {
    const existingSlugId = this.slugIndex.get(vendor.slug.toLowerCase());
    if (existingSlugId && existingSlugId !== vendor.id) {
      throw new Error('SLUG_ALREADY_EXISTS');
    }
    this.slugIndex.set(vendor.slug.toLowerCase(), vendor.id);

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
    const existingSlugId = this.slugIndex.get(vendor.slug.toLowerCase());
    if (existingSlugId && existingSlugId !== vendor.id) {
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

  clear(): void {
    this.vendors.clear();
    this.slugIndex.clear();
    this.personIndex.clear();
  }
}
