import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { StorageAdapter, ValidationResult } from './storage.interface';
import { config } from '../../config';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_DIMENSION = 800; // Minimum width/height in pixels

export interface CleanupResult {
  deletedCount: number;
  deletedFiles: string[];
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(
    private readonly storageRoot: string = config.storageRoot,
    private readonly publicUrlBase: string = config.storagePublicUrlBase
  ) {}

  sanitizeKey(key: string): string {
    // Prevent path traversal - only allow alphanumeric, dash, underscore, dot, slash
    const sanitized = key.replace(/[^a-zA-Z0-9\-_\.\/]/g, '');
    // Ensure no directory traversal
    if (sanitized.includes('..')) {
      throw new Error('Invalid key: path traversal attempt');
    }
    return sanitized;
  }

  private validateMimeType(contentType: string): ValidationResult {
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`
      };
    }
    return { valid: true };
  }

  private validateFileSize(buffer: Buffer): ValidationResult {
    if (buffer.length > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
      };
    }
    if (buffer.length === 0) {
      return { valid: false, error: 'Empty file' };
    }
    return { valid: true };
  }

  private validateSignature(buffer: Buffer, contentType: string): ValidationResult {
    // Check magic bytes for common image formats
    if (buffer.length < 4) {
      return { valid: false, error: 'File too small to validate' };
    }

    // Full signatures including WebP's complete RIFF + WEBP check
    const signatures: Record<string, number[][]> = {
      'image/jpeg': [[0xFF, 0xD8, 0xFF]],
      'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
      // WebP: RIFF header (4 bytes) + file size (4 bytes) + WEBP (4 bytes) = 12 bytes minimum
      'image/webp': [[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]],
    };

    const expected = signatures[contentType];
    if (!expected) {
      return { valid: true }; // Unknown type, skip signature check
    }

    for (const sig of expected) {
      // For WebP, we only check the fixed bytes (RIFF at 0-3, WEBP at 8-11)
      // The file size bytes at 4-7 can vary, so we check them separately
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        // Skip file size bytes (positions 4-7) for WebP
        if (contentType === 'image/webp' && i >= 4 && i <= 7) {
          continue;
        }
        if (buffer[i] !== sig[i]) {
          match = false;
          break;
        }
      }
      if (match) return { valid: true };
    }

    return { valid: false, error: 'File content does not match declared type' };
  }

  private async validateDimensions(buffer: Buffer, contentType: string): Promise<ValidationResult> {
    try {
      const metadata = await sharp(buffer).metadata();
      const width = metadata.width;
      const height = metadata.height;

      if (width === undefined || height === undefined) {
        return { valid: false, error: 'Could not determine image dimensions' };
      }

      if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
        return {
          valid: false,
          error: `Image dimensions must be at least ${MIN_DIMENSION}x${MIN_DIMENSION}px (received: ${width}x${height}px)`
        };
      }

      return { valid: true };
    } catch (error) {
      // If sharp fails to process the image, it's likely not a valid image
      return { valid: false, error: 'Invalid image format or corrupted file' };
    }
  }

  async validateFile(buffer: Buffer, contentType: string): Promise<ValidationResult> {
    const mimeResult = this.validateMimeType(contentType);
    if (!mimeResult.valid) return mimeResult;

    const sizeResult = this.validateFileSize(buffer);
    if (!sizeResult.valid) return sizeResult;

    // Additional validation: check file signature (magic bytes)
    const signatureResult = this.validateSignature(buffer, contentType);
    if (!signatureResult.valid) return signatureResult;

    // Validate image dimensions
    const dimensionResult = await this.validateDimensions(buffer, contentType);
    if (!dimensionResult.valid) return dimensionResult;

    return { valid: true };
  }

  async save(file: Buffer, key: string, contentType: string): Promise<{ url: string; key: string }> {
    const validation = await this.validateFile(file, contentType);
    if (!validation.valid) {
      throw new Error(validation.error || 'File validation failed');
    }

    const safeKey = this.sanitizeKey(key);
    const filePath = path.join(this.storageRoot, safeKey);

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write file
    await fs.writeFile(filePath, file);

    const url = `${this.publicUrlBase}/${safeKey}`;
    return { url, key: safeKey };
  }

  async delete(key: string): Promise<void> {
    const safeKey = this.sanitizeKey(key);
    const filePath = path.join(this.storageRoot, safeKey);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Clean up empty directories (CR-008)
    try {
      await this.cleanupEmptyDirs(path.dirname(filePath));
    } catch (error) {
      console.error('Cleanup empty dirs error:', { 
        dirPath: path.dirname(filePath), 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  getUrl(key: string): string {
    const safeKey = this.sanitizeKey(key);
    return `${this.publicUrlBase}/${safeKey}`;
  }

  private async cleanupEmptyDirs(dirPath: string): Promise<void> {
    // Don't clean up beyond the storage root
    if (dirPath === this.storageRoot || !dirPath.startsWith(this.storageRoot)) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath);
      if (entries.length === 0) {
        await fs.rmdir(dirPath);
        // Recursively clean up parent directories
        await this.cleanupEmptyDirs(path.dirname(dirPath));
      }
    } catch (error) {
      // Log errors but don't throw
      console.error('Cleanup empty dirs error:', { 
        dirPath, 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Scan storage directory for files not referenced by products or reviews
   * and remove orphaned files.
   * 
   * @param referencedUrls - URLs currently referenced by products and reviews
   * @returns Object with count of deleted files and list of deleted file keys
   */
  async cleanupOrphanedFiles(referencedUrls: string[]): Promise<CleanupResult> {
    const deletedFiles: string[] = [];

    // Convert referenced URLs to keys for comparison
    const referencedKeys = new Set<string>();
    for (const url of referencedUrls) {
      // Extract key from URL (remove publicUrlBase prefix)
      const prefix = `${this.publicUrlBase}/`;
      if (url.startsWith(prefix)) {
        const key = url.slice(prefix.length);
        referencedKeys.add(key);
      }
    }

    // Recursively scan storage directory
    try {
      await this.scanAndCleanup(this.storageRoot, referencedKeys, deletedFiles);
    } catch (error) {
      console.error('Cleanup error:', { 
        dirPath: this.storageRoot, 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    return {
      deletedCount: deletedFiles.length,
      deletedFiles
    };
  }

  private async scanAndCleanup(dirPath: string, referencedKeys: Set<string>, deletedFiles: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.storageRoot, fullPath);
        
        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await this.scanAndCleanup(fullPath, referencedKeys, deletedFiles);
          
          // Clean up empty directories after scanning
          try {
            const remainingEntries = await fs.readdir(fullPath);
            if (remainingEntries.length === 0) {
              await fs.rmdir(fullPath);
            }
          } catch {
            // Ignore errors
          }
        } else if (entry.isFile()) {
          // Check if file is referenced
          if (!referencedKeys.has(relativePath)) {
            // Orphaned file - delete it
            await fs.unlink(fullPath);
            deletedFiles.push(relativePath);
          }
        }
      }
    } catch (error) {
      // Add structured logging for cleanup errors
      console.error('Cleanup error:', { 
        dirPath, 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
}