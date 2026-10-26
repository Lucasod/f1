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

export class ProductService {
  private readonly productRepo: ProductRepository;
  private readonly categoryRepo: CategoryRepository;
  private readonly vendorRepo: VendorRepository;

  constructor(
    productRepo: ProductRepository,
    categoryRepo: CategoryRepository,
    vendorRepo: VendorRepository,
    _config: typeof config
  ) {
    this.productRepo = productRepo;
    this.categoryRepo = categoryRepo;
    this.vendorRepo = vendorRepo;
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

    return this.productRepo.save(product);
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

  async listProducts(filters?: { status?: string; vendorId?: string }): Promise<Product[]> {
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

    return this.productRepo.update(product);
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

    // MVP: Allow hard delete with warning per CD-042 (no order references check yet)
    // In production, should check for order references before allowing hard delete
    await this.productRepo.delete(productId);
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
    return this.productRepo.update(product);
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
    return this.productRepo.update(product);
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
    return this.productRepo.update(product);
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