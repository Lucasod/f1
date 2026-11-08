export enum ProductStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  OUT_OF_STOCK = 'out_of_stock',
  DISCONTINUED = 'discontinued'
}

export const VALID_STATUSES: ProductStatus[] = Object.values(ProductStatus);

export enum ProductError {
  // Product errors
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  PRODUCT_CONFLICT = 'PRODUCT_CONFLICT',
  PRODUCT_NAME_REQUIRED = 'PRODUCT_NAME_REQUIRED',
  PRODUCT_DESCRIPTION_REQUIRED = 'PRODUCT_DESCRIPTION_REQUIRED',
  PRODUCT_PRICE_INVALID = 'PRODUCT_PRICE_INVALID',
  PRODUCT_QUANTITY_INVALID = 'PRODUCT_QUANTITY_INVALID',
  PRODUCT_VENDOR_REQUIRED = 'PRODUCT_VENDOR_REQUIRED',
  PRODUCT_CATEGORY_REQUIRED = 'PRODUCT_CATEGORY_REQUIRED',
  PRODUCT_CATEGORY_NOT_FOUND = 'PRODUCT_CATEGORY_NOT_FOUND',
  PRODUCT_STATUS_INVALID = 'PRODUCT_STATUS_INVALID',
  PRODUCT_OWNERSHIP_VIOLATION = 'PRODUCT_OWNERSHIP_VIOLATION',
  PRODUCT_IMAGE_URL_REQUIRED = 'PRODUCT_IMAGE_URL_REQUIRED',
  PRODUCT_CANNOT_INACTIVATE_DISCONTINUED = 'PRODUCT_CANNOT_INACTIVATE_DISCONTINUED',
  PRODUCT_CANNOT_ACTIVATE_DISCONTINUED = 'PRODUCT_CANNOT_ACTIVATE_DISCONTINUED',
  
  // Category errors
  CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND',
  CATEGORY_NAME_REQUIRED = 'CATEGORY_NAME_REQUIRED',
  CATEGORY_SLUG_REQUIRED = 'CATEGORY_SLUG_REQUIRED',
  CATEGORY_SLUG_INVALID = 'CATEGORY_SLUG_INVALID',
  CATEGORY_SLUG_ALREADY_EXISTS = 'CATEGORY_SLUG_ALREADY_EXISTS',
  CATEGORY_CYCLE_DETECTED = 'CATEGORY_CYCLE_DETECTED',
  CATEGORY_PARENT_NOT_FOUND = 'CATEGORY_PARENT_NOT_FOUND',
  CATEGORY_CANNOT_SET_SELF_AS_PARENT = 'CATEGORY_CANNOT_SET_SELF_AS_PARENT',
  CATEGORY_HAS_CHILDREN = 'CATEGORY_HAS_CHILDREN',
  CATEGORY_HAS_PRODUCTS = 'CATEGORY_HAS_PRODUCTS',
}

export interface ProductData {
  id?: string;
  seedIdentity?: string;
  vendorId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  status?: ProductStatus;
  images?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CategoryData {
  id?: string;
  parentId: string | null;
  name: string;
  slug: string;
  path?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

function buildPath(parentPath: string | null, slug: string): string {
  if (!parentPath) {
    return `/${slug}/`;
  }
  return `${parentPath}${slug}/`;
}

export class Product {
  public id: string;
  public readonly seedIdentity?: string;
  public vendorId: string;
  public categoryId: string;
  public name: string;
  public description: string;
  public price: number;
  public quantity: number;
  public status: ProductStatus;
  public images: string[];
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: ProductData) {
    this.id = data.id || generateId();
    this.seedIdentity = data.seedIdentity;
    this.vendorId = data.vendorId;
    this.categoryId = data.categoryId;
    this.name = data.name;
    this.description = data.description;
    this.price = data.price;
    this.quantity = data.quantity;
    this.status = data.status || ProductStatus.ACTIVE;
    this.images = data.images || [];
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  static create(data: Omit<ProductData, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: ProductStatus }): Product {
    if (!data.name || data.name.trim().length === 0) {
      throw new Error(ProductError.PRODUCT_NAME_REQUIRED);
    }

    if (!data.description || data.description.trim().length === 0) {
      throw new Error(ProductError.PRODUCT_DESCRIPTION_REQUIRED);
    }

    if (!data.vendorId || data.vendorId.trim().length === 0) {
      throw new Error(ProductError.PRODUCT_VENDOR_REQUIRED);
    }

    if (!data.categoryId || data.categoryId.trim().length === 0) {
      throw new Error(ProductError.PRODUCT_CATEGORY_REQUIRED);
    }

    if (typeof data.price !== 'number' || data.price < 0) {
      throw new Error(ProductError.PRODUCT_PRICE_INVALID);
    }

    if (!Number.isInteger(data.quantity) || data.quantity < 0) {
      throw new Error(ProductError.PRODUCT_QUANTITY_INVALID);
    }

    if (data.status && !VALID_STATUSES.includes(data.status)) {
      throw new Error(ProductError.PRODUCT_STATUS_INVALID);
    }

    return new Product({
      ...data,
      status: data.status || ProductStatus.ACTIVE
    });
  }

  static reconstruct(data: ProductData): Product {
    return new Product(data);
  }

  inactivate(): void {
    if (this.status === ProductStatus.INACTIVE) {
      return;
    }
    if (this.status === ProductStatus.DISCONTINUED) {
      throw new Error(ProductError.PRODUCT_CANNOT_INACTIVATE_DISCONTINUED);
    }
    this.status = ProductStatus.INACTIVE;
    this.updatedAt = new Date();
  }

  activate(): void {
    if (this.status === ProductStatus.ACTIVE) {
      return;
    }
    if (this.status === ProductStatus.DISCONTINUED) {
      throw new Error(ProductError.PRODUCT_CANNOT_ACTIVATE_DISCONTINUED);
    }
    this.status = ProductStatus.ACTIVE;
    this.updatedAt = new Date();
  }

  updateStock(newQuantity: number): void {
    if (!Number.isInteger(newQuantity) || newQuantity < 0) {
      throw new Error(ProductError.PRODUCT_QUANTITY_INVALID);
    }
    this.quantity = newQuantity;
    if (newQuantity === 0 && this.status !== ProductStatus.DISCONTINUED && this.status !== ProductStatus.INACTIVE) {
      this.status = ProductStatus.OUT_OF_STOCK;
    } else if (newQuantity > 0 && this.status === ProductStatus.OUT_OF_STOCK) {
      this.status = ProductStatus.ACTIVE;
    }
    this.updatedAt = new Date();
  }

  updateDetails(data: { name?: string; description?: string; price?: number; categoryId?: string }): void {
    if (data.name !== undefined) {
      if (!data.name || data.name.trim().length === 0) {
        throw new Error(ProductError.PRODUCT_NAME_REQUIRED);
      }
      this.name = data.name;
    }

    if (data.description !== undefined) {
      if (!data.description || data.description.trim().length === 0) {
        throw new Error(ProductError.PRODUCT_DESCRIPTION_REQUIRED);
      }
      this.description = data.description;
    }

    if (data.price !== undefined) {
      if (typeof data.price !== 'number' || data.price < 0) {
        throw new Error(ProductError.PRODUCT_PRICE_INVALID);
      }
      this.price = data.price;
    }

    if (data.categoryId !== undefined) {
      if (!data.categoryId || data.categoryId.trim().length === 0) {
        throw new Error(ProductError.PRODUCT_CATEGORY_REQUIRED);
      }
      this.categoryId = data.categoryId;
    }

    this.updatedAt = new Date();
  }

  addImage(imageUrl: string): void {
    if (!imageUrl || imageUrl.trim().length === 0) {
      throw new Error(ProductError.PRODUCT_IMAGE_URL_REQUIRED);
    }
    this.images = [...this.images, imageUrl];
    this.updatedAt = new Date();
  }

  removeImage(imageUrl: string): void {
    this.images = this.images.filter(img => img !== imageUrl);
    this.updatedAt = new Date();
  }

  discontinue(): void {
    if (this.status === ProductStatus.DISCONTINUED) {
      return;
    }
    this.status = ProductStatus.DISCONTINUED;
    this.updatedAt = new Date();
  }

  get isAvailable(): boolean {
    return this.status === ProductStatus.ACTIVE && this.quantity > 0;
  }
}

export class Category {
  public id: string;
  public parentId: string | null;
  public name: string;
  public slug: string;
  public path: string;
  public readonly createdAt: Date;
  public updatedAt: Date;

  private constructor(data: CategoryData) {
    this.id = data.id || generateId();
    this.parentId = data.parentId;
    this.name = data.name;
    this.slug = data.slug;
    this.path = data.path || buildPath(null, data.slug);
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  static create(data: Omit<CategoryData, 'id' | 'createdAt' | 'updatedAt' | 'path'> & { parentId?: string | null; path?: string }): Category {
    if (!data.name || data.name.trim().length === 0) {
      throw new Error(ProductError.CATEGORY_NAME_REQUIRED);
    }

    if (!data.slug || data.slug.trim().length === 0) {
      throw new Error(ProductError.CATEGORY_SLUG_REQUIRED);
    }

    if (!validateSlug(data.slug)) {
      throw new Error(ProductError.CATEGORY_SLUG_INVALID);
    }

    const parentId = data.parentId || null;
    const path = data.path || buildPath(null, data.slug);

    return new Category({
      ...data,
      parentId,
      path
    });
  }

  static createWithParent(data: Omit<CategoryData, 'id' | 'createdAt' | 'updatedAt' | 'path'>, parentCategory: Category): Category {
    if (!data.name || data.name.trim().length === 0) {
      throw new Error(ProductError.CATEGORY_NAME_REQUIRED);
    }

    if (!data.slug || data.slug.trim().length === 0) {
      throw new Error(ProductError.CATEGORY_SLUG_REQUIRED);
    }

    if (!validateSlug(data.slug)) {
      throw new Error(ProductError.CATEGORY_SLUG_INVALID);
    }

    const path = buildPath(parentCategory.path, data.slug);

    return new Category({
      ...data,
      parentId: parentCategory.id,
      path
    });
  }

  static reconstruct(data: CategoryData): Category {
    return new Category(data);
  }

  updateName(newName: string): void {
    if (!newName || newName.trim().length === 0) {
      throw new Error(ProductError.CATEGORY_NAME_REQUIRED);
    }
    this.name = newName;
    this.updatedAt = new Date();
  }

  updateSlug(newSlug: string, parentPath: string | null = null): void {
    if (!newSlug || newSlug.trim().length === 0) {
      throw new Error(ProductError.CATEGORY_SLUG_REQUIRED);
    }
    if (!validateSlug(newSlug)) {
      throw new Error(ProductError.CATEGORY_SLUG_INVALID);
    }
    this.slug = newSlug;
    this.path = buildPath(parentPath, newSlug);
    this.updatedAt = new Date();
  }

  setParent(newParentId: string | null, allCategories: Category[]): void {
    if (newParentId === this.id) {
      throw new Error(ProductError.CATEGORY_CANNOT_SET_SELF_AS_PARENT);
    }

    if (newParentId !== null) {
      const parentCategory = allCategories.find(c => c.id === newParentId);
      if (!parentCategory) {
        throw new Error(ProductError.CATEGORY_PARENT_NOT_FOUND);
      }

      if (this.wouldCreateCycle(newParentId, allCategories)) {
        throw new Error(ProductError.CATEGORY_CYCLE_DETECTED);
      }

      this.parentId = newParentId;
      this.path = buildPath(parentCategory.path, this.slug);
    } else {
      this.parentId = null;
      this.path = buildPath(null, this.slug);
    }

    this.updatedAt = new Date();
  }

  private wouldCreateCycle(newParentId: string, allCategories: Category[]): boolean {
    let currentId: string | null = newParentId;
    const visited = new Set<string>();

    while (currentId !== null) {
      if (currentId === this.id) {
        return true;
      }
      if (visited.has(currentId)) {
        return true;
      }
      visited.add(currentId);

      const currentCategory = allCategories.find(c => c.id === currentId);
      if (!currentCategory) {
        break;
      }
      currentId = currentCategory.parentId;
    }

    return false;
  }

  get isRoot(): boolean {
    return this.parentId === null;
  }

  get depth(): number {
    if (this.isRoot) {
      return 0;
    }
    // Path format: /segment1/segment2/.../segmentN/
    // Depth = number of segments - 1 (root is depth 0)
    const segments = this.path.split('/').filter(s => s.length > 0);
    return segments.length - 1;
  }
}

export interface ProductRepository {
  assertSeedIdentityReady(): Promise<void>;
  save(product: Product): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  findByVendorId(vendorId: string): Promise<Product[]>;
  findByCategoryId(categoryId: string): Promise<Product[]>;
  findAll(filters?: { status?: string; vendorId?: string; search?: string; sortBy?: string }): Promise<Product[]>;
  update(product: Product): Promise<Product>;
  delete(id: string): Promise<void>;
  decrementStock(productId: string, amount: number): Promise<boolean>;
  incrementStock(productId: string, amount: number): Promise<void>;
}

export class InMemoryProductRepository implements ProductRepository {
  private products: Map<string, Product> = new Map();
  private vendorIndex: Map<string, Set<string>> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();

  async assertSeedIdentityReady(): Promise<void> {}

  async save(product: Product): Promise<Product> {
    if (this.products.has(product.id) || (product.seedIdentity && Array.from(this.products.values()).some(existing => existing.seedIdentity === product.seedIdentity))) {
      throw new Error(ProductError.PRODUCT_CONFLICT);
    }
    this.products.set(product.id, product);

    const vendorProducts = this.vendorIndex.get(product.vendorId) || new Set();
    vendorProducts.add(product.id);
    this.vendorIndex.set(product.vendorId, vendorProducts);

    const categoryProducts = this.categoryIndex.get(product.categoryId) || new Set();
    categoryProducts.add(product.id);
    this.categoryIndex.set(product.categoryId, categoryProducts);

    return product;
  }

  async findById(id: string): Promise<Product | null> {
    return this.products.get(id) || null;
  }

  async findByVendorId(vendorId: string): Promise<Product[]> {
    const productIds = this.vendorIndex.get(vendorId) || new Set();
    const products: Product[] = [];
    for (const id of productIds) {
      const product = this.products.get(id);
      if (product) products.push(product);
    }
    return products;
  }

  async findByCategoryId(categoryId: string): Promise<Product[]> {
    const productIds = this.categoryIndex.get(categoryId) || new Set();
    const products: Product[] = [];
    for (const id of productIds) {
      const product = this.products.get(id);
      if (product) products.push(product);
    }
    return products;
  }

  async findAll(filters?: { status?: string; vendorId?: string; search?: string; sortBy?: string }): Promise<Product[]> {
    let products = Array.from(this.products.values());

    if (filters?.status) {
      products = products.filter(p => p.status === filters.status);
    }

    if (filters?.vendorId) {
      products = products.filter(p => p.vendorId === filters.vendorId);
    }

    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      products = products.filter(p => 
        p.name.toLowerCase().includes(searchLower) ||
        p.description.toLowerCase().includes(searchLower)
      );
    }

    switch (filters?.sortBy ?? 'stock_status') {
        case 'name':
          products.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case 'price_asc':
          products.sort((a, b) => a.price - b.price);
          break;
        case 'price_desc':
          products.sort((a, b) => b.price - a.price);
          break;
        case 'newest':
          products.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'stock_status':
          products.sort((a, b) => {
            // In-stock first, then by quantity descending
            if (a.quantity > 0 && b.quantity === 0) return -1;
            if (a.quantity === 0 && b.quantity > 0) return 1;
            return b.quantity - a.quantity;
          });
          break;
    }

    return products;
  }

  async update(product: Product): Promise<Product> {
    const existing = this.products.get(product.id);
    if (!existing) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }

    // Handle vendorId change
    if (existing.vendorId !== product.vendorId) {
      const oldVendorProducts = this.vendorIndex.get(existing.vendorId);
      if (oldVendorProducts) {
        oldVendorProducts.delete(product.id);
      }

      const newVendorProducts = this.vendorIndex.get(product.vendorId) || new Set();
      newVendorProducts.add(product.id);
      this.vendorIndex.set(product.vendorId, newVendorProducts);
    }

    // Handle categoryId change
    if (existing.categoryId !== product.categoryId) {
      const oldCategoryProducts = this.categoryIndex.get(existing.categoryId);
      if (oldCategoryProducts) {
        oldCategoryProducts.delete(product.id);
      }

      const newCategoryProducts = this.categoryIndex.get(product.categoryId) || new Set();
      newCategoryProducts.add(product.id);
      this.categoryIndex.set(product.categoryId, newCategoryProducts);
    }

    this.products.set(product.id, product);
    return product;
  }

  async delete(id: string): Promise<void> {
    const product = this.products.get(id);
    if (product) {
      const vendorProducts = this.vendorIndex.get(product.vendorId);
      if (vendorProducts) {
        vendorProducts.delete(id);
      }

      const categoryProducts = this.categoryIndex.get(product.categoryId);
      if (categoryProducts) {
        categoryProducts.delete(id);
      }

      this.products.delete(id);
    }
  }

  async decrementStock(productId: string, amount: number): Promise<boolean> {
    const product = this.products.get(productId);
    if (!product) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }
    if (product.quantity < amount) {
      return false;
    }
    product.updateStock(product.quantity - amount);
    return true;
  }

  async incrementStock(productId: string, amount: number): Promise<void> {
    const product = this.products.get(productId);
    if (!product) {
      throw new Error(ProductError.PRODUCT_NOT_FOUND);
    }
    product.updateStock(product.quantity + amount);
  }

  clear(): void {
    this.products.clear();
    this.vendorIndex.clear();
    this.categoryIndex.clear();
  }
}

export interface CategoryRepository {
  save(category: Category): Promise<Category>;
  findById(id: string): Promise<Category | null>;
  findBySlug(slug: string): Promise<Category | null>;
  findByParentId(parentId: string | null): Promise<Category[]>;
  findAll(): Promise<Category[]>;
  update(category: Category): Promise<Category>;
  delete(id: string): Promise<void>;
}

export class InMemoryCategoryRepository implements CategoryRepository {
  private categories: Map<string, Category> = new Map();
  private slugIndex: Map<string, string> = new Map();
  private parentIndex: Map<string, Set<string>> = new Map();

  async save(category: Category): Promise<Category> {
    const existingSlugId = this.slugIndex.get(category.slug.toLowerCase());
    if (existingSlugId && existingSlugId !== category.id) {
      throw new Error('SLUG_ALREADY_EXISTS');
    }
    this.slugIndex.set(category.slug.toLowerCase(), category.id);

    const parentKey = category.parentId || 'root';
    const children = this.parentIndex.get(parentKey) || new Set();
    children.add(category.id);
    this.parentIndex.set(parentKey, children);

    this.categories.set(category.id, category);
    return category;
  }

  async findById(id: string): Promise<Category | null> {
    return this.categories.get(id) || null;
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const categoryId = this.slugIndex.get(slug.toLowerCase());
    if (!categoryId) return null;
    return this.categories.get(categoryId) || null;
  }

  async findByParentId(parentId: string | null): Promise<Category[]> {
    const parentKey = parentId || 'root';
    const categoryIds = this.parentIndex.get(parentKey) || new Set();
    const categories: Category[] = [];
    for (const id of categoryIds) {
      const category = this.categories.get(id);
      if (category) categories.push(category);
    }
    return categories;
  }

  async findAll(): Promise<Category[]> {
    return Array.from(this.categories.values());
  }

  async update(category: Category): Promise<Category> {
    const existing = this.categories.get(category.id);
    if (existing) {
      if (existing.slug !== category.slug) {
        this.slugIndex.delete(existing.slug.toLowerCase());
        const existingSlugId = this.slugIndex.get(category.slug.toLowerCase());
        if (existingSlugId && existingSlugId !== category.id) {
          throw new Error('SLUG_ALREADY_EXISTS');
        }
        this.slugIndex.set(category.slug.toLowerCase(), category.id);
      }

      if (existing.parentId !== category.parentId) {
        const oldParentKey = existing.parentId || 'root';
        const oldChildren = this.parentIndex.get(oldParentKey);
        if (oldChildren) {
          oldChildren.delete(category.id);
        }

        const newParentKey = category.parentId || 'root';
        const newChildren = this.parentIndex.get(newParentKey) || new Set();
        newChildren.add(category.id);
        this.parentIndex.set(newParentKey, newChildren);
      }
    }

    this.categories.set(category.id, category);
    return category;
  }

  async delete(id: string): Promise<void> {
    const category = this.categories.get(id);
    if (category) {
      this.slugIndex.delete(category.slug.toLowerCase());

      const parentKey = category.parentId || 'root';
      const children = this.parentIndex.get(parentKey);
      if (children) {
        children.delete(id);
      }

      this.categories.delete(id);
    }
  }

  clear(): void {
    this.categories.clear();
    this.slugIndex.clear();
    this.parentIndex.clear();
  }
}
