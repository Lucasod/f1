import type { Collection, Db } from 'mongodb';
import { CouponError, CouponRepository, CouponTerms, couponIdentity, validateTerms } from './coupon.domain';

type CouponDocument = CouponTerms & { _id: string };
export class MongoCouponRepository implements CouponRepository {
  private readonly collection: Collection<CouponDocument>;
  constructor(db: Db) { this.collection = db.collection<CouponDocument>('coupons'); }
  async insert(terms: CouponTerms): Promise<void> {
    try { await this.collection.insertOne({ ...structuredClone(terms), _id: couponIdentity(terms.vendorId, terms.code) }); }
    catch (error) {
      if ((error as { code?: number })?.code === 11000) throw new CouponError('COUPON_CONFLICT', 409);
      throw error;
    }
  }
  private restore(doc: CouponDocument): CouponTerms {
    const { _id, id, vendorId, revision, ...input } = doc;
    const terms = validateTerms(input, vendorId);
    if (revision !== 1 || id !== terms.id || _id !== terms.id) throw new CouponError('INVALID_COUPON');
    return terms;
  }
  async find(vendorId: string, code: string): Promise<CouponTerms | null> {
    const doc = await this.collection.findOne({ _id: couponIdentity(vendorId, code) });
    return doc ? this.restore(doc) : null;
  }
  async list(vendorId: string): Promise<CouponTerms[]> {
    return (await this.collection.find({ vendorId }).toArray()).map(d => this.restore(d)).sort((a, b) => a.code.localeCompare(b.code));
  }
}
