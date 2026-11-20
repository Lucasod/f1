import { Db, Collection } from 'mongodb';
import { Category, CategoryRepository, ProductError } from './product.domain';

interface CategoryDoc {
  _id: string;
  parentId: string | null;
  name: string;
  slug: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export class MongoCategoryRepository implements CategoryRepository {
  private categoriesCollection: Collection<CategoryDoc>;

  constructor(db: Db) {
    this.categoriesCollection = db.collection<CategoryDoc>('categories');
  }

  async save(category: Category): Promise<Category> {
    const categoryId = category.id;

    // Check for duplicate slug before saving (case-insensitive)
    const existingSlug = await this.categoriesCollection.findOne({
      slug: { $regex: new RegExp(`^${category.slug}$`, 'i') },
      _id: { $ne: categoryId }
    });
    if (existingSlug) {
      throw new Error(ProductError.CATEGORY_SLUG_ALREADY_EXISTS);
    }

    const now = new Date();

    await this.categoriesCollection.updateOne(
      { _id: categoryId },
      {
        $set: {
          parentId: category.parentId,
          name: category.name,
          slug: category.slug,
          path: category.path,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: category.createdAt
        }
      },
      { upsert: true }
    );

    return Category.reconstruct({
      ...category,
      updatedAt: now
    } as any);
  }

  async findById(id: string): Promise<Category | null> {
    const categoryDoc = await this.categoriesCollection.findOne({ _id: id });

    if (!categoryDoc) {
      return null;
    }

    return this.mapToCategory(categoryDoc);
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const categoryDoc = await this.categoriesCollection.findOne({
      slug: { $regex: new RegExp(`^${slug}$`, 'i') }
    });

    if (!categoryDoc) {
      return null;
    }

    return this.mapToCategory(categoryDoc);
  }

  async findByParentId(parentId: string | null): Promise<Category[]> {
    const categories = await this.categoriesCollection
      .find({ parentId })
      .toArray();

    return categories.map(doc => this.mapToCategory(doc));
  }

  async findAll(): Promise<Category[]> {
    const categories = await this.categoriesCollection.find().toArray();
    return categories.map(doc => this.mapToCategory(doc));
  }

  async update(category: Category): Promise<Category> {
    const categoryId = category.id;

    // Check for duplicate slug (excluding self) - case-insensitive
    const existingSlug = await this.categoriesCollection.findOne({
      slug: { $regex: new RegExp(`^${category.slug}$`, 'i') },
      _id: { $ne: categoryId }
    });
    if (existingSlug) {
      throw new Error(ProductError.CATEGORY_SLUG_ALREADY_EXISTS);
    }

    const now = new Date();

    await this.categoriesCollection.updateOne(
      { _id: categoryId },
      {
        $set: {
          parentId: category.parentId,
          name: category.name,
          slug: category.slug,
          path: category.path,
          updatedAt: now
        }
      }
    );

    return Category.reconstruct({
      ...category,
      updatedAt: now
    } as any);
  }

  async delete(id: string): Promise<void> {
    await this.categoriesCollection.deleteOne({ _id: id });
  }

  private mapToCategory(doc: CategoryDoc): Category {
    return Category.reconstruct({
      id: doc._id,
      parentId: doc.parentId,
      name: doc.name,
      slug: doc.slug,
      path: doc.path,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  }
}