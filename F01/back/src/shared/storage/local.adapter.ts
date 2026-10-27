import { promises as fs } from 'fs';
import path from 'path';
import { StorageAdapter, ValidationResult } from './storage.interface';
import { config } from '../../config';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_DIMENSIONS = 800; // Not enforced at upload without image processing lib

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

  async validateFile(buffer: Buffer, contentType: string): Promise<ValidationResult> {
    const mimeResult = this.validateMimeType(contentType);
    if (!mimeResult.valid) return mimeResult;

    const sizeResult = this.validateFileSize(buffer);
    if (!sizeResult.valid) return sizeResult;

    // Additional validation: check file signature (magic bytes)
    const signatureResult = this.validateSignature(buffer, contentType);
    if (!signatureResult.valid) return signatureResult;

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
    await this.cleanupEmptyDirs(path.dirname(filePath));
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
      // Ignore errors (directory might not exist, or not empty)
    }
  }
}