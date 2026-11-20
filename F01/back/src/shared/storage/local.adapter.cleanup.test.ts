import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { LocalStorageAdapter } from './local.adapter';
import sharp from 'sharp';

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
  let storageRoot = '';

  beforeEach(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-cleanup-test-'));
    adapter = new LocalStorageAdapter(storageRoot, '/api/v1/uploads');
  });

  afterEach(async () => {
    if (storageRoot) await fs.rm(storageRoot, { recursive: true, force: true });
    storageRoot = '';
  });

  describe('cleanupOrphanedFiles', () => {
    it('should not delete files that are referenced by products', async () => {
      // Create a product-referenced file
      const buffer = await createTestImage(800, 800, 'jpeg');
      const productKey = 'products/vendor1/product1/main.jpg';
      await adapter.save(buffer, productKey, 'image/jpeg');

      // Create an orphaned file
      const orphanImagePath = 'products/vendor1/product1/gallery/01.jpg';
      await adapter.save(buffer, orphanImagePath, 'image/jpeg');

      // Create another orphaned file in a different folder
      const orphanKey2 = 'products/vendor2/product2/main.jpg';
      await adapter.save(buffer, orphanKey2, 'image/jpeg');

      // Simulate product references (only productKey is referenced)
      const referencedUrls = [
        adapter.getUrl(productKey)
      ];

      // A snapshot cannot prove that any object is safe to delete.
      await expect(adapter.cleanupOrphanedFiles(referencedUrls)).rejects.toThrow('Local orphan cleanup is unsafe');

      // Check that referenced file still exists
      const productExists = await fs.access(path.join(storageRoot, productKey)).then(() => true).catch(() => false);
      expect(productExists).toBe(true);

      // Files that appear orphaned can be in flight or use historical URL bases.
      const orphanExists = await fs.access(path.join(storageRoot, orphanImagePath)).then(() => true).catch(() => false);
      expect(orphanExists).toBe(true);

      const orphanExists2 = await fs.access(path.join(storageRoot, orphanKey2)).then(() => true).catch(() => false);
      expect(orphanExists2).toBe(true);
    });

    it('should not delete files when no products exist (all files are orphaned)', async () => {
      // Create some files
      const buffer = await createTestImage(800, 800, 'jpeg');
      await adapter.save(buffer, 'products/vendor1/product1/main.jpg', 'image/jpeg');
      await adapter.save(buffer, 'products/vendor1/product1/gallery/01.jpg', 'image/jpeg');
      await adapter.save(buffer, 'products/vendor2/product2/main.jpg', 'image/jpeg');

      // Run cleanup with no referenced URLs
      await expect(adapter.cleanupOrphanedFiles([])).rejects.toThrow('Local orphan cleanup is unsafe');

      // An empty snapshot does not prove files are unreferenced.
      const files = await fs.readdir(storageRoot, { recursive: true });
      expect(files).toEqual(expect.arrayContaining(['products/vendor1/product1/main.jpg', 'products/vendor1/product1/gallery/01.jpg', 'products/vendor2/product2/main.jpg']));
    });

    it('should handle empty storage directory', async () => {
      await expect(adapter.cleanupOrphanedFiles([])).rejects.toThrow('Local orphan cleanup is unsafe');
    });

    it('should only scan within storage root', async () => {
      // Create a file outside storage root (should not happen but safety check)
      const buffer = await createTestImage(800, 800, 'jpeg');
      await adapter.save(buffer, 'products/vendor1/product1/main.jpg', 'image/jpeg');

      await expect(adapter.cleanupOrphanedFiles([])).rejects.toThrow('Local orphan cleanup is unsafe');
      
      await expect(fs.access(path.join(storageRoot, 'products/vendor1/product1/main.jpg'))).resolves.toBeUndefined();
    });

    it('does not delete files or report a successful cleanup', async () => {
      const buffer = await createTestImage(800, 800, 'jpeg');
      const key1 = 'products/vendor1/product1/main.jpg';
      const key2 = 'products/vendor1/product1/gallery/01.jpg';
      await adapter.save(buffer, key1, 'image/jpeg');
      await adapter.save(buffer, key2, 'image/jpeg');

      await expect(adapter.cleanupOrphanedFiles([])).rejects.toThrow('Local orphan cleanup is unsafe');
      await expect(fs.access(path.join(storageRoot, key1))).resolves.toBeUndefined();
      await expect(fs.access(path.join(storageRoot, key2))).resolves.toBeUndefined();
    });
  });
});
