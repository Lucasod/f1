export interface StorageAdapter {
  /**
   * Whether this adapter targets a remote storage backend.
   */
  isRemote?: boolean;

  /**
   * Save a file and return its logical key and public URL
   */
  save(file: Buffer, key: string, contentType: string): Promise<{ url: string; key: string }>;

  /**
   * Delete a file by its logical key
   */
  delete(key: string): Promise<void>;

  /**
   * Get the public URL for a logical key
   */
  getUrl(key: string): string;

  /**
   * Get a signed (presigned) URL for a logical key
   */
  getSignedUrl?(key: string, expiresIn?: number): Promise<string>;

  /**
   * Validate file before saving
   */
  validateFile(buffer: Buffer, contentType: string): Promise<ValidationResult>;

  /**
   * Sanitize a key to prevent path traversal
   * Returns the sanitized key or throws if invalid
   */
  sanitizeKey(key: string): string;

  /**
   * Clean up orphaned files not referenced by the given URLs
   */
  cleanupOrphanedFiles?(referencedUrls: string[]): Promise<{ deletedCount: number; deletedFiles: string[] }>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}