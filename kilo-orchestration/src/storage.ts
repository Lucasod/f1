import { RunRecord, RunRecordValidationResult, RunStatus } from './types.js';
import { validateRunRecord } from './validation.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface StorageOptions {
  storageDir: string;
}

export interface ListResult {
  records: RunRecord[];
  errors: ListError[];
}

export interface ListError {
  file: string;
  message: string;
  runId?: string;
}

const isValidRunId = (runId: string): boolean => {
  // Prevent path traversal and absolute paths
  if (runId.includes('..') || path.isAbsolute(runId)) {
    return false;
  }
  // Only allow alphanumeric, hyphen, underscore
  return /^[a-zA-Z0-9_-]+$/.test(runId);
};

const getRecordPath = (storageDir: string, runId: string): string => {
  return path.join(storageDir, `${runId}.json`);
};

const getTempPath = (storageDir: string, runId: string): string => {
  const randomSuffix = crypto.randomBytes(8).toString('hex');
  return path.join(storageDir, `.tmp.${runId}.${randomSuffix}.json`);
};

const validateAndResolvePath = (storageDir: string, runId: string): string => {
  if (!isValidRunId(runId)) {
    throw new Error('Invalid runId: must be alphanumeric with hyphens/underscores only, no path traversal');
  }

  const recordPath = getRecordPath(storageDir, runId);
  const resolvedRecordPath = path.resolve(recordPath);
  const resolvedStorageDir = path.resolve(storageDir);

  // Ensure the resolved path is within the storage directory
  if (!resolvedRecordPath.startsWith(resolvedStorageDir + path.sep) &&
      resolvedRecordPath !== resolvedStorageDir) {
    throw new Error('Invalid runId: path traversal detected');
  }

  return recordPath;
};

export async function writeRunRecord(record: RunRecord, options: StorageOptions): Promise<void> {
  // Validate the record before writing
  const validation = validateRunRecord(record);
  if (!validation.isValid) {
    throw new Error(`Invalid run record: ${validation.errors.join(', ')}`);
  }

  // Validate runId for security
  const recordPath = validateAndResolvePath(options.storageDir, record.runId);
  const tempPath = getTempPath(options.storageDir, record.runId);
  const resolvedTempPath = path.resolve(tempPath);
  const resolvedStorageDir = path.resolve(options.storageDir);

  // Ensure temp path is also within storage directory
  if (!resolvedTempPath.startsWith(resolvedStorageDir + path.sep) &&
      resolvedTempPath !== resolvedStorageDir) {
    throw new Error('Internal error: temp path outside storage directory');
  }

  // Ensure storage directory exists
  await fs.mkdir(options.storageDir, { recursive: true });

  const content = JSON.stringify(record, null, 2);

  // Write to temp file first
  await fs.writeFile(tempPath, content, 'utf-8');

  // Atomically rename temp to final destination
  await fs.rename(tempPath, recordPath);
}

export async function loadRunRecord(runId: string, options: StorageOptions): Promise<RunRecord | null> {
  // For invalid runId format, return null (not found) instead of throwing
  if (!isValidRunId(runId)) {
    return null;
  }

  let recordPath: string;
  try {
    recordPath = validateAndResolvePath(options.storageDir, runId);
  } catch (error) {
    // Path validation failed (e.g., storageDir invalid, path traversal detected)
    // Propagate the error instead of treating as "not found"
    throw error;
  }

  // Verify storageDir exists and is a directory BEFORE attempting to read
  try {
    const stats = await fs.stat(options.storageDir);
    if (!stats.isDirectory()) {
      throw new Error(`Storage path is not a directory: ${options.storageDir}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Check if the parent directory exists - if so, this is a valid but empty storage dir
      const parentDir = path.dirname(options.storageDir);
      try {
        const parentStats = await fs.stat(parentDir);
        if (parentStats.isDirectory()) {
          // Parent exists, so storageDir is a valid path that just hasn't been created yet
          // Treat as empty storage directory
          return null;
        }
      } catch {
        // Parent doesn't exist either - invalid path
      }
      throw new Error(`Storage directory does not exist: ${options.storageDir}`);
    }
    throw error;
  }

  // Now read the record file - ENOENT here means record doesn't exist
  try {
    const content = await fs.readFile(recordPath, 'utf-8');
    const record = JSON.parse(content) as RunRecord;

    // Validate the loaded record
    const validation = validateRunRecord(record);
    if (!validation.isValid) {
      throw new Error(`Corrupted or invalid record: ${validation.errors.join(', ')}`);
    }

    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Corrupted record file: invalid JSON`);
    }
    throw error;
  }
}

export async function listRunRecords(options: StorageOptions): Promise<ListResult> {
  const records: RunRecord[] = [];
  const errors: ListError[] = [];

  try {
    await fs.mkdir(options.storageDir, { recursive: true });
  } catch {
    // Directory might already exist, that's fine
  }

  let files: string[];
  try {
    files = await fs.readdir(options.storageDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { records: [], errors: [] };
    }
    throw error;
  }

  for (const file of files) {
    // Only process .json files
    if (!file.endsWith('.json')) {
      continue;
    }

    // Skip temp files
    if (file.startsWith('.tmp.')) {
      continue;
    }

    const runId = file.slice(0, -5); // Remove .json extension

    // Validate runId format
    if (!isValidRunId(runId)) {
      errors.push({
        file,
        message: `Invalid runId format: ${runId}`,
        runId,
      });
      continue;
    }

    try {
      const record = await loadRunRecord(runId, options);
      if (record !== null) {
        records.push(record);
      }
    } catch (error) {
      // Expected errors that should be reported in the errors array:
      // - Corrupted JSON (SyntaxError or "Corrupted record file" error)
      // - Structurally invalid record (validation errors from validateRunRecord)
      // - Other validation errors from loadRunRecord
      //
      // Unexpected errors that should be re-thrown:
      // - Permission errors (EACCES, EPERM)
      // - I/O errors (EIO, etc.)
      // - Programming errors (TypeError, ReferenceError, etc.)
      // - Path validation errors from validateAndResolvePath (should have been caught earlier)

      const isExpectedError =
        error instanceof SyntaxError ||  // Corrupted JSON
        (error instanceof Error && (
          error.message.includes('Corrupted or invalid record') ||  // Validation error
          error.message.includes('Corrupted record file') ||  // Corrupted JSON wrapped
          error.message.includes('Invalid run record')  // Validation error from writeRunRecord
        ));

      if (isExpectedError) {
        errors.push({
          file,
          message: error instanceof Error ? error.message : String(error),
          runId,
        });
      } else {
        // Re-throw unexpected errors (permission, I/O, programming errors)
        throw error;
      }
    }
  }

  return { records, errors };
}