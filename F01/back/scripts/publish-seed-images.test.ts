/**
 * publish-seed-images.test.ts
 *
 * Tests for the deterministic ID logic used by scripts/publish-seed-images.ts.
 *
 * NOTE: scripts/publish-seed-images.ts does not export any functions, and its
 * module top-level executes main() (which reaches out to S3), so it cannot be
 * imported into a test. The deterministic helpers are therefore reimplemented
 * locally here, copied from the logic in scripts/publish-seed-images.ts /
 * src/scripts/seed.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Deterministic ID helpers — reimplemented identically to publish-seed-images.ts
// ---------------------------------------------------------------------------

let seedCounter = 0;
const SEED_BASE = 1_000_000_000_000;

function generateDeterministicHashId(prefix: string = 'seed'): string {
  seedCounter += 1;
  const hashPart = SEED_BASE + seedCounter;
  const paddedCounter = String(seedCounter).padStart(6, '0');
  return `${prefix}-${hashPart}-${paddedCounter}`;
}

function generateDeterministicSlugId(prefix: string, slug: string): string {
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

/**
 * Replay of publish-seed-images.ts resolveSeedProducts() module-load order:
 *   6 categories (hashId 'cat'), then for each of 3 vendors:
 *     slugId (no counter) + hashId 'person' (consumes a counter slot),
 *   then 12 products (hashId 'prod' each).
 */
function resolveSeedProducts(): Array<{
  vendorSlug: string;
  vendorId: string;
  productId: string;
  productName: string;
}> {
  const VENDOR_SLUGS = ['tech-store', 'fashion-hub', 'book-world'] as const;

  const SEED_PRODUCTS: Array<{ vendorSlug: string; productName: string }> = [
    // Tech Store products
    { vendorSlug: 'tech-store', productName: 'iPhone 15 Pro' },
    { vendorSlug: 'tech-store', productName: 'MacBook Pro 16' },
    { vendorSlug: 'tech-store', productName: 'iPad Pro' },
    { vendorSlug: 'tech-store', productName: 'AirPods Pro' },
    // Fashion Hub products
    { vendorSlug: 'fashion-hub', productName: 'Classic T-Shirt' },
    { vendorSlug: 'fashion-hub', productName: 'Denim Jeans' },
    { vendorSlug: 'fashion-hub', productName: 'Summer Dress' },
    { vendorSlug: 'fashion-hub', productName: 'Leather Jacket' },
    // Book World products
    { vendorSlug: 'book-world', productName: 'Clean Code' },
    { vendorSlug: 'book-world', productName: 'Design Patterns' },
    { vendorSlug: 'book-world', productName: 'The Pragmatic Programmer' },
    { vendorSlug: 'book-world', productName: 'Domain-Driven Design' },
  ];

  for (let i = 0; i < 6; i++) {
    generateDeterministicHashId('cat');
  }

  const vendorIdBySlug = new Map<string, string>();
  for (const slug of VENDOR_SLUGS) {
    const vendorId = generateDeterministicSlugId('vendor', slug);
    vendorIdBySlug.set(slug, vendorId);
    generateDeterministicHashId('person'); // person id consumes a counter slot
  }

  const products: Array<{
    vendorSlug: string;
    vendorId: string;
    productId: string;
    productName: string;
  }> = [];
  for (const entry of SEED_PRODUCTS) {
    const vendorId = vendorIdBySlug.get(entry.vendorSlug);
    if (!vendorId) {
      throw new Error(`No vendor id resolved for slug: ${entry.vendorSlug}`);
    }
    products.push({
      vendorSlug: entry.vendorSlug,
      vendorId,
      productId: generateDeterministicHashId('prod'),
      productName: entry.productName,
    });
  }
  return products;
}

function s3Key(vendorId: string, productId: string): string {
  return `products/${vendorId}/${productId}/main.webp`;
}

describe('publish-seed-images deterministic IDs', () => {
  beforeEach(() => {
    resetDeterministicIdGenerator();
  });

  describe('generateDeterministicSlugId', () => {
    it('produces the expected vendor id for tech-store', () => {
      expect(generateDeterministicSlugId('vendor', 'tech-store')).toBe(
        'vendor-00cjp4oa',
      );
    });

    it('produces the expected vendor id for fashion-hub', () => {
      expect(generateDeterministicSlugId('vendor', 'fashion-hub')).toBe(
        'vendor-00av3pls',
      );
    });

    it('produces the expected vendor id for book-world', () => {
      expect(generateDeterministicSlugId('vendor', 'book-world')).toBe(
        'vendor-00k14rzi',
      );
    });

    it('is deterministic across repeated calls', () => {
      const a = generateDeterministicSlugId('vendor', 'tech-store');
      const b = generateDeterministicSlugId('vendor', 'tech-store');
      expect(a).toBe(b);
    });

    it('produces different ids for different slugs', () => {
      expect(generateDeterministicSlugId('vendor', 'tech-store')).not.toBe(
        generateDeterministicSlugId('vendor', 'fashion-hub'),
      );
    });
  });

  describe('product ID sequence', () => {
    const expectedProductIds = [
      'prod-1000000000010-000010',
      'prod-1000000000011-000011',
      'prod-1000000000012-000012',
      'prod-1000000000013-000013',
      'prod-1000000000014-000014',
      'prod-1000000000015-000015',
      'prod-1000000000016-000016',
      'prod-1000000000017-000017',
      'prod-1000000000018-000018',
      'prod-1000000000019-000019',
      'prod-1000000000020-000020',
      'prod-1000000000021-000021',
    ];

    it('matches expected product IDs prod-1000000000010 through prod-1000000000021', () => {
      const products = resolveSeedProducts();
      expect(products).toHaveLength(12);
      for (let i = 0; i < products.length; i++) {
        expect(products[i].productId).toBe(expectedProductIds[i]);
      }
    });

    it('each product ID hash part is in range 1000000000010..1000000000021', () => {
      const products = resolveSeedProducts();
      const hashParts = products.map(p => Number(p.productId.split('-')[1]));
      expect(hashParts).toEqual([
        1000000000010, 1000000000011, 1000000000012, 1000000000013,
        1000000000014, 1000000000015, 1000000000016, 1000000000017,
        1000000000018, 1000000000019, 1000000000020, 1000000000021,
      ]);
    });

    it('product IDs are unique', () => {
      const products = resolveSeedProducts();
      const ids = products.map(p => p.productId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each product resolves to the correct vendor id', () => {
      const products = resolveSeedProducts();
      const vendorIdBySlug = new Map([
        ['tech-store', 'vendor-00cjp4oa'],
        ['fashion-hub', 'vendor-00av3pls'],
        ['book-world', 'vendor-00k14rzi'],
      ]);
      const expectedVendorSlugs = [
        'tech-store', 'tech-store', 'tech-store', 'tech-store',
        'fashion-hub', 'fashion-hub', 'fashion-hub', 'fashion-hub',
        'book-world', 'book-world', 'book-world', 'book-world',
      ];
      for (let i = 0; i < products.length; i++) {
        expect(products[i].vendorId).toBe(vendorIdBySlug.get(expectedVendorSlugs[i]));
      }
    });
  });

  describe('S3 key format', () => {
    it('builds keys as products/{vendorId}/{productId}/main.webp', () => {
      const products = resolveSeedProducts();
      for (const product of products) {
        const key = s3Key(product.vendorId, product.productId);
        expect(key).toBe(
          `products/${product.vendorId}/${product.productId}/main.webp`,
        );
        expect(key.startsWith('products/')).toBe(true);
        expect(key.endsWith('/main.webp')).toBe(true);
      }
    });

    it('first product key uses the tech-store vendor id', () => {
      const products = resolveSeedProducts();
      expect(products[0].vendorId).toBe('vendor-00cjp4oa');
      expect(products[0].productId).toBe('prod-1000000000010-000010');
      expect(s3Key(products[0].vendorId, products[0].productId)).toBe(
        'products/vendor-00cjp4oa/prod-1000000000010-000010/main.webp',
      );
    });
  });
});
