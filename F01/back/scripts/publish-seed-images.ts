/**
 * publish-seed-images.ts
 *
 * Phase I — idempotent seed-image publishing to S3.
 *
 * Uploads the 12 seed product WebP images from
 *   storage/uploads/products/{vendorId}/{productId}/main.webp
 * to S3 bucket fs01-marketplace-dev-20261105 (region us-east-2) at keys
 *   products/{vendorId}/{productId}/main.webp
 *
 * Vendor and product IDs are computed with the same deterministic functions
 * used by src/scripts/seed.ts (generateDeterministicSlugId /
 * generateDeterministicHashId), replayed in the same module-load order, so
 * the IDs match the seeded catalog exactly.
 *
 * Idempotency:
 *   - Objects already present in S3 (exact key match via ListObjectsV2) with
 *     a matching size are skipped.
 *   - Objects present with a different size are overwritten.
 *   - Missing objects are uploaded with Content-Type: image/webp.
 *   - No existing S3 object is ever deleted; unrelated objects are never touched.
 *
 * Exits nonzero if any local file fails validation or any upload fails.
 */

import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import sharp from 'sharp';
import { AwsS3Client } from '../src/shared/storage/aws-s3.client.js';

// Load project .env (AWS credentials come from there only; nothing is hardcoded).
dotenv.config();

// ---------------------------------------------------------------------------
// Deterministic ID helpers — reimplemented identically to src/scripts/seed.ts
// ---------------------------------------------------------------------------
let seedCounter = 0;
const SEED_BASE = 1_000_000_000_000;

/**
 * Generates a deterministic hash-based ID for seed data idempotency.
 * Mirrors src/scripts/seed.ts generateDeterministicHashId.
 */
function generateDeterministicHashId(prefix: string = 'seed'): string {
  seedCounter += 1;
  const hashPart = SEED_BASE + seedCounter;
  const paddedCounter = String(seedCounter).padStart(6, '0');
  return `${prefix}-${hashPart}-${paddedCounter}`;
}

/**
 * Generates a deterministic ID based on a slug/string.
 * Mirrors src/scripts/seed.ts generateDeterministicSlugId.
 */
function generateDeterministicSlugId(prefix: string, slug: string): string {
  // Simple deterministic hash from slug (djb2-like, 32-bit).
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash) + slug.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  const positiveHash = Math.abs(hash);
  return `${prefix}-${positiveHash.toString(36).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Seed catalog definitions (mirror src/scripts/seed.ts)
// ---------------------------------------------------------------------------

const VENDOR_SLUGS = ['tech-store', 'fashion-hub', 'book-world'] as const;

interface SeedProductEntry {
  vendorSlug: string;
  productName: string;
}

const SEED_PRODUCTS: SeedProductEntry[] = [
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

interface ResolvedProduct {
  vendorSlug: string;
  vendorId: string;
  productId: string;
  productName: string;
}

/**
 * Resolves vendorId/productId for every seed product, replaying seed.ts
 * module-load order so the shared counter produces identical IDs:
 *   6 categories (hashId), 3 vendors (slugId + person hashId), 12 products.
 */
function resolveSeedProducts(): ResolvedProduct[] {
  for (let i = 0; i < 6; i++) {
    generateDeterministicHashId('cat');
  }

  const vendorIdBySlug = new Map<string, string>();
  for (const slug of VENDOR_SLUGS) {
    const vendorId = generateDeterministicSlugId('vendor', slug);
    vendorIdBySlug.set(slug, vendorId);
    generateDeterministicHashId('person'); // person id consumes a counter slot
  }

  const products: ResolvedProduct[] = [];
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

// ---------------------------------------------------------------------------
// Local file validation
// ---------------------------------------------------------------------------

const MIN_FILE_SIZE = 100;
const EXPECTED_WIDTH = 400;
const EXPECTED_HEIGHT = 400;

interface LocalValidation {
  ok: boolean;
  error?: string;
}

async function validateLocalWebp(filePath: string, buffer: Buffer): Promise<LocalValidation> {
  if (buffer.length <= MIN_FILE_SIZE) {
    return { ok: false, error: `file too small (${buffer.length} bytes, need > ${MIN_FILE_SIZE})` };
  }
  // WebP container: 'RIFF' at offset 0, 'WEBP' at offset 8.
  if (
    buffer[0] !== 0x52 || buffer[1] !== 0x49 || buffer[2] !== 0x46 || buffer[3] !== 0x46 ||
    buffer[8] !== 0x57 || buffer[9] !== 0x45 || buffer[10] !== 0x42 || buffer[11] !== 0x50
  ) {
    return { ok: false, error: 'invalid WebP signature (RIFF/WEBP magic missing)' };
  }
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return { ok: false, error: 'could not read image metadata' };
  }
  if (metadata.width !== EXPECTED_WIDTH || metadata.height !== EXPECTED_HEIGHT) {
    return {
      ok: false,
      error: `expected ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}, got ${
        metadata.width ?? '?'}x${metadata.height ?? '?'}`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

interface S3ObjectInfo {
  exists: boolean;
  size?: number;
}

async function s3ObjectExists(
  client: AwsS3Client,
  bucket: string,
  key: string,
): Promise<S3ObjectInfo> {
  const listed = await client.listObjectsV2({ Bucket: bucket, Prefix: key, MaxKeys: 1 });
  const contents = Array.isArray(listed?.Contents) ? listed.Contents : [];
  const match = contents.find((item: { Key: string; Size: number }) => item.Key === key);
  return match ? { exists: true, size: match.Size } : { exists: false };
}

// Redacts long alphanumeric tokens so diagnostics never leak credentials.
function sanitizeDiagnostic(value: string): string {
  return value.replace(/[A-Za-z0-9+/=]{24,}/g, '[REDACTED]');
}

function classifyError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name ? `${err.name}: ` : '';
    return name + sanitizeDiagnostic(err.message);
  }
  return sanitizeDiagnostic(String(err));
}

async function main(): Promise<void> {
  const bucket = (process.env.AWS_S3_BUCKET || 'fs01-marketplace-dev-20261105').trim();
  const region = (process.env.AWS_REGION || 'us-east-2').trim();
  const contentType = 'image/webp';

  if (!bucket || !region) {
    throw new Error('S3 configuration incomplete: AWS_S3_BUCKET and AWS_REGION are required');
  }

  const client = new AwsS3Client(region);

  const scriptDir = resolve(__dirname);
  const localBase = resolve(scriptDir, '../../storage/uploads/products'); // F01/storage/uploads/products

  console.log('Publish seed images to S3');
  console.log(`  Local base: ${localBase}`);
  console.log(`  Bucket:     ${bucket}`);
  console.log(`  Region:     ${region}`);
  console.log('');

  const products = resolveSeedProducts();
  console.log(`Resolved ${products.length} seed products\n`);

  const results: Array<{
    key: string;
    status: 'uploaded' | 'skipped' | 'failed';
    size?: number;
    contentType?: string;
    error?: string;
  }> = [];

  for (const product of products) {
    const key = `products/${product.vendorId}/${product.productId}/main.webp`;
    const localFile = resolve(localBase, product.vendorId, product.productId, 'main.webp');

    let status: 'uploaded' | 'skipped' | 'failed' = 'failed';
    let size: number | undefined;
    let error: string | undefined;

    try {
      const buffer = await readFile(localFile);
      size = buffer.length;

      const validation = await validateLocalWebp(localFile, buffer);
      if (!validation.ok) {
        error = `validation: ${validation.error}`;
      } else {
        const existing = await s3ObjectExists(client, bucket, key);
        if (existing.exists) {
          if (existing.size === size) {
            status = 'skipped';
            console.log(`  ⏭️  skipped   ${key} (${size} bytes)`);
          } else {
            await client.putObject({
              Bucket: bucket,
              Key: key,
              Body: buffer,
              ContentType: contentType,
            });
            status = 'uploaded';
            console.log(`  ✅ uploaded   ${key} (replaced, ${size} bytes)`);
          }
        } else {
          await client.putObject({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: contentType,
          });
          status = 'uploaded';
          console.log(`  ✅ uploaded   ${key} (${size} bytes)`);
        }
      }
    } catch (err) {
      error = classifyError(err);
      console.log(`  ❌ failed     ${key}: ${error}`);
    }

    results.push({ key, status, size, contentType: status === 'failed' ? undefined : contentType, error });
  }

  // Summary table.
  console.log('\n📊 Publish results:');
  console.log('key                                                     status  size   content-type');
  for (const result of results) {
    console.log(
      `  ${result.key.padEnd(54)}${(result.status ?? '').padEnd(9)}${
        String(result.size ?? '-').padEnd(8)}${result.contentType ?? '-'}`,
    );
  }

  const failed = results.filter((result) => result.status === 'failed');
  const uploaded = results.filter((result) => result.status === 'uploaded');
  const skipped = results.filter((result) => result.status === 'skipped');

  console.log(
    `\nTotal: ${results.length} | uploaded: ${uploaded.length} | skipped: ${skipped.length} | failed: ${failed.length}`,
  );

  if (failed.length > 0) {
    console.log('\n❌ Some objects failed to publish.');
    process.exitCode = 1;
  } else {
    console.log('\n✅ All seed images published to S3.');
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', classifyError(err));
  process.exitCode = 1;
});
