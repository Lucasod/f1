import { Db, Collection, Filter } from 'mongodb';
import { Product, ProductRepository, ProductStatus, ProductError } from './product.domain';

interface ProductDoc {
  _id: string;
  seedIdentity?: string;
  vendorId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  status: ProductStatus;
  images: string[];
  createdAt: Date;
  updatedAt: Date;
  // Internal projection intent; never mapped into the public Product domain object.
  searchRevision?: number;
  searchPending?: boolean;
  searchRetryAt?: Date;
  searchAttempts?: number;
  reservedBy?: string;
  reservedQuantity?: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export interface PendingProductSearchSnapshot {
  product: Product;
  revision: number;
  attempts?: number;
  retryAt?: Date;
}

// Missing metadata is initialized by the same mutation as the business write.
// $cond prevents numeric operators from evaluating corrupt nonnumeric values.
function writableSearchRevision(): Filter<ProductDoc> {
  return { $or: [
    { searchRevision: { $exists: false } },
    { $expr: { $cond: [
      { $isNumber: '$searchRevision' },
      { $and: [
        { $gte: ['$searchRevision', 0] },
        { $lt: ['$searchRevision', Number.MAX_SAFE_INTEGER] },
        { $eq: [{ $mod: ['$searchRevision', 1] }, 0] },
      ] },
      false,
    ] } },
  ] };
}

function pendingSearchIntent() {
  return { searchPending: true, searchRetryAt: new Date(0), searchAttempts: 0 };
}

export class MongoProductRepository implements ProductRepository {
  private productsCollection: Collection<ProductDoc>;

  constructor(db: Db) {
    this.productsCollection = db.collection<ProductDoc>('products');
  }

  async assertSeedIdentityReady(): Promise<void> {
    let indexes;
    try {
      indexes = await this.productsCollection.listIndexes().toArray();
    } catch {
      throw new Error('PRODUCT_SEED_INDEX_UNAVAILABLE');
    }
    const safeIndex = indexes.some(index => {
      const key = index.key;
      const partial = index.partialFilterExpression;
      const keyOk = !!key && Object.keys(key).length === 1 && key.seedIdentity === 1;
      const partialOk = !!partial && Object.keys(partial).length === 1
        && !!partial.seedIdentity && Object.keys(partial.seedIdentity).length === 1;
      const typeValue = partial?.seedIdentity?.$type;
      const typeOk = typeValue === 'string' || typeValue === 2;
      // Collation: accept a missing/empty/default collation (MongoDB returns no
      // collation property for indexes created without one, and may report a
      // default locale for inherited collection collations). Also accept the
      // canonical default index name as a fallback for legacy metadata.
      const collation = index.collation;
      const collationOk = !collation
        || collation.locale === undefined
        || collation.locale === ''
        || collation.locale === 'simple';
      const nameOk = index.name === 'seedIdentity_1';
      return index.unique === true && keyOk && partialOk && typeOk
        && (collationOk || nameOk);
    });
    if (!safeIndex) throw new Error('PRODUCT_SEED_INDEX_UNAVAILABLE');
  }

  async save(product: Product): Promise<Product> {
    const productId = product.id;
    const now = new Date();

    if (product.seedIdentity) await this.assertSeedIdentityReady();

    let result;
    try {
      result = await this.productsCollection.updateOne(
        { _id: productId },
        {
          $setOnInsert: {
            vendorId: product.vendorId,
            ...(product.seedIdentity ? { seedIdentity: product.seedIdentity } : {}),
            categoryId: product.categoryId,
            name: product.name,
            description: product.description,
            price: product.price,
            quantity: product.quantity,
            status: product.status,
            images: product.images,
            searchRevision: 1,
            ...pendingSearchIntent(),
            updatedAt: now,
            createdAt: product.createdAt
          }
        },
        { upsert: true }
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new Error(ProductError.PRODUCT_CONFLICT);
      }
      throw error;
    }
    if (result.upsertedCount !== 1) {
      throw new Error(ProductError.PRODUCT_CONFLICT);
    }

    return Product.reconstruct({
      ...product,
      updatedAt: now
    } as any);
  }

  async findById(id: string): Promise<Product | null> {
    const productDoc = await this.productsCollection.findOne({ _id: id });

    if (!productDoc) {
      return null;
    }

    return this.mapToProduct(productDoc);
  }

  async findByVendorId(vendorId: string): Promise<Product[]> {
    const products = await this.productsCollection
      .find({ vendorId })
      .toArray();

    return products.map(doc => this.mapToProduct(doc));
  }

  async findByCategoryId(categoryId: string): Promise<Product[]> {
    const products = await this.productsCollection
      .find({ categoryId })
      .toArray();

    return products.map(doc => this.mapToProduct(doc));
  }

  async findAll(filters?: { status?: string; vendorId?: string; search?: string; sortBy?: string }): Promise<Product[]> {
    const query: any = {};

    if (filters?.status) {
      query.status = filters.status;
    }

    if (filters?.vendorId) {
      query.vendorId = filters.vendorId;
    }

    if (filters?.search) {
      const searchRegex = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex }
      ];
    }

    const cursor = this.productsCollection.find(query);
    const products = await cursor.toArray();
    let mappedProducts = products.map(doc => this.mapToProduct(doc));

    switch (filters?.sortBy ?? 'stock_status') {
        case 'name':
          mappedProducts.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case 'price_asc':
          mappedProducts.sort((a, b) => a.price - b.price);
          break;
        case 'price_desc':
          mappedProducts.sort((a, b) => b.price - a.price);
          break;
        case 'newest':
          mappedProducts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'stock_status':
          mappedProducts.sort((a, b) => {
            if (a.quantity > 0 && b.quantity === 0) return -1;
            if (a.quantity === 0 && b.quantity > 0) return 1;
            return b.quantity - a.quantity;
          });
          break;
    }

    return mappedProducts;
  }

  async update(product: Product): Promise<Product> {
    const productId = product.id;
    const now = new Date();

    const result = await this.productsCollection.updateOne(
      { _id: productId, ...writableSearchRevision() },
      {
        $inc: { searchRevision: 1 },
        $set: {
          vendorId: product.vendorId,
          categoryId: product.categoryId,
          name: product.name,
          description: product.description,
          price: product.price,
          quantity: product.quantity,
          status: product.status,
          images: product.images,
          updatedAt: now,
          ...pendingSearchIntent()
        }
      }
    );

    if (result.matchedCount !== 1) await this.rejectUnmatchedMutation(productId);

    return Product.reconstruct({
      ...product,
      updatedAt: now
    } as any);
  }

  async delete(_id: string): Promise<void> {
    // Physical deletion would destroy intent and allow an ID's revision to restart.
    // ProductService already uses inactivation. Tombstones require a separate contract.
    throw new Error('PRODUCT_SEARCH_PHYSICAL_DELETE_UNAVAILABLE');
  }

  async decrementStock(productId: string, amount: number): Promise<boolean> {
    const result = await this.productsCollection.updateOne(
      { _id: productId, quantity: { $gte: amount }, ...writableSearchRevision() },
      { $inc: { quantity: -amount, searchRevision: 1 }, $set: { updatedAt: new Date(), ...pendingSearchIntent() } }
    );
    if (result.modifiedCount > 0) {
      return true;
    }
    await this.rejectUnmatchedMutation(productId, true);
    return false;
  }

  async incrementStock(productId: string, amount: number): Promise<void> {
    const result = await this.productsCollection.updateOne(
      { _id: productId, ...writableSearchRevision() },
      { $inc: { quantity: amount, searchRevision: 1 }, $set: { updatedAt: new Date(), ...pendingSearchIntent() } }
    );
    if (result.matchedCount !== 1) await this.rejectUnmatchedMutation(productId);
  }

  async reserveForAttempt(productId: string, attemptId: string, amount: number): Promise<boolean> {
    const result = await this.productsCollection.updateOne(
      { _id: productId, quantity: { $gte: amount }, reservedBy: { $ne: attemptId } },
      { $set: { reservedBy: attemptId, reservedQuantity: amount }, $inc: { quantity: -amount } }
    );
    return result.modifiedCount > 0;
  }

  async releaseForAttempt(productId: string, attemptId: string, amount: number): Promise<boolean> {
    const result = await this.productsCollection.updateOne(
      { _id: productId, reservedBy: attemptId, reservedQuantity: { $gte: amount } },
      { $inc: { quantity: amount, reservedQuantity: -amount }, $set: { reservedBy: amount > 0 ? attemptId : undefined, reservedQuantity: amount > 0 ? amount : undefined } }
    );
    return result.modifiedCount > 0;
  }

  // A single document read binds each snapshot to its revision. Reading never acknowledges.
  async readPendingSearchSnapshots(limit = 100, now = new Date(), afterId?: string): Promise<PendingProductSearchSnapshot[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isFinite(now.getTime())) {
      throw new Error('PRODUCT_SEARCH_BATCH_INVALID');
    }
    const due: Filter<ProductDoc> = { searchPending: true, searchRetryAt: { $lte: now } };
    // Workers rotate by ID, rather than always selecting a hot low-ID mutation
    // whose retryAt resets to epoch. Legacy diagnostic reads retain their contract.
    if (afterId !== undefined) {
      due.$expr = { $cond: [{ $isNumber: '$searchRevision' }, { $and: [
        { $gte: ['$searchRevision', 1] }, { $lte: ['$searchRevision', Number.MAX_SAFE_INTEGER] },
        { $eq: [{ $mod: ['$searchRevision', 1] }, 0] },
      ] }, false] };
    }
    const read = (cursor?: string) => this.productsCollection
      .find({ ...due, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { timeoutMS: 5000 })
      .sort(afterId === undefined ? { searchRetryAt: 1, _id: 1 } : { _id: 1 }).limit(limit).toArray();
    let documents = await read(afterId);
    if (!documents.length && afterId) documents = await read();
    return documents.map(doc => {
      const revision = doc.searchRevision;
      if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
        throw new Error('PRODUCT_SEARCH_REVISION_INVALID');
      }
      return { product: this.mapToProduct(doc), revision, attempts: doc.searchAttempts ?? 0, retryAt: doc.searchRetryAt };
    });
  }

  async enqueueSearch(id: string): Promise<PendingProductSearchSnapshot> {
    if (typeof id !== 'string' || !id) throw new Error('ELASTICSEARCH_PRODUCT_ID_INVALID');
    // CAS initialization/requeue only; no business field, timestamp or existing
    // revision may be overwritten, even if a stock writer wins between reads.
    for (let attempt = 0; attempt < 3; attempt++) {
      const doc = await this.productsCollection.findOne({ _id: id }, { timeoutMS: 5000 });
      if (!doc) throw new Error(ProductError.PRODUCT_NOT_FOUND);
      if (doc.searchRevision === undefined) {
        await this.productsCollection.updateOne({ _id: id, searchRevision: { $exists: false } },
          { $set: { searchRevision: 1, ...pendingSearchIntent() } }, { timeoutMS: 5000 });
        continue;
      }
      if (!Number.isSafeInteger(doc.searchRevision) || doc.searchRevision < 1) throw new Error('PRODUCT_SEARCH_REVISION_INVALID');
      if (doc.searchPending !== true) {
        await this.productsCollection.updateOne({ _id: id, searchRevision: doc.searchRevision, searchPending: doc.searchPending },
          { $set: pendingSearchIntent() }, { timeoutMS: 5000 });
        continue;
      }
      return { product: this.mapToProduct(doc), revision: doc.searchRevision,
        attempts: doc.searchAttempts ?? 0, retryAt: doc.searchRetryAt };
    }
    throw new Error('PRODUCT_SEARCH_CONFLICT');
  }

  async acknowledgeSearch(id: string, revision: number): Promise<boolean> {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('PRODUCT_SEARCH_REVISION_INVALID');
    const result = await this.productsCollection.updateOne({ _id: id, searchRevision: revision, searchPending: true },
      { $set: { searchPending: false } }, { timeoutMS: 5000 });
    return result.matchedCount === 1;
  }

  async retrySearch(id: string, revision: number, attempts: number, at: Date, expectedRetryAt?: Date): Promise<boolean> {
    if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(attempts) || attempts < 0
      || attempts > 30 || !Number.isFinite(at.getTime()) || (attempts === 30 && !expectedRetryAt)
      || (expectedRetryAt && !Number.isFinite(expectedRetryAt.getTime()))) throw new Error('PRODUCT_SEARCH_RETRY_INVALID');
    const result = await this.productsCollection.updateOne({ _id: id, searchRevision: revision, searchPending: true, searchAttempts: attempts,
      ...(expectedRetryAt ? { searchRetryAt: expectedRetryAt } : {}) },
      { $set: { searchAttempts: Math.min(attempts + 1, 30), searchRetryAt: at } }, { timeoutMS: 5000 });
    return result.matchedCount === 1;
  }

  private async rejectUnmatchedMutation(id: string, insufficientStockAllowed = false): Promise<void> {
    const doc = await this.productsCollection.findOne({ _id: id });
    if (!doc) throw new Error(ProductError.PRODUCT_NOT_FOUND);
    if (doc.searchRevision !== undefined && (!Number.isSafeInteger(doc.searchRevision)
      || doc.searchRevision < 0 || doc.searchRevision >= Number.MAX_SAFE_INTEGER)) {
      throw new Error('PRODUCT_SEARCH_REVISION_INVALID');
    }
    // A later concurrent mutation can make a diagnostic read valid again. Never
    // claim a successful update on this path; stock still reports failed reservation.
    if (!insufficientStockAllowed) throw new Error(ProductError.PRODUCT_CONFLICT);
  }

  private mapToProduct(doc: ProductDoc): Product {
    return Product.reconstruct({
      id: doc._id,
      seedIdentity: doc.seedIdentity,
      vendorId: doc.vendorId,
      categoryId: doc.categoryId,
      name: doc.name,
      description: doc.description,
      price: doc.price,
      quantity: doc.quantity,
      status: doc.status,
      images: doc.images,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      reservedBy: doc.reservedBy,
      reservedQuantity: doc.reservedQuantity
    });
  }
}
