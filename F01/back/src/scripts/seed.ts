import { config } from '../config/index.js';
import { Person, PersonRole, PersonRepository, ContactInfo, Address, MainInfo } from '../modules/person/person.domain.js';
import { Vendor, VendorStatus, VendorRepository } from '../modules/vendor/vendor.domain.js';
import { Product, Category, ProductStatus, ProductError, ProductRepository, CategoryRepository } from '../modules/product/product.domain.js';
import { hashPassword } from '../modules/auth/credential.domain.js';
import { SeedRepositories } from '../shared/seed.types.js';
import { Db } from 'mongodb';
import { MongoPersonRepository } from '../modules/person/person.mongo.repository.js';
import { MongoVendorRepository } from '../modules/vendor/vendor.mongo.repository.js';
import { MongoCategoryRepository } from '../modules/product/category.mongo.repository.js';
import { MongoProductRepository } from '../modules/product/product.mongo.repository.js';
export type { SeedRepositories };

function getVendorSeedPasswordVariable(slug: string): string {
  return `SEED_VENDOR_${slug.replace(/-/g, '_').toUpperCase()}_PASSWORD`;
}

export function validateSeedEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV === 'production' && environment.SEED_FORCE !== 'true') {
    throw new Error('Seed script requires SEED_FORCE=true to run in production environment');
  }

  if (environment.NODE_ENV === 'production') {
    const requiredPasswordVariables = [
      ...VENDORS.map(vendor => getVendorSeedPasswordVariable(vendor.slug)),
      ...ACCOUNTS.map(account => `SEED_${account.role}_PASSWORD`),
    ];
    const hasTestUserPassword = Boolean(environment.TEST_USER_PASSWORD?.trim());
    const missingPasswords = requiredPasswordVariables.filter(
      name => !environment[name]?.trim() && !hasTestUserPassword,
    );
    if (missingPasswords.length > 0) {
      throw new Error(
        `Production seed requires deployment-managed passwords: ${missingPasswords.join(', ')}`,
      );
    }
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
}

interface AccountSeedData {
  id: string;
  email: string;
  name: string;
  taxIdType: 'CPF' | 'CNPJ';
  taxIdValue: string;
  role: PersonRole.CONSUMER | PersonRole.ADMIN;
  password: string;
}

interface ProductSeedData {
  id: string;
  seedIdentity: string;
  vendorSlug: string;
  categorySlug: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  images: string[];
  imageFilename?: string;
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
  },
  {
    id: generateDeterministicSlugId('vendor', 'fashion-hub'),
    personId: generateDeterministicHashId('person'),
    cnpj: '04252011000110',
    email: 'fashionhub@example.com',
    name: 'Fashion Hub',
    storeName: 'Fashion Hub',
    slug: 'fashion-hub',
  },
  {
    id: generateDeterministicSlugId('vendor', 'book-world'),
    personId: generateDeterministicHashId('person'),
    cnpj: '12345678000195',
    email: 'bookworld@example.com',
    name: 'Book World',
    storeName: 'Book World',
    slug: 'book-world',
  },
];

const ACCOUNTS: AccountSeedData[] = [
  {
    id: generateDeterministicSlugId('person', 'demo-consumer'),
    email: 'consumer@example.com',
    name: 'Demo Consumer',
    taxIdType: 'CPF',
    taxIdValue: '11144477735',
    role: PersonRole.CONSUMER,
    password: process.env.TEST_USER_PASSWORD!,
  },
  {
    id: generateDeterministicSlugId('person', 'demo-admin'),
    email: 'admin@example.com',
    name: 'Demo Admin',
    taxIdType: 'CNPJ',
    taxIdValue: '11222333000262',
    role: PersonRole.ADMIN,
    password: process.env.TEST_USER_PASSWORD!,
  },
];

const PRODUCTS: ProductSeedData[] = [
  // Tech Store products
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'smartphones',
    name: 'SHYPHONE 15 Pro',
    seedIdentity: 'fs01:product:tech-iphone-15-pro',
    imageFilename: 'main-shyphone.png',
    description: 'SHYPHONE 15 Pro: smartphone de demonstração com acabamento metálico e câmera tripla.',
    price: 9999.00,
    quantity: 50,
    images: ['seed/products/tech-iphone-15-pro/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'laptops',
    name: 'SHYBOOK Pro 16',
    seedIdentity: 'fs01:product:tech-macbook-pro-16',
    imageFilename: 'main-shybook.png',
    description: 'SHYBOOK Pro 16: notebook de demonstração com tela ampla e acabamento metálico.',
    price: 24999.00,
    quantity: 30,
    images: ['seed/products/tech-macbook-pro-16/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'electronics',
    name: 'SHYPAD Pro',
    seedIdentity: 'fs01:product:tech-ipad-pro',
    imageFilename: 'main-shypad.png',
    description: 'SHYPAD Pro: tablet de demonstração com tela ampla.',
    price: 8999.00,
    quantity: 40,
    images: ['seed/products/tech-ipad-pro/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'tech-store',
    categorySlug: 'electronics',
    name: 'SHYRPODS Pro',
    seedIdentity: 'fs01:product:tech-airpods-pro',
    imageFilename: 'main-shyrpods.png',
    description: 'SHYRPODS Pro: fones sem fio de demonstração com estojo.',
    price: 2499.00,
    quantity: 100,
    images: ['seed/products/tech-airpods-pro/main.webp'],
  },
  // Fashion Hub products
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Classic T-Shirt',
    seedIdentity: 'fs01:product:fashion-classic-tshirt',
    description: '100% cotton classic fit t-shirt, available in multiple colors.',
    price: 79.90,
    quantity: 200,
    images: ['seed/products/fashion-classic-tshirt/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Denim Jeans',
    seedIdentity: 'fs01:product:fashion-denim-jeans',
    description: 'Premium denim jeans with modern fit and stretch comfort.',
    price: 199.90,
    quantity: 150,
    images: ['seed/products/fashion-denim-jeans/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Summer Dress',
    seedIdentity: 'fs01:product:fashion-summer-dress',
    description: 'Light and flowy summer dress, perfect for warm days.',
    price: 149.90,
    quantity: 120,
    images: ['seed/products/fashion-summer-dress/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'fashion-hub',
    categorySlug: 'clothing',
    name: 'Leather Jacket',
    seedIdentity: 'fs01:product:fashion-leather-jacket',
    description: 'Genuine leather jacket with classic biker style.',
    price: 899.90,
    quantity: 40,
    images: ['seed/products/fashion-leather-jacket/main.webp'],
  },
  // Book World products
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'Clean Code',
    seedIdentity: 'fs01:product:book-clean-code',
    description: 'A Handbook of Agile Software Craftsmanship by Robert C. Martin.',
    price: 129.90,
    quantity: 80,
    images: ['seed/products/book-clean-code/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'Design Patterns',
    seedIdentity: 'fs01:product:book-design-patterns',
    description: 'Elements of Reusable Object-Oriented Software by Gang of Four.',
    price: 149.90,
    quantity: 70,
    images: ['seed/products/book-design-patterns/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'The Pragmatic Programmer',
    seedIdentity: 'fs01:product:book-pragmatic-programmer',
    description: 'Your Journey to Mastery by Andrew Hunt and David Thomas.',
    price: 119.90,
    quantity: 90,
    images: ['seed/products/book-pragmatic-programmer/main.webp'],
  },
  {
    id: generateDeterministicHashId('prod'),
    vendorSlug: 'book-world',
    categorySlug: 'books',
    name: 'Domain-Driven Design',
    seedIdentity: 'fs01:product:book-domain-driven-design',
    description: 'Tackling Complexity in the Heart of Software by Eric Evans.',
    price: 159.90,
    quantity: 60,
    images: ['seed/products/book-domain-driven-design/main.webp'],
  },
];

// ============================================================================
// SEED EXECUTION
// ============================================================================

/**
 * Creates repositories backed by the supplied MongoDB database.
 */
export function createMongoSeedRepositories(database: Db): SeedRepositories {
  return {
    personRepo: new MongoPersonRepository(database),
    vendorRepo: new MongoVendorRepository(database),
    categoryRepo: new MongoCategoryRepository(database),
    productRepo: new MongoProductRepository(database),
  };
}

async function seedDemoAccounts(personRepo: PersonRepository): Promise<void> {
  console.log('👤 Ensuring demo accounts...');
  for (const account of ACCOUNTS) {
    const passwordVariable = `SEED_${account.role}_PASSWORD`;
    const password = process.env[passwordVariable];
    if (config.isProduction && !password) {
      throw new Error(`${passwordVariable} is required when seeding demo accounts in production`);
    }

    const existingPerson = await personRepo.findById(account.id);
    const existingByEmail = await personRepo.findByEmail(account.email);
    if (existingByEmail && existingByEmail.id !== account.id) {
      throw new Error(`SEED_ACCOUNT_EMAIL_CONFLICT: ${account.email}`);
    }

    const existingByTaxId = await personRepo.findByTaxId(account.taxIdType, account.taxIdValue);
    if (existingByTaxId && existingByTaxId.id !== account.id) {
      throw new Error(`SEED_ACCOUNT_TAX_ID_CONFLICT: ${account.taxIdType}`);
    }

    const newPerson = Person.create({
      name: account.name,
      mainInfo: {
        name: account.name,
        taxIdType: account.taxIdType,
        taxIdValue: account.taxIdValue,
      },
      contactInfos: [{ type: 'email', value: account.email, isPrimary: true }],
      addresses: account.role === PersonRole.CONSUMER
        ? [{
            id: `address-${account.id}-home`,
            street: 'Rua Exemplo',
            number: '100',
            neighborhood: 'Centro',
            city: 'São Paulo',
            state: 'SP',
            isPrimary: true,
          }]
        : [],
    });
    let person: Person = existingPerson ?? Person.reconstruct({
      ...newPerson,
      id: account.id,
    });

    if (existingPerson && (
      person.mainInfo.taxIdType !== account.taxIdType
      || person.mainInfo.taxIdValue !== account.taxIdValue
    )) {
      throw new Error(`SEED_ACCOUNT_IDENTITY_CONFLICT: ${account.email}`);
    }

    const hasConflictingRole = account.role === PersonRole.ADMIN
      ? person.roles.some(role => role !== PersonRole.ADMIN)
      : person.roles.includes(PersonRole.ADMIN);
    if (hasConflictingRole) {
      throw new Error(`SEED_ACCOUNT_ROLE_CONFLICT: ${account.email}`);
    }

    person.addRole(account.role);
    if (!person.contactInfos.some(contact =>
      contact.type === 'email' && contact.value.toLowerCase() === account.email.toLowerCase()
    )) {
      person.addContact({ type: 'email', value: account.email, isPrimary: true });
    }
    if (account.role === PersonRole.CONSUMER && person.addresses.length === 0) {
      person.addAddress({
        street: 'Rua Exemplo',
        number: '100',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        isPrimary: true,
      });
    }
    const hashedPassword = await hashPassword(password ?? account.password);
    if (!person.credential) {
      person.setCredential(hashedPassword);
    } else if (existingPerson) {
      // Update credential for existing demo account (e.g. when TEST_USER_PASSWORD changes).
      // Person.setCredential() throws CREDENTIAL_ALREADY_SET for existing accounts, so
      // we reconstruct with the new credential instead.
      person = Person.reconstruct({
        ...(existingPerson as any),
        credential: hashedPassword,
        updatedAt: new Date(),
      });
    }

    if (existingPerson) {
      await personRepo.update(person);
    } else {
      await personRepo.save(person);
    }
    console.log(`  ✅ Ensured ${account.role.toLowerCase()} account: ${account.email}`);
  }
}

export async function saveSeedProductIfAbsent(productRepo: Pick<ProductRepository, 'save' | 'findById' | 'findAll'>, product: Product): Promise<void> {
  if (product.seedIdentity) {
    const matching = (await productRepo.findAll()).filter(item => item.seedIdentity === product.seedIdentity);
    if (matching.length > 1) throw new Error(ProductError.PRODUCT_CONFLICT);
    if (matching.length === 1) {
      const existing = matching[0];
      if (existing.vendorId !== product.vendorId) throw new Error(ProductError.PRODUCT_CONFLICT);
      const occupied = await productRepo.findById(product.id);
      if (occupied && occupied.id !== existing.id) throw new Error(ProductError.PRODUCT_CONFLICT);
      return;
    }
    if (await productRepo.findById(product.id)) throw new Error(ProductError.PRODUCT_CONFLICT);
  }
  try {
    await productRepo.save(product);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ProductError.PRODUCT_CONFLICT || !product.seedIdentity) throw error;
    const existing = await productRepo.findById(product.id);
    if (!existing || existing.id !== product.id || existing.vendorId !== product.vendorId || existing.seedIdentity !== product.seedIdentity) throw error;
  }
}

function resolveSeedSearchIndex(repositories: any, candidate: any): any {
  if (candidate && typeof candidate === 'object' && typeof candidate.indexProduct === 'function') {
    return candidate;
  }
  if (candidate && typeof candidate === 'object' && candidate.searchIndex && typeof candidate.searchIndex.indexProduct === 'function') {
    return candidate.searchIndex;
  }
  if (repositories && repositories.searchIndex && typeof repositories.searchIndex.indexProduct === 'function') {
    return repositories.searchIndex;
  }
  return undefined;
}

async function reindexSeededProducts(products: Product[], searchIndex: any): Promise<void> {
  if (!searchIndex || typeof searchIndex.indexProduct !== 'function') {
    return;
  }
  for (const product of products) {
    try {
      await searchIndex.indexProduct(product);
    } catch (error) {
      console.warn('Elasticsearch product indexing failed');
    }
  }
}

export async function runDevelopmentSeed(repositories: SeedRepositories, searchIndexCandidate?: any): Promise<void> {
  const searchIndex = resolveSeedSearchIndex(repositories, searchIndexCandidate);
  const existingProducts = await repositories.productRepo.findAll();
  if (existingProducts.length > 0) {
    const hasSeedProducts = existingProducts.some(product => PRODUCTS.some(entry => entry.seedIdentity === product.seedIdentity));
    const catalogIncomplete = PRODUCTS.some(entry => !existingProducts.some(product => product.seedIdentity === entry.seedIdentity));
    if (!catalogIncomplete && searchIndex) {
      const seededProducts: Product[] = [];
      for (const entry of PRODUCTS) {
        const matching = existingProducts.filter(product => product.seedIdentity === entry.seedIdentity);
        if (matching.length !== 1) throw new Error(ProductError.PRODUCT_CONFLICT);
        const vendor = await repositories.vendorRepo.findBySlug(entry.vendorSlug);
        if (!vendor) throw new Error('SEED_VENDOR_NOT_FOUND');
        if (matching[0].vendorId !== vendor.id) throw new Error(ProductError.PRODUCT_CONFLICT);
        seededProducts.push(matching[0]);
      }
      // Index-only recovery must not bootstrap accounts or rewrite the existing catalog.
      await reindexSeededProducts(seededProducts, searchIndex);
      return;
    }
    if (hasSeedProducts && catalogIncomplete) {
      await repositories.productRepo.assertSeedIdentityReady();
      const categories = new Map<string, Category>();
      const vendors = new Map<string, string>();
      for (const entry of PRODUCTS) {
        if (!categories.has(entry.categorySlug)) {
          const category = await repositories.categoryRepo.findBySlug(entry.categorySlug);
          if (!category) throw new Error('SEED_CATEGORY_NOT_FOUND');
          categories.set(entry.categorySlug, category);
        }
        if (!vendors.has(entry.vendorSlug)) {
          const vendor = await repositories.vendorRepo.findBySlug(entry.vendorSlug);
          if (!vendor) throw new Error('SEED_VENDOR_NOT_FOUND');
          vendors.set(entry.vendorSlug, vendor.id);
        }
      }
      const seededProducts = await seedProducts(repositories.productRepo, categories, vendors);
      await reindexSeededProducts(seededProducts, searchIndex);
      return;
    }
    console.log('Product repository not empty, ensuring demo accounts without reseeding catalog');
    await seedDemoAccounts(repositories.personRepo);
    return;
  }

  await runSeed(repositories, searchIndex);
}

export async function runSeed(repositories: SeedRepositories, searchIndexCandidate?: any): Promise<void> {
  const searchIndex = resolveSeedSearchIndex(repositories, searchIndexCandidate);
  console.log('🌱 Starting seed process...');

  // 1. Validate environment
  console.log('📋 Validating environment...');
  validateSeedEnvironment();
  await repositories.productRepo.assertSeedIdentityReady();
  console.log('✅ Environment validation passed');

  const { personRepo, vendorRepo, categoryRepo, productRepo } = repositories;

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
          id: `addr-${vendorData.personId}-1`,
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
    const passwordVariable = getVendorSeedPasswordVariable(vendorData.slug);
    const vendorPassword = process.env[passwordVariable] ??  process.env.TEST_USER_PASSWORD!;
    if (config.isProduction && !process.env[passwordVariable]?.trim()) {
      throw new Error(`${passwordVariable} is required when seeding vendor accounts in production`);
    }
    const hashedPassword = await hashPassword(vendorPassword);
    person.setCredential(hashedPassword);

    // Add CONSUMER role first (for buyer capabilities), then VENDOR role (for seller capabilities)
    person.addRole(PersonRole.CONSUMER);
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

  // 5. Ensure demo accounts without overwriting existing profile data.
  await seedDemoAccounts(personRepo);

  // 6. Create products
  console.log('📦 Creating products...');

  const seededProducts = await seedProducts(productRepo, categoryMap, vendorSlugToId);

  console.log(`✅ Created ${PRODUCTS.length} products`);

  await reindexSeededProducts(seededProducts, searchIndex);

  // 7. Summary
  console.log('\n📊 Seed Summary:');
  console.log(`  Categories: ${CATEGORIES.length}`);
  console.log(`  Vendors: ${VENDORS.length}`);
  console.log(`  Demo accounts: ${ACCOUNTS.length}`);
  console.log(`  Products: ${PRODUCTS.length}`);
  console.log('\n✨ Seed completed successfully!');
}

async function seedProducts(productRepo: ProductRepository, categoryMap: Map<string, Category>, vendorSlugToId: Map<string, string>): Promise<Product[]> {
  const seeded: Product[] = [];
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
      images: [`products/${vendorId}/${prodData.id}/${prodData.imageFilename ?? 'main.webp'}`],
      seedIdentity: prodData.seedIdentity,
      status: ProductStatus.ACTIVE,
    });
    // Set deterministic ID for idempotency
    (product as any).id = prodData.id;

    await saveSeedProductIfAbsent(productRepo, product);
    // Seed identity can already belong to a different ID or an edited product.
    // Read back the authoritative record instead of indexing the fixture.
    const persisted = (await productRepo.findAll()).filter(item => item.seedIdentity === product.seedIdentity);
    if (persisted.length !== 1 || persisted[0].vendorId !== product.vendorId) {
      throw new Error(ProductError.PRODUCT_CONFLICT);
    }
    seeded.push(persisted[0]);
    console.log(`  Created product: ${product.name} (${category.name} - ${prodData.vendorSlug})`);
  }
  return seeded;
}

export {
  generateDeterministicHashId,
  resetDeterministicIdGenerator,
  CATEGORIES,
  VENDORS,
  ACCOUNTS,
  PRODUCTS,
};
