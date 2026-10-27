import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { LocalStorageAdapter } from './local.adapter';

const storageRoot = path.join(process.cwd(), 'test-storage-dim', 'uploads');

async function createTestImage(width: number, height: number, format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  // Create a simple colored image using sharp
  const img = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }
  });
  
  switch (format) {
    case 'jpeg':
      return img.jpeg({ quality: 80 }).toBuffer();
    case 'png':
      return img.png().toBuffer();
    case 'webp':
      return img.webp({ quality: 80 }).toBuffer();
  }
}

describe('LocalStorageAdapter - Image Dimension Validation', () => {
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    process.env.STORAGE_ROOT = storageRoot;
    try {
      await fs.rm(storageRoot, { recursive: true, force: true });
    } catch {}
    adapter = new LocalStorageAdapter(storageRoot, '/api/v1/uploads');
  });

  describe('validateFile - dimension validation', () => {
    it('should accept JPEG with dimensions >= 800x800', async () => {
      const buffer = await createTestImage(800, 800, 'jpeg');
      const result = await adapter.validateFile(buffer, 'image/jpeg');
      expect(result.valid).toBe(true);
    });

    it('should accept JPEG with dimensions > 800x800', async () => {
      const buffer = await createTestImage(1024, 1024, 'jpeg');
      const result = await adapter.validateFile(buffer, 'image/jpeg');
      expect(result.valid).toBe(true);
    });

    it('should reject JPEG with width < 800', async () => {
      const buffer = await createTestImage(799, 800, 'jpeg');
      const result = await adapter.validateFile(buffer, 'image/jpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/dimension/i);
    });

    it('should reject JPEG with height < 800', async () => {
      const buffer = await createTestImage(800, 799, 'jpeg');
      const result = await adapter.validateFile(buffer, 'image/jpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/dimension/i);
    });

    it('should accept PNG with dimensions >= 800x800', async () => {
      const buffer = await createTestImage(800, 800, 'png');
      const result = await adapter.validateFile(buffer, 'image/png');
      expect(result.valid).toBe(true);
    });

    it('should reject PNG with width < 800', async () => {
      const buffer = await createTestImage(799, 800, 'png');
      const result = await adapter.validateFile(buffer, 'image/png');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/dimension/i);
    });

    it('should reject PNG with height < 800', async () => {
      const buffer = await createTestImage(800, 799, 'png');
      const result = await adapter.validateFile(buffer, 'image/png');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/dimension/i);
    });

    it('should accept WebP with dimensions >= 800x800', async () => {
      const buffer = await createTestImage(800, 800, 'webp');
      const result = await adapter.validateFile(buffer, 'image/webp');
      expect(result.valid).toBe(true);
    });

    it('should reject WebP with width < 800', async () => {
      const buffer = await createTestImage(799, 800, 'webp');
      const result = await adapter.validateFile(buffer, 'image/webp');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/dimension/i);
    });

    it('should reject WebP with height < 800', async () => {
      const buffer = await createTestImage(800, 799, 'webp');
      const result = await adapter.validateFile(buffer, 'image/webp');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/dimension/i);
    });
  });
});