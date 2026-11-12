/**
 * verify-s3-images.ts
 *
 * Independent verification of real S3 persistence for the 12 uploaded seed
 * product images in bucket fs01-marketplace-dev-20261105 (us-east-2).
 *
 * For every expected key products/{vendorId}/{productId}/main.webp:
 *   - object existence:     AwsS3Client.listObjectsV2 with exact key match
 *   - nonzero content length: from ListObjectsV2 Size / HeadObject ContentLength
 *   - Content-Type: image/webp: HeadObjectCommand
 *   - content integrity:      S3 ETag vs local file MD5; S3 ContentLength vs local size
 *   - retrievability:         AwsS3Client.getSignedUrl (presigned URL never printed)
 *                             plus a GET through that URL to prove real retrieval
 *
 * Prints a results table for all 12 objects and exits nonzero if any
 * verification fails. Never prints AWS credentials, tokens, or presigned URLs.
 */

import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { AwsS3Client } from '../src/shared/storage/aws-s3.client.js';

dotenv.config();

const BUCKET = (process.env.AWS_S3_BUCKET ?? 'fs01-marketplace-dev-20261105').trim();
const REGION = (process.env.AWS_REGION ?? 'us-east-2').trim();
const EXPECTED_CONTENT_TYPE = 'image/webp';
const LOCAL_BASE = resolve(__dirname, '../../storage/uploads/products');

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  throw new Error('AWS credentials are not configured in the environment');
}

interface ExpectedEntry {
  vendorSlug: string;
  vendorId: string;
  productId: string;
  productName: string;
  expectedSize: number;
}

// The 12 expected seed product images (key, local file, expected size).
const ENTRIES: ExpectedEntry[] = [
  { vendorSlug: 'tech-store', vendorId: 'vendor-00cjp4oa', productId: 'prod-1000000000010-000010', productName: 'iPhone 15 Pro', expectedSize: 1788 },
  { vendorSlug: 'tech-store', vendorId: 'vendor-00cjp4oa', productId: 'prod-1000000000011-000011', productName: 'MacBook Pro 16', expectedSize: 2082 },
  { vendorSlug: 'tech-store', vendorId: 'vendor-00cjp4oa', productId: 'prod-1000000000012-000012', productName: 'iPad Pro', expectedSize: 1494 },
  { vendorSlug: 'tech-store', vendorId: 'vendor-00cjp4oa', productId: 'prod-1000000000013-000013', productName: 'AirPods Pro', expectedSize: 1778 },
  { vendorSlug: 'fashion-hub', vendorId: 'vendor-00av3pls', productId: 'prod-1000000000014-000014', productName: 'Classic T-Shirt', expectedSize: 1812 },
  { vendorSlug: 'fashion-hub', vendorId: 'vendor-00av3pls', productId: 'prod-1000000000015-000015', productName: 'Denim Jeans', expectedSize: 1680 },
  { vendorSlug: 'fashion-hub', vendorId: 'vendor-00av3pls', productId: 'prod-1000000000016-000016', productName: 'Summer Dress', expectedSize: 1836 },
  { vendorSlug: 'fashion-hub', vendorId: 'vendor-00av3pls', productId: 'prod-1000000000017-000017', productName: 'Leather Jacket', expectedSize: 1910 },
  { vendorSlug: 'book-world', vendorId: 'vendor-00k14rzi', productId: 'prod-1000000000018-000018', productName: 'Clean Code', expectedSize: 2416 },
  { vendorSlug: 'book-world', vendorId: 'vendor-00k14rzi', productId: 'prod-1000000000019-000019', productName: 'Design Patterns', expectedSize: 2762 },
  { vendorSlug: 'book-world', vendorId: 'vendor-00k14rzi', productId: 'prod-1000000000020-000020', productName: 'The Pragmatic Programmer', expectedSize: 3542 },
  { vendorSlug: 'book-world', vendorId: 'vendor-00k14rzi', productId: 'prod-1000000000021-000021', productName: 'Domain-Driven Design', expectedSize: 3034 },
];

interface VerifyResult {
  key: string;
  product: string;
  exists: boolean;
  contentLength: string;
  contentType: string;
  integrity: boolean;
  retrievable: boolean;
  status: 'PASS' | 'FAIL';
  reason: string;
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

async function verifyOne(
  s3: AwsS3Client,
  raw: S3Client,
  entry: ExpectedEntry,
): Promise<VerifyResult> {
  const key = `products/${entry.vendorId}/${entry.productId}/main.webp`;
  const localFile = resolve(LOCAL_BASE, entry.vendorId, entry.productId, 'main.webp');

  const result: VerifyResult = {
    key,
    product: entry.productName,
    exists: false,
    contentLength: '-',
    contentType: '-',
    integrity: false,
    retrievable: false,
    status: 'FAIL',
    reason: '',
  };

  try {
    const buffer = await readFile(localFile);
    const localSize = buffer.length;
    const localMd5 = createHash('md5').update(buffer).digest('hex');

    // 1. Existence + content length via ListObjectsV2 (AwsS3Client, exact key).
    const listed = await s3.listObjectsV2({ Bucket: BUCKET, Prefix: key, MaxKeys: 1 });
    const contents = Array.isArray(listed?.Contents) ? listed.Contents : [];
    const match = contents.find((item: { Key: string; Size: number; ETag?: string }) => item.Key === key);

    if (!match) {
      result.reason = 'object not found in S3';
      return result;
    }
    result.exists = true;
    result.contentLength = String(match.Size);

    // 2. Content-Type + authoritative length/ETag via HeadObject (raw SDK;
    //    AwsS3Client does not expose HeadObject/GetObject).
    const head = await raw.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    result.contentType = String(head.ContentType ?? '-');
    const s3Size = Number(head.ContentLength ?? 0);
    const s3Etag = String(head.ETag ?? '').replace(/^"|"$/g, '');

    // 3. Integrity: S3 ETag == local MD5; sizes match expected + local > 0.
    const etagMatch = s3Etag.length > 0 && s3Etag === localMd5;
    const sizeMatch = s3Size === localSize && localSize === entry.expectedSize && localSize > 0;
    result.integrity = etagMatch && sizeMatch;

    // 4. Retrievability with configured credentials: signed URL (never printed)
    //    plus a GET through it proving real retrieval.
    const url = await s3.getSignedUrl({ Bucket: BUCKET, Key: key });
    if (typeof url !== 'string' || url.length === 0) {
      result.reason = 'signed URL not returned';
      result.status = 'FAIL';
      return result;
    }
    try {
      const response = await fetch(url, { method: 'GET' });
      // Consume and discard the body; never print it or the URL.
      await response.arrayBuffer();
      result.retrievable = response.ok;
      if (!response.ok) result.reason = `HTTP ${response.status}`;
    } catch (err) {
      result.retrievable = false;
      result.reason = `retrieval: ${classifyError(err)}`;
    }

    const ok =
      result.exists &&
      result.contentType === EXPECTED_CONTENT_TYPE &&
      result.integrity &&
      result.retrievable;
    result.status = ok ? 'PASS' : 'FAIL';
    if (!ok && !result.reason) result.reason = 'one or more checks failed';
  } catch (err) {
    result.reason = classifyError(err);
  }

  return result;
}

function pad(value: string, width: number): string {
  return value.length > width ? value.slice(0, width - 1) + '…' : value.padEnd(width);
}

async function main(): Promise<void> {
  console.log('Verify S3 persistence: 12 seed product images');
  console.log(`  Bucket:  ${BUCKET}`);
  console.log(`  Region:  ${REGION}`);
  console.log(`  Local:   ${LOCAL_BASE}`);
  console.log('');

  const s3 = new AwsS3Client(REGION);
  const raw = new S3Client({ region: REGION });

  const results: VerifyResult[] = [];
  for (const entry of ENTRIES) {
    results.push(await verifyOne(s3, raw, entry));
  }

  // Results table.
  const colKey = 60;
  const colBool = 6;
  const colSize = 14;
  const colType = 12;
  const colStatus = 7;

  console.log('Verification results:');
  console.log(
    `${pad('key', colKey)} ${pad('exists?', colBool)} ${pad('content-length', colSize)} ${pad('content-type', colType)} ${pad('integrity?', colBool)} ${pad('retrievable?', colBool)} status`,
  );
  console.log(
    `${'-'.repeat(colKey)} ${'-'.repeat(colBool)} ${'-'.repeat(colSize)} ${'-'.repeat(colType)} ${'-'.repeat(colBool)} ${'-'.repeat(colBool)} ${'-'.repeat(colStatus)}`,
  );
  for (const r of results) {
    console.log(
      `${pad(r.key, colKey)} ${pad(r.exists ? 'yes' : 'no ', colBool)} ${pad(r.contentLength, colSize)} ${pad(r.contentType, colType)} ${pad(r.integrity ? 'yes' : 'no ', colBool)} ${pad(r.retrievable ? 'yes' : 'no ', colBool)} ${r.status}${r.reason ? ` (${r.reason})` : ''}`,
    );
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.length - passed;

  console.log('');
  console.log(`Overall: ${passed}/${results.length} objects verified`);
  if (failed > 0) {
    console.log(`❌ ${failed} object(s) failed verification.`);
    process.exitCode = 1;
  } else {
    console.log('✅ All 12 objects verified in S3.');
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', classifyError(err));
  process.exitCode = 1;
});
