import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { S3StorageAdapter, S3StorageConfig, S3ClientInterface } from './s3.adapter';
import {
  generateProductImageKey,
  generateReviewImageKey,
  generateInvoiceKey,
  generateTempKey,
  sanitizeFilename,
} from './s3.key-generator';

async function createTestImage(width: number, height: number, format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } }
  });
  switch (format) {
    case 'jpeg': return img.jpeg({ quality: 80 }).toBuffer();
    case 'png': return img.png().toBuffer();
    case 'webp': return img.webp({ quality: 80 }).toBuffer();
  }
}

const config: S3StorageConfig = {
  bucket: 'test-bucket',
  region: 'us-east-1',
  publicUrlBase: 'https://cdn.example.com',
  storageClass: 'STANDARD',
};

describe('S3StorageAdapter', () => {
  let client: S3ClientInterface;
  let adapter: S3StorageAdapter;

  beforeEach(() => {
    client = {
      putObject: vi.fn().mockResolvedValue({}),
      deleteObject: vi.fn().mockResolvedValue({}),
      getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/key'),
    };
    adapter = new S3StorageAdapter(config, client);
  });

  it('implements all StorageAdapter methods', () => {
    expect(typeof adapter.save).toBe('function');
    expect(typeof adapter.delete).toBe('function');
    expect(typeof adapter.getUrl).toBe('function');
    expect(typeof adapter.validateFile).toBe('function');
    expect(typeof adapter.sanitizeKey).toBe('function');
  });

  it('getUrl constructs correct CloudFront URL', () => {
    expect(adapter.getUrl('products/v1/p1/main.jpg')).toBe('https://cdn.example.com/products/v1/p1/main.jpg');
  });

  it('sanitizeKey prevents path traversal', () => {
    expect(() => adapter.sanitizeKey('../etc/passwd')).toThrow();
    expect(adapter.sanitizeKey('products/v1/p1/main.jpg')).toBe('products/v1/p1/main.jpg');
  });

  it('validateFile rejects invalid MIME', async () => {
    const buffer = await createTestImage(800, 800, 'jpeg');
    const result = await adapter.validateFile(buffer, 'text/plain');
    expect(result.valid).toBe(false);
  });

  it('validateFile rejects invalid size', async () => {
    const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);
    const result = await adapter.validateFile(buffer, 'image/jpeg');
    expect(result.valid).toBe(false);
  });

  it('validateFile rejects invalid signature', async () => {
    const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    // pad to enough size
    const padded = Buffer.concat([buffer, Buffer.alloc(100)]);
    const result = await adapter.validateFile(padded, 'image/jpeg');
    expect(result.valid).toBe(false);
  });

  it('save returns correct url and key', async () => {
    const buffer = await createTestImage(800, 800, 'jpeg');
    const result = await adapter.save(buffer, 'products/v1/p1/main.jpg', 'image/jpeg');
    expect(result.key).toBe('products/v1/p1/main.jpg');
    expect(result.url).toBe('https://cdn.example.com/products/v1/p1/main.jpg');
    expect(client.putObject).toHaveBeenCalled();
  });

  it('delete calls client with correct params', async () => {
    await adapter.delete('products/v1/p1/main.jpg');
    expect(client.deleteObject).toHaveBeenCalledWith({
      Bucket: 'test-bucket',
      Key: 'products/v1/p1/main.jpg',
    });
  });

  it('fails closed rather than deleting objects from an uncoordinated reference snapshot', async () => {
    client.listObjectsV2 = vi.fn().mockResolvedValue({ Contents: [{ Key: 'products/v1/p1/new.jpg' }] });
    client.deleteObjects = vi.fn().mockResolvedValue({});
    await expect(adapter.cleanupOrphanedFiles(['https://old.example.com/products/v1/p1/new.jpg']))
      .rejects.toThrow('S3 orphan cleanup is unsafe');
    expect(client.listObjectsV2).not.toHaveBeenCalled();
    expect(client.deleteObjects).not.toHaveBeenCalled();
    expect(client.deleteObject).not.toHaveBeenCalled();
  });

  it('constructor accepts client first then config', () => {
    const a = new S3StorageAdapter(client, config);
    expect(a.getUrl('k')).toBe('https://cdn.example.com/k');
  });
});

describe('S3 key generator', () => {
  it('generateProductImageKey follows naming convention', () => {
    expect(generateProductImageKey('v1', 'p1', 'main.jpg')).toBe('products/v1/p1/main.jpg');
  });

  it('generateReviewImageKey follows naming convention', () => {
    expect(generateReviewImageKey('p1', 'r1', '01.jpg')).toBe('reviews/p1/r1/01.jpg');
  });

  it('generateInvoiceKey follows naming convention', () => {
    expect(generateInvoiceKey('order123', 2026, 10)).toBe('invoices/2026/10/order123.pdf');
  });

  it('generateTempKey follows naming convention', () => {
    expect(generateTempKey('upload.png')).toBe('temp/upload.png');
  });

  it('sanitizes filenames', () => {
    expect(generateTempKey('../secret.jpg')).toBe('temp/secret.jpg');
    expect(generateTempKey('a b!c.png')).toBe('temp/abc.png');
  });

  it('sanitizeFilename removes path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  });
});
