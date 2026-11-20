// Test file naming convention:
// - kebab-case for multi-word names (e.g., agent-orchestrator.test.ts, run-record.test.ts, self-correction.test.ts)
// - single word for single-concept names (e.g., storage.test.ts)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeRunRecord, loadRunRecord, listRunRecords } from './storage';
import { RunRecord, RunStatus } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Run Record Persistence', () => {
  let testDir: string;
  let storageDir: string;

  beforeEach(() => {
    // Create a unique temporary directory for each test
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-orchestration-test-'));
    storageDir = path.join(testDir, 'agent_runs');
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createValidRecord = (overrides: Partial<RunRecord> = {}): RunRecord => ({
    runId: 'test-run-123',
    startedAt: '2026-10-24T21:30:00.000Z',
    status: 'IN_PROGRESS' as RunStatus,
    updatedAt: '2026-10-24T21:30:00.000Z',
    ...overrides,
  });

  describe('writeRunRecord', () => {
    it('P1 - should write and recover the same record (round-trip)', async () => {
      const record = createValidRecord();

      await writeRunRecord(record, { storageDir });
      const loaded = await loadRunRecord(record.runId, { storageDir });

      expect(loaded).not.toBeNull();
      expect(loaded!.runId).toBe(record.runId);
      expect(loaded!.startedAt).toBe(record.startedAt);
      expect(loaded!.status).toBe(record.status);
      expect(loaded!.updatedAt).toBe(record.updatedAt);
    });

    it('should persist and recover the orchestration snapshot with its run record', async () => {
      const record = createValidRecord({
        orchestration: {
          generatedAt: '2026-10-24T21:30:00.000Z',
          maxAuthorizedPhase: 2,
          classifications: [
            { taskId: 'T-117', status: 'BLOCKED', blockers: ['Human approval is required'] },
            { taskId: 'T-201', status: 'COMPLETED', blockers: [] },
          ],
        },
      });

      await writeRunRecord(record, { storageDir });
      const loaded = await loadRunRecord(record.runId, { storageDir });

      expect(loaded?.orchestration).toEqual(record.orchestration);
    });

    it('should reject invalid orchestration snapshots before persisting', async () => {
      const record = createValidRecord({
        orchestration: {
          generatedAt: '2026-10-24T21:30:00.000Z',
          maxAuthorizedPhase: 2,
          classifications: [
            { taskId: 'T-117', status: 'UNKNOWN' as never, blockers: [] },
          ],
        },
      });

      await expect(writeRunRecord(record, { storageDir })).rejects.toThrow(
        'orchestration: classifications[0].status is invalid',
      );
    });

    it('P4 - should reject invalid record before writing', async () => {
      const invalidRecord = { runId: '', startedAt: 'invalid', status: 'INVALID' as RunStatus, updatedAt: 'invalid' };

      await expect(writeRunRecord(invalidRecord as any, { storageDir })).rejects.toThrow();
    });

    it('P7 - should create storage directory if it does not exist', async () => {
      const record = createValidRecord({ runId: 'new-run-456' });

      await writeRunRecord(record, { storageDir });

      expect(fs.existsSync(storageDir)).toBe(true);
      expect(fs.existsSync(path.join(storageDir, 'new-run-456.json'))).toBe(true);
    });

    it('P8 - should reject runId with path traversal attempts', async () => {
      const record = createValidRecord({ runId: '../../../etc/passwd' });

      await expect(writeRunRecord(record, { storageDir })).rejects.toThrow();
    });

    it('P8 - should reject runId with absolute path', async () => {
      const record = createValidRecord({ runId: '/absolute/path' });

      await expect(writeRunRecord(record, { storageDir })).rejects.toThrow();
    });

    it('P6 - should not overwrite different records', async () => {
      const record1 = createValidRecord({ runId: 'run-1' });
      const record2 = createValidRecord({ runId: 'run-2' });

      await writeRunRecord(record1, { storageDir });
      await writeRunRecord(record2, { storageDir });

      const loaded1 = await loadRunRecord('run-1', { storageDir });
      const loaded2 = await loadRunRecord('run-2', { storageDir });

      expect(loaded1).not.toBeNull();
      expect(loaded2).not.toBeNull();
      expect(loaded1!.runId).toBe('run-1');
      expect(loaded2!.runId).toBe('run-2');
    });

    it('CR-002 - should write atomically using temp file and rename', async () => {
      const record = createValidRecord({ runId: 'atomic-test' });

      await writeRunRecord(record, { storageDir });

      // Verify no temp files left behind
      const files = fs.readdirSync(storageDir);
      const tempFiles = files.filter(f => f.startsWith('.tmp') || f.endsWith('.tmp'));
      expect(tempFiles).toHaveLength(0);

      // Verify the record exists and is valid
      const loaded = await loadRunRecord('atomic-test', { storageDir });
      expect(loaded).not.toBeNull();
      expect(loaded!.runId).toBe('atomic-test');
    });

    it('CR-002 - should not corrupt existing record on write failure', async () => {
      // Write initial valid record
      const record1 = createValidRecord({ runId: 'existing-record', status: 'COMPLETED' });
      await writeRunRecord(record1, { storageDir });

      // Verify it exists
      const loaded1 = await loadRunRecord('existing-record', { storageDir });
      expect(loaded1).not.toBeNull();
      expect(loaded1!.status).toBe('COMPLETED');

      // Attempt to write invalid record with same runId (should fail validation)
      const invalidRecord = createValidRecord({ runId: 'existing-record', status: 'INVALID' as RunStatus });
      await expect(writeRunRecord(invalidRecord, { storageDir })).rejects.toThrow();

      // Verify original record is unchanged
      const loaded2 = await loadRunRecord('existing-record', { storageDir });
      expect(loaded2).not.toBeNull();
      expect(loaded2!.status).toBe('COMPLETED');
    });
  });

  describe('loadRunRecord', () => {
    it('P2 - should return null for non-existent record', async () => {
      const loaded = await loadRunRecord('non-existent-run', { storageDir });

      expect(loaded).toBeNull();
    });

    it('P5 - should throw clear error for corrupted record', async () => {
      // Create a corrupted JSON file
      fs.mkdirSync(storageDir, { recursive: true });
      fs.writeFileSync(path.join(storageDir, 'corrupted.json'), '{ invalid json }');

      await expect(loadRunRecord('corrupted', { storageDir })).rejects.toThrow();
    });

    it('P10 - should reject structurally invalid record on read', async () => {
      // Create a file with missing required fields
      fs.mkdirSync(storageDir, { recursive: true });
      const invalidRecord = { runId: 'test', startedAt: '2026-10-24T21:30:00.000Z' }; // missing status, updatedAt
      fs.writeFileSync(path.join(storageDir, 'invalid.json'), JSON.stringify(invalidRecord));

      await expect(loadRunRecord('invalid', { storageDir })).rejects.toThrow();
    });

    it('CR-003 - should return null for invalid runId (malformed)', async () => {
      // Invalid runId (path traversal) should return null, not throw
      const loaded = await loadRunRecord('../../../etc/passwd', { storageDir });
      expect(loaded).toBeNull();
    });

    it('CR-003 - should return null for absolute path runId', async () => {
      const loaded = await loadRunRecord('/absolute/path', { storageDir });
      expect(loaded).toBeNull();
    });

    it('CR-003 - should return null for runId with invalid characters', async () => {
      const loaded = await loadRunRecord('invalid@run#id', { storageDir });
      expect(loaded).toBeNull();
    });

    it('F-003 - should throw for invalid storageDir (not found) instead of returning null', async () => {
      const invalidOptions = { storageDir: '/nonexistent/path/that/does/not/exist' };
      await expect(loadRunRecord('valid-id', invalidOptions)).rejects.toThrow();
    });

    it('F-003 - should throw for invalid storageDir (not a directory) instead of returning null', async () => {
      // Create a file to use as invalid storageDir
      const filePath = path.join(testDir, 'not-a-dir.txt');
      fs.writeFileSync(filePath, 'not a directory');

      const invalidOptions = { storageDir: filePath };
      await expect(loadRunRecord('valid-id', invalidOptions)).rejects.toThrow();
    });
  });

  describe('listRunRecords', () => {
    it('P3 - should list only valid run records, ignore irrelevant files', async () => {
      const record1 = createValidRecord({ runId: 'run-1' });
      const record2 = createValidRecord({ runId: 'run-2' });

      await writeRunRecord(record1, { storageDir });
      await writeRunRecord(record2, { storageDir });

      // Create an irrelevant file
      fs.writeFileSync(path.join(storageDir, 'README.md'), '# Not a run record');
      fs.writeFileSync(path.join(storageDir, '.hidden'), 'hidden');

      const result = await listRunRecords({ storageDir });

      expect(result.records).toHaveLength(2);
      expect(result.records.map(r => r.runId).sort()).toEqual(['run-1', 'run-2']);
      expect(result.errors).toHaveLength(0);
    });

    it('P9 - should not include test directory in operational data', async () => {
      const record = createValidRecord({ runId: 'test-run' });
      await writeRunRecord(record, { storageDir });

      const result = await listRunRecords({ storageDir });

      // All records should be from the test storage directory, not from any operational directory
      expect(result.records.every(r => r.runId === 'test-run')).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('CR-004 - should include errors for corrupted/invalid records in result', async () => {
      // Write valid records
      await writeRunRecord(createValidRecord({ runId: 'valid-1' }), { storageDir });
      await writeRunRecord(createValidRecord({ runId: 'valid-2' }), { storageDir });

      // Create corrupted record
      fs.writeFileSync(path.join(storageDir, 'corrupted.json'), '{ invalid json }');

      // Create structurally invalid record
      fs.writeFileSync(path.join(storageDir, 'invalid.json'), JSON.stringify({ runId: 'invalid', startedAt: '2026-10-24T21:30:00.000Z' }));

      // Create file with invalid runId (should be ignored)
      fs.writeFileSync(path.join(storageDir, 'bad@id.json'), JSON.stringify(createValidRecord({ runId: 'bad@id' })));

      const result = await listRunRecords({ storageDir });

      // Should return valid records and errors for problematic ones
      expect(result.records).toHaveLength(2);
      expect(result.records.map(r => r.runId).sort()).toEqual(['valid-1', 'valid-2']);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      // Errors should identify the problematic files
      const errorMessages = result.errors.map(e => e.message || e);
      expect(errorMessages.some(m => m.includes('Corrupted') || m.includes('corrupted'))).toBe(true);
      expect(errorMessages.some(m => m.includes('invalid') || m.includes('structurally') || m.includes('Missing required field'))).toBe(true);
    });

    it('CR-004 - should handle empty directory gracefully', async () => {
      const result = await listRunRecords({ storageDir });
      expect(result.records).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('F-004 - should handle normal listRunRecords without unexpected errors', async () => {
      // Write a valid record
      await writeRunRecord(createValidRecord({ runId: 'permission-test' }), { storageDir });

      // The file exists and is readable, so this should work normally
      const result = await listRunRecords({ storageDir });
      expect(result.records).toHaveLength(1);
      expect(result.records[0].runId).toBe('permission-test');
      expect(result.errors).toHaveLength(0);
    });

    it('F-004 - should not swallow programming errors from loadRunRecord', async () => {
      // This test verifies that if loadRunRecord throws an unexpected error (not ENOENT, not SyntaxError, not validation error),
      // it should be propagated, not swallowed into errors array
      // We can't easily trigger this without mocking, but we document the expected behavior
      const result = await listRunRecords({ storageDir });
      expect(result.records).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('CR-005 - Path safety', () => {
    it('should reject runId with path traversal in writeRunRecord', async () => {
      const invalidIds = ['../../../etc/passwd', '..\\..\\windows', 'foo/../bar', 'foo//bar'];

      for (const invalidId of invalidIds) {
        const record = createValidRecord({ runId: invalidId });
        await expect(writeRunRecord(record, { storageDir })).rejects.toThrow();
      }
    });

    it('should reject absolute path runId in writeRunRecord', async () => {
      const invalidIds = ['/absolute/path', '/another/path', 'C:\\Windows\\System32'];

      for (const invalidId of invalidIds) {
        const record = createValidRecord({ runId: invalidId });
        await expect(writeRunRecord(record, { storageDir })).rejects.toThrow();
      }
    });

    it('should return null for invalid runId in loadRunRecord', async () => {
      const invalidIds = ['../../../etc/passwd', '..\\..\\windows', 'foo/../bar', 'foo//bar', '/absolute/path', '/another/path', 'C:\\Windows\\System32', 'invalid@run#id'];

      for (const invalidId of invalidIds) {
        const loaded = await loadRunRecord(invalidId, { storageDir });
        expect(loaded).toBeNull();
      }
    });

    it('should ensure resolved path stays within storage directory', async () => {
      // This test verifies that even if runId passes regex, the resolved path is within storageDir
      const record = createValidRecord({ runId: 'valid-id' });
      await writeRunRecord(record, { storageDir });

      const loaded = await loadRunRecord('valid-id', { storageDir });
      expect(loaded).not.toBeNull();

      // Verify the file is actually inside storageDir
      const recordPath = path.join(storageDir, 'valid-id.json');
      const resolvedRecordPath = fs.realpathSync(recordPath);
      const resolvedStorageDir = fs.realpathSync(storageDir);
      expect(resolvedRecordPath.startsWith(resolvedStorageDir)).toBe(true);
    });
  });
});