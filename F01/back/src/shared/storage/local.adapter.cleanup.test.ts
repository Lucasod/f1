import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { LocalStorageAdapter } from './local.adapter';
import sharp from 'sharp';

const storageRoot = path.join(process.cwd(), 'test-storage-cleanup', 'uploads');

async function createTestImage(width: number = 800, height: number = 800, format: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<Buffer> {
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

describe('LocalStorageAdapter - Orphaned Upload Cleanup', () => {
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    process.env.STORAGE_ROOT = storageRoot;
    try {
      await fs.rm(storageRoot, { recursive: true, force: true });
    } catch {}
    adapter = new LocalStorageAdapter(storageRoot, '/api/v1/uploads');
  });

  describe('cleanupOrphanedFiles', () => {
    it('should not delete files that are referenced by products', async () => {
      // Create a product-referenced file
      const buffer = await createTestImage(800, 800, 'jpeg');
      const productKey = 'products/vendor1/product1/main.jpg';
      await adapter.save(buffer, productKey, 'image/jpeg');

      // Create an orphaned file
      const orphanKey = 'products/vendor1/product1/gallery/01.jpg';
      await adapter.save(buffer, orphanKey, 'image/jpeg');

      // Create another orphaned file in a different folder
      const orphanKey2 = 'products/vendor2/product2/main.jpg';
      await adapter.save(buffer, orphanKey2, 'image/jpeg');

      // Simulate product references (only productKey is referenced)
      const referencedUrls = [
        adapter.getUrl(productKey)
      ];

      // Run cleanup
      const result = await adapter.cleanupOrphanedFiles(referencedUrls);

      // Check that referenced file still exists
      const productExists = await fs.access(path.join(storageRoot, productKey)).then(() => true).catch(() => false);
      expect(productExists).toBe(true);

      // Check that orphaned files were deleted
      const orphanExists = await fs.access(path.join(storageRoot, orphanKey)).then(() => true).catch(() => false);
      expect(orphanExists).toBe(false);

      const orphanExists2 = await fs.access(path.join(storageRoot, orphanKey2)).then(() => true).catch(() => false);
      expect(orphanExists2).toBe(false);

      // Check result
      expect(result.deletedCount).toBe(2);
      expect(result.deletedFiles).toContain(orphanKey);
      expect(result.deletedFiles).toContain(orphanKey2);
    });

    it('should not delete files when no products exist (all files are orphaned)', async () => {
      // Create some files
      const buffer = await createTestImage(800, 800, 'jpeg');
      await adapter.save(buffer, 'products/vendor1/product1/main.jpg', 'image/jpeg');
      await adapter.save(buffer, 'products/vendor1/product1/gallery/01.jpg', 'image/jpeg');
      await adapter.save(buffer, 'products/vendor2/product2/main.jpg', 'image/jpeg');

      // Run cleanup with no referenced URLs
      const result = await adapter.cleanupOrphanedFiles([]);

      // All files should be deleted
      const files = await fs.readdir(storageRoot, { recursive: true });
      expect(files.length).toBe(0);

      expect(result.deletedCount).toBe(3);
    });

    it('should handle empty storage directory', async () => {
      const result = await adapter.cleanupOrphanedFiles([]);
      expect(result.deletedCount).toBe(0);
      expect(result.deletedFiles).toEqual([]);
    });

    it('should only scan within storage root', async () => {
      // Create a file outside storage root (should not happen but safety check)
      const buffer = await createTestImage(800, 800, 'jpeg');
      await adapter.save(buffer, 'products/vendor1/product1/main.jpg', 'image/jpeg');

      const result = await adapter.cleanupOrphanedFiles([]);
      
      // Should only affect files within storage root
      expect(result.deletedCount).toBe(1);
    });

    it('should return deleted file keys in result', async () => {
      const buffer = await createTestImage(800, 800, 'jpeg');
      const key1 = 'products/vendor1/product1/main.jpg';
      const key2 = 'products/vendor1/product1/gallery/01.jpg';
      await adapter.save(buffer, key1, 'image/jpeg');
      await adapter.save(buffer, key2, 'image/jpeg');

      const result = await adapter.cleanupOrphanedFiles([]);

      expect(result.deletedFiles).toEqual(expect.arrayContaining([key1, key2]));
    });
  });
});