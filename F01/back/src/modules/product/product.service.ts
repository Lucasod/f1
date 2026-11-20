import {
  Product,
  Category,
  ProductStatus,
  ProductRepository,
  CategoryRepository,
  InMemoryProductRepository,
  InMemoryCategoryRepository,
  ProductError,
  VALID_STATUSES
} from './product.domain';
import { VendorRepository } from '../vendor/vendor.domain';
import { config } from '../../config';
import { ElasticsearchProductIndex, resolveProductSource } from '../search/elasticsearch-product-index';

export interface CreateProductInput {
  vendorId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  images?: string[];
  status?: ProductStatus;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  price?: number;
  quantity?: number;
  categoryId?: string;
  images?: string[];
  status?: ProductStatus;
}

export interface CreateCategoryInput {
  name: string;
  slug: string;
  parentId?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  parentId?: string | null;
}


export interface ProductSearchRebuildResult {
  total: number;
  indexed: number;
  failed: number;
  successCount: number;
  failureCount: number;
  succeeded: number;
  failures: number;
  reindexed: number;
  success: number;
  errorCount: number;
  indexedCount: number;
  failedCount: number;
  count: number;
}

export class ProductService {
  private readonly productRepo: ProductRepository;
  private readonly categoryRepo: CategoryRepository;
  private readonly vendorRepo: VendorRepository;

  private readonly searchIndex?: ElasticsearchProductIndex;

  constructor(
    productRepo: ProductRepository,
    categoryRepo: CategoryRepository,
    vendorRepo: VendorRepository,
    _config: typeof config,
    searchIndex?: ElasticsearchProductIndex
  ) {
    this.productRepo = productRepo;
    this.categoryRepo = categoryRepo;
    this.vendorRepo = vendorRepo;
    this.searchIndex = searchIndex;
  }

  // ============ Product Methods ============

  async createProduct(vendorId: string, input: CreateProductInput): Promise<Product> {
    // Verify vendor exists
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new Error(ProductError.PRODUCT_VENDOR_REQUIRED);
    }

    // Verify category exists
    const category = await this.categoryRepo.findById(input.categoryId);
    if (!category) {
      throw new Error(ProductError.PRODUCT_CATEGORY_NOT_FOUND);
    }

    // Create product
    const product = Product.create({
      vendorId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      price: input.price,
      quantity: input.quantity,
      status: input.status,
      images: input.images
    });

    const saved = await this.productRepo.save(product);
    if (this.searchIndex) {
      try {
        await this.searchIndex.indexProduct(saved);
      } catch (error) {
        console.warn('Elasticsearch product indexing failed');
      }
    }
    return saved;
  }

  async getProductById(id: string): Promise<Product | null> {
    return this.productRepo.findById(id);
  }

  async getProductsByVendor(vendorId: string): Promise<Product[]> {
    return this.productRepo.findByVendorId(vendorId);
  }

  async getProductsByCategory(categoryId: string): Promise<Product[]> {
    // Verify category exists
    const category = await this.categoryRepo.findById(categoryId);
    if (!category) {
      throw new Error(ProductError.CATEGORY_NOT_FOUND);
    }
    return this.productRepo.findByCategoryId(categoryId);
  }

  async listProducts(filters?: { status?: string; vendorId?: string; search?: string; sortBy?: string }): Promise<Product[]> {
    if (this.searchIndex && filters?.search) {
      try {
        return await this.searchIndex.search({
          status: filters.status,
          vendorId: filters.vendorId,
          search: filters.search,
          sortBy: filters.sortBy,
        });
      } catch (error) {
        console.warn('Elasticsearch product search failed; falling back to MongoDB');
      }
    }
    return this.productRepo.findAll(filters);
  }

  async updateProduct(
    productId: string,
    vendorId: string,
    input: UpdateProductInput,
    isAdmin: boolean
  ): Promise<Product> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }

    // Ownership check (CD-059): Vendor can only manage their own products; Admin can manage all
    if (!isAdmin && product.vendorId !== vendorId) {
      throw new Error(ProductError.PRODUCT_OWNERSHIP_VIOLATION);
    }

    // Validate category if being updated
    if (input.categoryId !== undefined) {
      const category = await this.categoryRepo.findById(input.categoryId);
      if (!category) {
        throw new Error(ProductError.PRODUCT_CATEGORY_NOT_FOUND);
      }
    }

    // Validate status if being updated
    if (input.status !== undefined && !Object.values(ProductStatus).includes(input.status)) {
      throw new Error(ProductError.PRODUCT_STATUS_INVALID);
    }

    // Update product details
    product.updateDetails({
      name: input.name,
      description: input.description,
      price: input.price,
      categoryId: input.categoryId
    });

    // Update images if provided
    if (input.images !== undefined) {
      // Clear existing images and add new ones
      (product as any).images = input.images || [];
      (product as any).updatedAt = new Date();
    }

    // Update status if provided
    if (input.status !== undefined) {
      switch (input.status) {
        case ProductStatus.ACTIVE:
          product.activate();
          break;
        case ProductStatus.INACTIVE:
          product.inactivate();
          break;
        case ProductStatus.DISCONTINUED:
          product.discontinue();
          break;
        case ProductStatus.OUT_OF_STOCK:
          // OUT_OF_STOCK is managed automatically via stock updates
          if (product.quantity > 0) {
            product.activate();
          } else {
            product.updateStock(0);
          }
          break;
      }
    }

    const updated = await this.productRepo.update(product);
    if (this.searchIndex) {
      try {
        await this.searchIndex.indexProduct(updated);
      } catch (error) {
        console.warn('Elasticsearch product indexing failed');
      }
    }
    return updated;
  }

  async deleteProduct(productId: string, vendorId: string, isAdmin: boolean): Promise<void> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }

    // Ownership check (CD-059)
    if (!isAdmin && product.vendorId !== vendorId) {
      throw new Error(ProductError.PRODUCT_OWNERSHIP_VIOLATION);
    }

    // CR003: soft delete — inactivate product and sync ES instead of hard delete,
    // so no stale document remains in Elasticsearch (ES delete unavailable).
    product.inactivate();
    const updated = await this.productRepo.update(product);
    if (this.searchIndex) {
      try {
        await this.searchIndex.indexProduct(updated);
      } catch (error) {
        console.warn('Elasticsearch product indexing failed');
      }
    }
  }

  async inactivateProduct(productId: string, vendorId: string, isAdmin: boolean): Promise<Product> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }

    // Ownership check (CD-059)
    if (!isAdmin && product.vendorId !== vendorId) {
      throw new Error(ProductError.PRODUCT_OWNERSHIP_VIOLATION);
    }

    product.inactivate();
    const updatedStock = await this.productRepo.update(product);
    if (this.searchIndex) {
      try {
        await this.searchIndex.indexProduct(updatedStock);
      } catch (error) {
        console.warn('Elasticsearch product indexing failed');
      }
    }
    return updatedStock;
  }

  async activateProduct(productId: string, vendorId: string, isAdmin: boolean): Promise<Product> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }

    // Ownership check (CD-059)
    if (!isAdmin && product.vendorId !== vendorId) {
      throw new Error(ProductError.PRODUCT_OWNERSHIP_VIOLATION);
    }

    product.activate();
    const updatedStock = await this.productRepo.update(product);
    if (this.searchIndex) {
      try {
        await this.searchIndex.indexProduct(updatedStock);
      } catch (error) {
        console.warn('Elasticsearch product indexing failed');
      }
    }
    return updatedStock;
  }

  async updateProductStock(
    productId: string,
    vendorId: string,
    quantity: number,
    isAdmin: boolean
  ): Promise<Product> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }

    // Ownership check (CD-059)
    if (!isAdmin && product.vendorId !== vendorId) {
      throw new Error(ProductError.PRODUCT_OWNERSHIP_VIOLATION);
    }

    // Validate quantity
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error(ProductError.PRODUCT_QUANTITY_INVALID);
    }

    product.updateStock(quantity);
    const updatedStock = await this.productRepo.update(product);
    if (this.searchIndex) {
      try {
        await this.searchIndex.indexProduct(updatedStock);
      } catch (error) {
        console.warn('Elasticsearch product indexing failed');
      }
    }
    return updatedStock;
  }

  // ============ Search Rebuild (CR006) ============

  async rebuildFromMongo(source?: unknown): Promise<ProductSearchRebuildResult> {
    return this.rebuildSearchIndexFromMongo(source);
  }

  async rebuildFromMongoDB(source?: unknown): Promise<ProductSearchRebuildResult> {
    return this.rebuildSearchIndexFromMongo(source);
  }

  async reindexFromMongo(source?: unknown): Promise<ProductSearchRebuildResult> {
    return this.rebuildSearchIndexFromMongo(source);
  }

  async reindexAll(source?: unknown): Promise<ProductSearchRebuildResult> {
    return this.rebuildSearchIndexFromMongo(source);
  }

  async rebuildIndex(source?: unknown): Promise<ProductSearchRebuildResult> {
    return this.rebuildSearchIndexFromMongo(source);
  }

  async rebuildSearchIndex(source?: unknown): Promise<ProductSearchRebuildResult> {
    return this.rebuildSearchIndexFromMongo(source);
  }

  private async rebuildSearchIndexFromMongo(source?: unknown): Promise<ProductSearchRebuildResult> {
    const resolved = await this.resolveRebuildSource(source);
    const products = resolved.products;
    const searchIndex = resolved.searchIndex ?? this.searchIndex;

    let indexed = 0;
    let failed = 0;
    for (const product of products) {
      if (!searchIndex || typeof searchIndex.indexProduct !== 'function') {
        failed += 1;
        continue;
      }
      try {
        await searchIndex.indexProduct(product);
        indexed += 1;
      } catch (error) {
        failed += 1;
        console.warn('Elasticsearch product indexing failed');
      }
    }

    return {
      total: products.length,
      indexed,
      failed,
      successCount: indexed,
      failureCount: failed,
      succeeded: indexed,
      failures: failed,
      reindexed: indexed,
      success: indexed,
      errorCount: failed,
      indexedCount: indexed,
      failedCount: failed,
      count: products.length,
    };
  }

  private async resolveRebuildSource(source?: unknown): Promise<{ products: any[]; searchIndex?: any }> {
    if (source === undefined || source === null) {
      return { products: await this.productRepo.findAll(), searchIndex: this.searchIndex };
    }
    const object = source as any;
    const publisher = typeof object?.indexProduct === 'function' ? object : undefined;
    if (publisher && this.searchIndex?.durable && publisher !== this.searchIndex) {
      throw new Error('PRODUCT_SEARCH_SOURCE_PUBLISHER_UNSUPPORTED');
    }
    // Legacy combined publisher+source and publisher-only overloads remain
    // supported outside durable runtime. They cannot bypass its versioned port.
    const publisherOnly = publisher && !Array.isArray(object.products) && typeof object.findAll !== 'function' && typeof object.then !== 'function';
    const products = publisherOnly ? await this.productRepo.findAll() : await resolveProductSource(source);
    return { products, searchIndex: publisher ?? this.searchIndex };
  }

  // ============ Category Methods ============

  async createCategory(input: CreateCategoryInput): Promise<Category> {
    // Verify parent category exists if provided
    if (input.parentId) {
      const parentCategory = await this.categoryRepo.findById(input.parentId);
      if (!parentCategory) {
        throw new Error(ProductError.CATEGORY_PARENT_NOT_FOUND);
      }
      try {
        return await this.categoryRepo.save(Category.createWithParent(
          { name: input.name, slug: input.slug, parentId: input.parentId },
          parentCategory
        ));
      } catch (error) {
        if (error instanceof Error && error.message === 'SLUG_ALREADY_EXISTS') {
          throw new Error(ProductError.CATEGORY_SLUG_ALREADY_EXISTS);
        }
        throw error;
      }
    }

    try {
      return await this.categoryRepo.save(Category.create({
        name: input.name,
        slug: input.slug,
        parentId: null
      }));
    } catch (error) {
      if (error instanceof Error && error.message === 'SLUG_ALREADY_EXISTS') {
        throw new Error(ProductError.CATEGORY_SLUG_ALREADY_EXISTS);
      }
      throw error;
    }
  }

  async getCategoryById(id: string): Promise<Category | null> {
    return this.categoryRepo.findById(id);
  }

  async getCategoryBySlug(slug: string): Promise<Category | null> {
    return this.categoryRepo.findBySlug(slug);
  }

  async getChildCategories(parentId: string | null): Promise<Category[]> {
    return this.categoryRepo.findByParentId(parentId);
  }

  async listCategories(): Promise<Category[]> {
    return this.categoryRepo.findAll();
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
    const category = await this.categoryRepo.findById(id);
    if (!category) {
      throw new Error(ProductError.CATEGORY_NOT_FOUND);
    }

    // Check if new slug already exists (if being updated)
    if (input.slug !== undefined && input.slug !== category.slug) {
      const existingCategory = await this.categoryRepo.findBySlug(input.slug);
      if (existingCategory && existingCategory.id !== id) {
        throw new Error(ProductError.CATEGORY_SLUG_ALREADY_EXISTS);
      }
    }

    // Verify parent category exists if being updated
    if (input.parentId !== undefined) {
      if (input.parentId === id) {
        throw new Error(ProductError.CATEGORY_CYCLE_DETECTED);
      }
      if (input.parentId) {
        const parentCategory = await this.categoryRepo.findById(input.parentId);
        if (!parentCategory) {
          throw new Error(ProductError.CATEGORY_PARENT_NOT_FOUND);
        }
      }
    }

    // Update category
    if (input.name !== undefined) {
      category.updateName(input.name);
    }
    if (input.slug !== undefined) {
      category.updateSlug(input.slug);
    }
    if (input.parentId !== undefined) {
      const allCategories = await this.categoryRepo.findAll();
      category.setParent(input.parentId, allCategories);
    }

    return this.categoryRepo.update(category);
  }

  async deleteCategory(id: string): Promise<void> {
    const category = await this.categoryRepo.findById(id);
    if (!category) {
      throw new Error(ProductError.CATEGORY_NOT_FOUND);
    }

    // Check if category has children
    const children = await this.categoryRepo.findByParentId(id);
    if (children.length > 0) {
      throw new Error(ProductError.CATEGORY_HAS_CHILDREN);
    }

    // Check if category has products
    const products = await this.productRepo.findByCategoryId(id);
    if (products.length > 0) {
      throw new Error(ProductError.CATEGORY_HAS_PRODUCTS);
    }

    await this.categoryRepo.delete(id);
  }
}
