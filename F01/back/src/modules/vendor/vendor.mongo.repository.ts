import { Db, Collection } from 'mongodb';
import { Vendor, VendorRepository, VendorStatus } from './vendor.domain';

interface VendorDoc {
  _id: string;
  personId: string;
  storeName: string;
  slug: string;
  status: VendorStatus;
  commissionPct: number;
  createdAt: Date;
  updatedAt: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export class MongoVendorRepository implements VendorRepository {
  private vendorsCollection: Collection<VendorDoc>;

  constructor(db: Db) {
    this.vendorsCollection = db.collection<VendorDoc>('vendors');
  }

  async save(vendor: Vendor): Promise<Vendor> {
    const vendorId = vendor.id;

    // Check for duplicate slug before saving
    const existingSlug = await this.vendorsCollection.findOne({
      slug: { $regex: new RegExp(`^${vendor.slug}$`, 'i') },
      _id: { $ne: vendorId }
    });
    if (existingSlug) {
      throw new Error('SLUG_ALREADY_EXISTS');
    }

    // Check for duplicate personId before saving
    const existingPerson = await this.vendorsCollection.findOne({
      personId: vendor.personId,
      _id: { $ne: vendorId }
    });
    if (existingPerson) {
      throw new Error('PERSON_ALREADY_HAS_VENDOR');
    }

    const now = new Date();

    await this.vendorsCollection.updateOne(
      { _id: vendorId },
      {
        $set: {
          personId: vendor.personId,
          storeName: vendor.storeName,
          slug: vendor.slug,
          status: vendor.status,
          commissionPct: vendor.commissionPct,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: vendor.createdAt
        }
      },
      { upsert: true }
    );

    return Vendor.reconstruct({
      ...vendor,
      updatedAt: now
    } as any);
  }

  async findById(id: string): Promise<Vendor | null> {
    const vendorDoc = await this.vendorsCollection.findOne({ _id: id });

    if (!vendorDoc) {
      return null;
    }

    return this.mapToVendor(vendorDoc);
  }

  async findBySlug(slug: string): Promise<Vendor | null> {
    const vendorDoc = await this.vendorsCollection.findOne({
      slug: { $regex: new RegExp(`^${slug}$`, 'i') }
    });

    if (!vendorDoc) {
      return null;
    }

    return this.mapToVendor(vendorDoc);
  }

  async findByPersonId(personId: string): Promise<Vendor | null> {
    const vendorDoc = await this.vendorsCollection.findOne({ personId });

    if (!vendorDoc) {
      return null;
    }

    return this.mapToVendor(vendorDoc);
  }

  async update(vendor: Vendor): Promise<Vendor> {
    const vendorId = vendor.id;

    // Check for duplicate slug (excluding self)
    const existingSlug = await this.vendorsCollection.findOne({
      slug: { $regex: new RegExp(`^${vendor.slug}$`, 'i') },
      _id: { $ne: vendorId }
    });
    if (existingSlug) {
      throw new Error('SLUG_ALREADY_EXISTS');
    }

    const now = new Date();

    await this.vendorsCollection.updateOne(
      { _id: vendorId },
      {
        $set: {
          personId: vendor.personId,
          storeName: vendor.storeName,
          slug: vendor.slug,
          status: vendor.status,
          commissionPct: vendor.commissionPct,
          updatedAt: now
        }
      }
    );

    return Vendor.reconstruct({
      ...vendor,
      updatedAt: now
    } as any);
  }

  async delete(id: string): Promise<void> {
    await this.vendorsCollection.deleteOne({ _id: id });
  }

  private mapToVendor(doc: VendorDoc): Vendor {
    return Vendor.reconstruct({
      id: doc._id,
      personId: doc.personId,
      storeName: doc.storeName,
      slug: doc.slug,
      status: doc.status,
      commissionPct: doc.commissionPct,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  }
}