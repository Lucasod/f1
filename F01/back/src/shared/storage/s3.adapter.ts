import sharp from 'sharp';
import { StorageAdapter, ValidationResult } from './storage.interface';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MIN_DIMENSION = 800; // Minimum width/height in pixels

export interface S3StorageConfig {
  bucket: string;
  region: string;
  publicUrlBase: string;
  storageClass?: string;
  client?: S3ClientInterface;
}

export interface PutObjectParams {
  Bucket: string;
  Key: string;
  Body: Buffer;
  ContentType: string;
  StorageClass?: string;
}

export interface DeleteObjectParams {
  Bucket: string;
  Key: string;
}

export interface GetSignedUrlParams {
  Bucket: string;
  Key: string;
  Expires?: number;
}

export interface S3ClientInterface {
  putObject(params: PutObjectParams): Promise<any>;
  deleteObject(params: DeleteObjectParams): Promise<any>;
  getSignedUrl(params: GetSignedUrlParams | string, expiresIn?: number): Promise<string> | string;
  listObjectsV2?(params: { Bucket: string; Prefix?: string; ContinuationToken?: string; MaxKeys?: number }): Promise<any>;
  deleteObjects?(params: { Bucket: string; Delete: { Objects: { Key: string }[] } }): Promise<any>;
}

export type S3Client = S3ClientInterface;

function isConfig(value: any): value is S3StorageConfig {
  return !!value && typeof value === 'object' && (typeof value.bucket === 'string' || typeof value.publicUrlBase === 'string');
}

export class S3StorageAdapter implements StorageAdapter {
  isRemote = true;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicUrlBase: string;
  private readonly storageClass: string;
  private readonly client: S3ClientInterface;

  constructor(
    first: string | S3StorageConfig | S3ClientInterface,
    second?: string | S3StorageConfig | S3ClientInterface,
    third?: string | S3ClientInterface,
    fourth?: string | S3ClientInterface,
    fifth?: S3ClientInterface
  ) {
    let config: S3StorageConfig;
    let client: S3ClientInterface | undefined;

    if (typeof first === 'string') {
      // Positional constructor: bucket, region, publicUrlBase, storageClass?, client?
      config = {
        bucket: first,
        region: (second as string) || '',
        publicUrlBase: (third as string) || '',
        storageClass: typeof fourth === 'string' ? fourth : undefined,
      };
      client = (typeof fourth === 'object' ? (fourth as S3ClientInterface) : undefined) || fifth;
    } else if (isConfig(first)) {
      config = first as S3StorageConfig;
      client = (config as any).client || (config as any).s3Client || (config as any).s3 || (second as S3ClientInterface);
    } else {
      config = second as S3StorageConfig;
      client = first as S3ClientInterface;
      client = client || (config as any).client || (config as any).s3Client || (config as any).s3;
    }

    // If storageClass passed as object? handle client in second for config case already

    this.bucket = config.bucket;
    this.region = config.region;
    this.publicUrlBase = config.publicUrlBase;
    this.storageClass = config.storageClass || 'STANDARD';
    this.client = client as S3ClientInterface;
  }

  sanitizeKey(key: string): string {
    const sanitized = key.replace(/[^a-zA-Z0-9\-_\.\/]/g, '');
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
    if (buffer.length < 4) {
      return { valid: false, error: 'File too small to validate' };
    }

    const signatures: Record<string, number[][]> = {
      'image/jpeg': [[0xFF, 0xD8, 0xFF]],
      'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
      'image/webp': [[0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]],
    };

    const expected = signatures[contentType];
    if (!expected) {
      return { valid: true };
    }

    for (const sig of expected) {
      let match = true;
      for (let i = 0; i < sig.length; i++) {
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
      return { valid: false, error: 'Invalid image format or corrupted file' };
    }
  }

  async validateFile(buffer: Buffer, contentType: string): Promise<ValidationResult> {
    const mimeResult = this.validateMimeType(contentType);
    if (!mimeResult.valid) return mimeResult;

    const sizeResult = this.validateFileSize(buffer);
    if (!sizeResult.valid) return sizeResult;

    const signatureResult = this.validateSignature(buffer, contentType);
    if (!signatureResult.valid) return signatureResult;

    const dimensionResult = await this.validateDimensions(buffer, contentType);
    if (!dimensionResult.valid) return dimensionResult;

    return { valid: true };
  }

  async save(file: Buffer, key: string, contentType: string): Promise<{ url: string; key: string }> {
    let validation: ValidationResult;
    if (contentType === 'application/pdf') {
      if (file.length === 0) {
        validation = { valid: false, error: 'Empty file' };
      } else if (file.length > 10 * 1024 * 1024) {
        validation = { valid: false, error: 'File size exceeds maximum' };
      } else {
        validation = { valid: true };
      }
    } else {
      validation = await this.validateFile(file, contentType);
    }
    if (!validation.valid) {
      throw new Error(validation.error || 'File validation failed');
    }

    const safeKey = this.sanitizeKey(key);

    await this.client.putObject({
      Bucket: this.bucket,
      Key: safeKey,
      Body: file,
      ContentType: contentType,
      StorageClass: this.storageClass,
    });

    const url = `${this.publicUrlBase}/${safeKey}`;
    return { url, key: safeKey };
  }

  async delete(key: string): Promise<void> {
    const safeKey = this.sanitizeKey(key);
    await this.client.deleteObject({
      Bucket: this.bucket,
      Key: safeKey,
    });
  }

  getUrl(key: string): string {
    const safeKey = this.sanitizeKey(key);
    return `${this.publicUrlBase}/${safeKey}`;
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const safeKey = this.sanitizeKey(key);
    const result = this.client.getSignedUrl({ Bucket: this.bucket, Key: safeKey, Expires: expiresIn }, expiresIn);
    if (typeof result === 'string') return result;
    return await result;
  }

  async cleanupOrphanedFiles(referencedUrls: string[]): Promise<{ deletedCount: number; deletedFiles: string[] }> {
    const deletedFiles: string[] = [];
    let deletedCount = 0;
    try {
      const referencedKeys = new Set<string>();
      const prefix = `${this.publicUrlBase}/`;
      for (const url of referencedUrls) {
        if (typeof url === 'string' && url.startsWith(prefix)) {
          referencedKeys.add(url.slice(prefix.length));
        }
      }

      if (typeof this.client.listObjectsV2 !== 'function') {
        return { deletedCount: 0, deletedFiles: [] };
      }

      const allKeys: string[] = [];
      const scanPrefixes = ['products/', 'reviews/'];
      for (const scanPrefix of scanPrefixes) {
        let continuationToken: string | undefined;
        do {
          const res = await this.client.listObjectsV2({
            Bucket: this.bucket,
            Prefix: scanPrefix,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          });
          const contents = (res && Array.isArray(res.Contents)) ? res.Contents : [];
          for (const item of contents) {
            if (item && typeof item.Key === 'string') {
              allKeys.push(item.Key);
            }
          }
          continuationToken = res && res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (continuationToken);
      }

      const unreferenced = allKeys.filter((key) => !referencedKeys.has(key));

      if (unreferenced.length === 0) {
        return { deletedCount: deletedFiles.length, deletedFiles };
      }

      if (typeof this.client.deleteObjects === 'function') {
        const batchSize = 1000;
        for (let i = 0; i < unreferenced.length; i += batchSize) {
          const batch = unreferenced.slice(i, i + batchSize);
          await this.client.deleteObjects({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((key) => ({ Key: key })) },
          });
          deletedFiles.push(...batch);
          deletedCount = deletedFiles.length;
        }
      } else {
        for (const key of unreferenced) {
          await this.client.deleteObject({ Bucket: this.bucket, Key: key });
          deletedFiles.push(key);
          deletedCount = deletedFiles.length;
        }
      }
    } catch (error) {
      console.error('S3 cleanup error:', error instanceof Error ? error.message : String(error));
    }

    return { deletedCount, deletedFiles };
  }
}
