import { VendorRepository } from '../vendor/vendor.domain';
import { ProductRepository, CategoryRepository } from '../product/product.domain';
import { CouponRepository, CouponTerms, CouponSelection, CouponError, canonicalCode, validateTerms } from './coupon.domain';

export class CouponService {
  constructor(private readonly repo: CouponRepository, private readonly vendors: VendorRepository, private readonly products: ProductRepository, private readonly categories: CategoryRepository, private readonly clock = () => new Date()) {}
  private async ownedVendor(personId: string) {
    const vendor = await this.vendors.findByPersonId(personId);
    if (!vendor || vendor.personId !== personId) throw new CouponError('FORBIDDEN', 403);
    return vendor;
  }
  async create(personId: string, input: unknown): Promise<CouponTerms> {
    const vendor = await this.ownedVendor(personId);
    const terms = validateTerms(input, vendor.id);
    await this.validateReferences(terms);
    await this.repo.insert(terms);
    return terms;
  }
  async list(personId: string): Promise<CouponTerms[]> { return this.repo.list((await this.ownedVendor(personId)).id); }
  private async validateReferences(terms: CouponTerms): Promise<void> {
    for (const id of [...terms.includeProducts, ...terms.excludeProducts]) {
      const product = await this.products.findById(id);
      if (!product || product.vendorId !== terms.vendorId) throw new CouponError('INVALID_COUPON_TARGET');
    }
    const hierarchy = await this.hierarchy();
    for (const id of [...terms.includeCategories, ...terms.excludeCategories]) if (!hierarchy.has(id)) throw new CouponError('INVALID_COUPON_TARGET');
  }
  async hierarchy(): Promise<Map<string, string | null>> {
    const categories = await this.categories.findAll();
    const map = new Map(categories.map(c => [c.id, c.parentId]));
    if (map.size !== categories.length) throw new CouponError('INVALID_CATEGORY_HIERARCHY');
    for (const id of map.keys()) this.ancestors(id, map);
    return map;
  }
  private ancestors(id: string, map: Map<string, string | null>): Set<string> {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current !== null) {
      if (seen.has(current) || !map.has(current)) throw new CouponError('INVALID_CATEGORY_HIERARCHY');
      seen.add(current); current = map.get(current)!;
    }
    return seen;
  }
  eligible(terms: CouponTerms, productId: string, categoryId: string, hierarchy: Map<string, string | null>): boolean {
    const ancestors = this.ancestors(categoryId, hierarchy);
    if (terms.excludeProducts.includes(productId) || terms.excludeCategories.some(id => ancestors.has(id))) return false;
    return (!terms.includeProducts.length && !terms.includeCategories.length) || terms.includeProducts.includes(productId) || terms.includeCategories.some(id => ancestors.has(id));
  }
  async resolve(vendorIds: string[], codes: string[] = [], selections: CouponSelection[] = []): Promise<Map<string, CouponTerms>> {
    const chosen = new Map<string, CouponTerms>();
    const add = async (vendorId: string, code: string) => {
      if (!vendorIds.includes(vendorId) || chosen.has(vendorId)) throw new CouponError('INVALID_COUPON_SELECTION');
      const terms = await this.repo.find(vendorId, canonicalCode(code));
      if (!terms) throw new CouponError('INVALID_COUPON');
      await this.validateReferences(terms);
      const now = this.clock().getTime();
      if (!Number.isFinite(now) || now < Date.parse(terms.startsAt) || now >= Date.parse(terms.endsAt)) throw new CouponError('COUPON_NOT_ACTIVE');
      chosen.set(vendorId, terms);
    };
    for (const selection of selections) await add(selection.vendorId, selection.code);
    for (const code of codes) {
      const matches = (await Promise.all(vendorIds.map(async id => ({ id, terms: await this.repo.find(id, canonicalCode(code)) })))).filter(m => m.terms);
      if (matches.length !== 1) throw new CouponError(matches.length ? 'COUPON_VENDOR_REQUIRED' : 'INVALID_COUPON');
      await add(matches[0].id, code);
    }
    return chosen;
  }
}
