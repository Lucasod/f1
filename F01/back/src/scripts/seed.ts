import { config } from '../config/index.js';
import { Person, PersonRole, PersonRepository, ContactInfo, Address, MainInfo } from '../modules/person/person.domain.js';
import { Vendor, VendorStatus, VendorRepository } from '../modules/vendor/vendor.domain.js';
import { Product, Category, ProductStatus, ProductRepository, CategoryRepository } from '../modules/product/product.domain.js';
import { hashPassword } from '../modules/auth/credential.domain.js';
import { SeedRepositories } from '../shared/seed.types.js';
export type { SeedRepositories };

function validateSeedEnvironment(): void {
  if (config.isProduction && process.env.SEED_FORCE !== 'true') {
    throw new Error('Seed script requires SEED_FORCE=true to run in production environment');
  }
}

let seedCounter = 0;
const SEED_BASE = 1_000_000_000_000;

/**
 * Generates a deterministic hash-based ID for seed data idempotency.
 * Uses a counter-based approach (not timestamp-based) to ensure reproducible IDs
 * across seed runs while maintaining uniqueness within a single run.
 *
 * NOTE: Deterministic IDs are used intentionally for seed idempotency.
 * This allows re-running the seed script safely without creating duplicate data.
 * Domain entities normally generate their own IDs, but seed operations require
 * predictable IDs to maintain referential integrity across related entities.
 */
function generateDeterministicHashId(prefix: string = 'seed'): string {
  seedCounter += 1;
  const hashPart = SEED_BASE + seedCounter;
  const paddedCounter = String(seedCounter).padStart(6, '0');
  return `${prefix}-${hashPart}-${paddedCounter}`;
}

/**
 * Generates a deterministic ID based on a slug/string.
 * This ensures the same slug always produces the same ID, enabling seed idempotency.
 */
function generateDeterministicSlugId(prefix: string, slug: string): string {
  // Simple deterministic hash from slug
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash) + slug.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  const positiveHash = Math.abs(hash);
  return `${prefix}-${positiveHash.toString(36).padStart(8, '0')}`;
}

function resetDeterministicIdGenerator(): void {
  seedCounter = 0;
}

// ============================================================================
// DATA DEFINITIONS
// ============================================================================

interface CategorySeedData {
  id: string;
  name: string;
  slug: string;
  parentSlug: string | null;
}

interface VendorSeedData {
  id: string;
  personId: string;
  cnpj: string;
  email: string;
  name: string;
  storeName: string;
  slug: string;
  password: string;
}

interface ProductSeedData {
  id: string;
  vendorSlug: string;
  categorySlug: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  images: string[];
}

const CATEGORIES: CategorySeedData[] = [
  { id: generateDeterministicHashId('cat'), name: 'Electronics', slug: 'electronics', parentSlug: null },
  { id: generateDeterministicHashId('cat'), name: 'Smartphones', slug: 'smartphones', parentSlug: 'electronics' },
  { id: generateDeterministicHashId('cat'), name: 'Laptops', slug: 'laptops', parentSlug: 'electronics' },
  { id: generateDeterministicHashId('cat'), name: 'Clothing', slug: 'clothing', parentSlug: null },
  { id: generateDeterministicHashId('cat'), name: 'Home & Garden', slug: 'home-garden', parentSlug: null },
  { id: generateDeterministicHashId('cat'), name: 'Books', slug: 'books', parentSlug: null },
];

const VENDORS: VendorSeedData[] = [
  {
    id: generateDeterministicSlugId('vendor', 'tech-store'),
    personId: generateDeterministicHashId('person'),
    cnpj: '11222333000181',
    email: 'techstore@example.com',
    name: 'Tech Store',
    storeName: 'Tech Store',
    slug: 'tech-store',
    password: 'SecurePass123!',
  },
  {
    id: generateDeterministicSlugId('vendor', 'fashion-hub'),
    personId: generateDeterministicHashId('person'),
    cnpj: '04252011000110',
    email: 'fashionhub@example.com',
    name: 'Fashion Hub',
    storeName: 'Fashion Hub',
    slug: 'fashion-hub',
    password: 'SecurePass123!',
  },
  {
    id: generateDeterministicSlugId('vendor', 'book-world'),
    personId: generateDeterministicHashId('person'),
    cnpj: '12345678000195',
    email: 'bookworld@example.com',
    name: 'Book World',
    storeName: 'Book World',
    slug: 'book-world',
    password: 'SecurePass123!',
  },
];

const PRODUCTS: ProductSeedData[] = [
  // Tech Store products
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'smartphones',
    name: 'iPhone 15 Pro',
    description: 'Latest iPhone with A17 Pro chip, titanium design, and advanced camera system.',
    price: 9999.00,
    quantity: 50,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'laptops',
    name: 'MacBook Pro 16',
    description: 'Powerful laptop with M3 Max chip, 16-inch Liquid Retina XDR display.',
    price: 24999.00,
    quantity: 30,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'electronics',
    name: 'iPad Pro',
    description: 'iPad Pro with M2 chip, 12.9-inch Liquid Retina XDR display.',
    price: 8999.00,
    quantity: 40,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'electronics',
    name: 'AirPods Pro',
    description: 'Active noise cancelling wireless earbuds with transparency mode.',
    price: 2499.00,
    quantity: 100,
    images: [],
  },
  // Fashion Hub products
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Classic T-Shirt',
    description: '100% cotton classic fit t-shirt, available in multiple colors.',
    price: 79.90,
    quantity: 200,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Denim Jeans',
    description: 'Premium denim jeans with modern fit and stretch comfort.',
    price: 199.90,
    quantity: 150,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Summer Dress',
    description: 'Light and flowy summer dress, perfect for warm days.',
    price: 149.90,
    quantity: 120,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Leather Jacket',
    description: 'Genuine leather jacket with classic biker style.',
    price: 899.90,
    quantity: 40,
    images: [],
  },
  // Book World products
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'Clean Code',
    description: 'A Handbook of Agile Software Craftsmanship by Robert C. Martin.',
    price: 129.90,
    quantity: 80,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'Design Patterns',
    description: 'Elements of Reusable Object-Oriented Software by Gang of Four.',
    price: 149.90,
    quantity: 70,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'The Pragmatic Programmer',
    description: 'Your Journey to Mastery by Andrew Hunt and David Thomas.',
    price: 119.90,
    quantity: 90,
    images: [],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'Domain-Driven Design',
    description: 'Tackling Complexity in the Heart of Software by Eric Evans.',
    price: 159.90,
    quantity: 60,
    images: [],
  },
];

// ============================================================================
// SEED EXECUTION
// ============================================================================

/**
 * Runs the seed process with the provided repositories.
 * If repositories are not provided, creates new instances (for CLI usage).
 *
 * @param repositories - Optional repositories to use for seeding. If omitted, new InMemory instances are created.
 */
export async function runSeed(repositories?: SeedRepositories): Promise<void> {
  console.log('🌱 Starting seed process...');

  // 1. Validate environment
  console.log('📋 Validating environment...');
  validateSeedEnvironment();
  console.log('✅ Environment validation passed');

  // 2. Initialize repositories (use provided or create new InMemory instances)
  console.log('🔧 Initializing repositories...');

  let personRepo: PersonRepository;
  let vendorRepo: VendorRepository;
  let categoryRepo: CategoryRepository;
  let productRepo: ProductRepository;

  if (repositories) {
    personRepo = repositories.personRepo;
    vendorRepo = repositories.vendorRepo;
    categoryRepo = repositories.categoryRepo;
    productRepo = repositories.productRepo;
  } else {
    // Dynamic imports for InMemory implementations to avoid coupling
    const { InMemoryPersonRepository } = await import('../modules/person/person.domain.js');
    const { InMemoryVendorRepository } = await import('../modules/vendor/vendor.domain.js');
    const { InMemoryProductRepository, InMemoryCategoryRepository } = await import('../modules/product/product.domain.js');

    personRepo = new InMemoryPersonRepository();
    vendorRepo = new InMemoryVendorRepository();
    categoryRepo = new InMemoryCategoryRepository();
    productRepo = new InMemoryProductRepository();
  }
  console.log('✅ Repositories initialized');

  // 3. Create categories with hierarchy
  console.log('📦 Creating categories...');
  const categoryMap = new Map<string, Category>();

  // First pass: create root categories
  for (const catData of CATEGORIES.filter(c => c.parentSlug === null)) {
    const category = Category.create({
      name: catData.name,
      slug: catData.slug,
      parentId: null,
    });
    // Set deterministic ID for idempotency
    (category as any).id = catData.id;
    await categoryRepo.save(category);
    categoryMap.set(catData.slug, category);
    console.log(`  ✅ Created root category: ${category.name} (${category.slug})`);
  }

  // Second pass: create child categories
  for (const catData of CATEGORIES.filter(c => c.parentSlug !== null)) {
    const parentCategory = categoryMap.get(catData.parentSlug!);
    if (!parentCategory) {
      throw new Error(`Parent category not found for slug: ${catData.parentSlug}`);
    }
    const category = Category.createWithParent(
      { name: catData.name, slug: catData.slug, parentId: parentCategory.id },
      parentCategory
    );
    // Set deterministic ID for idempotency
    (category as any).id = catData.id;
    await categoryRepo.save(category);
    categoryMap.set(catData.slug, category);
    console.log(`  ✅ Created child category: ${category.name} (${category.slug}) under ${parentCategory.name}`);
  }

  console.log(`✅ Created ${CATEGORIES.length} categories`);

  // 4. Create vendor users (register + onboard)
  console.log('👤 Creating vendor users...');
  const vendorSlugToId = new Map<string, string>();

  for (const vendorData of VENDORS) {
    // Check if vendor already exists by slug (idempotency)
    const existingVendor = await vendorRepo.findBySlug(vendorData.slug);
    if (existingVendor) {
      vendorSlugToId.set(vendorData.slug, existingVendor.id);
      console.log(`  ⏭️  Vendor already exists: ${vendorData.storeName} (${vendorData.slug})`);
      continue;
    }

    // Create person
    const person = Person.create({
      name: vendorData.name,
      mainInfo: {
        name: vendorData.name,
        taxIdType: 'CNPJ',
        taxIdValue: vendorData.cnpj,
      },
      contactInfos: [
        { type: 'email', value: vendorData.email, isPrimary: true },
      ],
      addresses: [
        {
          street: 'Av. Principal',
          number: '1000',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          isPrimary: true,
        },
      ],
    });

    // Set deterministic ID for idempotency
    (person as any).id = vendorData.personId;

    // Hash password and set credential
    const hashedPassword = await hashPassword(vendorData.password);
    person.setCredential(hashedPassword);

    // Add VENDOR role
    person.addRole(PersonRole.VENDOR);

    await personRepo.save(person);
    console.log(`  ✅ Created person: ${person.name} (${person.email})`);

    // Create vendor profile
    const vendor = Vendor.create({
      personId: person.id,
      storeName: vendorData.storeName,
      slug: vendorData.slug,
      commissionPct: config.commissionPct,
    });

    // Set deterministic ID for idempotency
    (vendor as any).id = vendorData.id;

    await vendorRepo.save(vendor);
    vendorSlugToId.set(vendorData.slug, vendor.id);
    console.log(`  ✅ Created vendor: ${vendor.storeName} (${vendor.slug})`);
  }

  console.log(`✅ Created ${VENDORS.length} vendors`);

  // 5. Create products
  console.log('📦 Creating products...');

  for (const prodData of PRODUCTS) {
    const vendorId = vendorSlugToId.get(prodData.vendorSlug);
    if (!vendorId) {
      throw new Error(`Vendor not found for slug: ${prodData.vendorSlug}`);
    }

    const category = categoryMap.get(prodData.categorySlug);
    if (!category) {
      throw new Error(`Category not found for slug: ${prodData.categorySlug}`);
    }

    const product = Product.create({
      vendorId,
      categoryId: category.id,
      name: prodData.name,
      description: prodData.description,
      price: prodData.price,
      quantity: prodData.quantity,
      images: prodData.images,
      status: ProductStatus.ACTIVE,
    });
    // Set deterministic ID for idempotency
    (product as any).id = prodData.id;

    await productRepo.save(product);
    console.log(`  ✅ Created product: ${product.name} (${category.name} - ${prodData.vendorSlug})`);
  }

  console.log(`✅ Created ${PRODUCTS.length} products`);

  // 6. Summary
  console.log('\n📊 Seed Summary:');
  console.log(`  Categories: ${CATEGORIES.length}`);
  console.log(`  Vendors: ${VENDORS.length}`);
  console.log(`  Products: ${PRODUCTS.length}`);
  console.log('\n✨ Seed completed successfully!');
}

export {
  validateSeedEnvironment,
  generateDeterministicHashId,
  resetDeterministicIdGenerator,
  CATEGORIES,
  VENDORS,
  PRODUCTS,
};