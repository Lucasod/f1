import { Db, Collection } from 'mongodb';
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
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export class MongoProductRepository implements ProductRepository {
  private productsCollection: Collection<ProductDoc>;

  constructor(db: Db) {
    this.productsCollection = db.collection<ProductDoc>('products');
  }

  async save(product: Product): Promise<Product> {
    const productId = product.id;
    const now = new Date();

    if (product.seedIdentity) {
      let indexes;
      try {
        indexes = await this.productsCollection.listIndexes().toArray();
      } catch {
        throw new Error('PRODUCT_SEED_INDEX_UNAVAILABLE');
      }
      const safeIndex = indexes.some(index => {
        const key = index.key;
        const partial = index.partialFilterExpression;
        return index.unique === true && !!key && Object.keys(key).length === 1 && key.seedIdentity === 1
          && !!partial && Object.keys(partial).length === 1
          && !!partial.seedIdentity && Object.keys(partial.seedIdentity).length === 1
          && partial.seedIdentity.$type === 'string'
          && (!index.collation || index.collation.locale === 'simple');
      });
      if (!safeIndex) throw new Error('PRODUCT_SEED_INDEX_UNAVAILABLE');
    }

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
      const searchRegex = new RegExp(filters.search, 'i');
      query.$or = [
        { name: searchRegex },
        { description: searchRegex }
      ];
    }

    const cursor = this.productsCollection.find(query);
    const products = await cursor.toArray();
    let mappedProducts = products.map(doc => this.mapToProduct(doc));

    if (filters?.sortBy) {
      switch (filters.sortBy) {
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
    }

    return mappedProducts;
  }

  async update(product: Product): Promise<Product> {
    const productId = product.id;
    const now = new Date();

    await this.productsCollection.updateOne(
      { _id: productId },
      {
        $set: {
          vendorId: product.vendorId,
          categoryId: product.categoryId,
          name: product.name,
          description: product.description,
          price: product.price,
          quantity: product.quantity,
          status: product.status,
          images: product.images,
          updatedAt: now
        }
      }
    );

    return Product.reconstruct({
      ...product,
      updatedAt: now
    } as any);
  }

  async delete(id: string): Promise<void> {
    await this.productsCollection.deleteOne({ _id: id });
  }

  async decrementStock(productId: string, amount: number): Promise<boolean> {
    const result = await this.productsCollection.updateOne(
      { _id: productId, quantity: { $gte: amount } },
      { $inc: { quantity: -amount }, $set: { updatedAt: new Date() } }
    );
    if (result.modifiedCount > 0) {
      return true;
    }
    const exists = await this.productsCollection.findOne({ _id: productId }, { projection: { _id: 1 } });
    if (!exists) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }
    return false;
  }

  async incrementStock(productId: string, amount: number): Promise<void> {
    const result = await this.productsCollection.updateOne(
      { _id: productId },
      { $inc: { quantity: amount }, $set: { updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }
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
      updatedAt: doc.updatedAt
    });
  }
}
