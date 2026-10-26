// Test file naming convention:
// - kebab-case for multi-word names (e.g., agent-orchestrator.test.ts, run-record.test.ts, self-correction.test.ts)
// - single word for single-concept names (e.g., storage.test.ts)
import { describe, it, expect } from 'vitest';
import { validateRunRecord, createRunRecord, RunStatus } from '../src/index';

describe('Run Record Contract', () => {
  const validBaseRecord = {
    runId: 'test-run-123',
    startedAt: '2026-10-24T21:30:00.000Z',
    status: 'IN_PROGRESS' as RunStatus,
    updatedAt: '2026-10-24T21:30:00.000Z',
  };

  describe('validateRunRecord', () => {
    it('should accept a valid record with all required fields', () => {
      const result = validateRunRecord(validBaseRecord);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept a valid record with optional fields', () => {
      const record = {
        ...validBaseRecord,
        branch: 'feature/test',
        baseCommit: 'abc123',
        scope: 'Test scope',
        nextAction: 'Run tests',
      };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(true);
    });

    it('should reject record missing runId', () => {
      const { runId, ...record } = validBaseRecord;
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: runId');
    });

    it('should reject record missing startedAt', () => {
      const { startedAt, ...record } = validBaseRecord;
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: startedAt');
    });

    it('should reject record missing status', () => {
      const { status, ...record } = validBaseRecord;
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: status');
    });

    it('should reject record missing updatedAt', () => {
      const { updatedAt, ...record } = validBaseRecord;
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: updatedAt');
    });

    it('should reject record with empty runId', () => {
      const record = { ...validBaseRecord, runId: '' };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('runId must be a non-empty string');
    });

    it('should reject record with invalid ISO 8601 startedAt', () => {
      const record = { ...validBaseRecord, startedAt: 'not-a-date' };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('startedAt must be a valid ISO 8601 date string');
    });

    it('should reject record with invalid ISO 8601 updatedAt', () => {
      const record = { ...validBaseRecord, updatedAt: 'not-a-date' };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('updatedAt must be a valid ISO 8601 date string');
    });

    it('should reject record with invalid status', () => {
      const record = { ...validBaseRecord, status: 'INVALID_STATUS' as const };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('status must be one of: IN_PROGRESS, COMPLETED, BLOCKED, PAUSED');
    });

    it('should reject null record', () => {
      const result = validateRunRecord(null);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Record must be a non-null object');
    });

    it('should reject undefined record', () => {
      const result = validateRunRecord(undefined);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Record must be a non-null object');
    });

    it('should reject record with non-string branch', () => {
      const record = { ...validBaseRecord, branch: 123 as unknown };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('branch must be a string or undefined');
    });

    it('should reject record with non-string baseCommit', () => {
      const record = { ...validBaseRecord, baseCommit: 123 as unknown };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('baseCommit must be a string or undefined');
    });

    it('should reject record with non-string scope', () => {
      const record = { ...validBaseRecord, scope: 123 as unknown };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('scope must be a string or undefined');
    });

    it('should reject record with non-string nextAction', () => {
      const record = { ...validBaseRecord, nextAction: 123 as unknown };
      const result = validateRunRecord(record);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('nextAction must be a string or undefined');
    });
  });

  describe('createRunRecord', () => {
    it('should create a valid record with required fields', () => {
      const record = createRunRecord({
        runId: 'test-run-456',
        startedAt: '2026-10-24T21:30:00.000Z',
        status: 'IN_PROGRESS',
      });

      expect(record.runId).toBe('test-run-456');
      expect(record.startedAt).toBe('2026-10-24T21:30:00.000Z');
      expect(record.status).toBe('IN_PROGRESS');
      expect(record.updatedAt).toBeDefined();
      expect(() => new Date(record.updatedAt)).not.toThrow();
    });

    it('should create a record with optional fields', () => {
      const record = createRunRecord({
        runId: 'test-run-789',
        startedAt: '2026-10-24T21:30:00.000Z',
        status: 'IN_PROGRESS',
        branch: 'feature/test',
        baseCommit: 'abc123',
        scope: 'Test scope',
        nextAction: 'Run tests',
      });

      expect(record.branch).toBe('feature/test');
      expect(record.baseCommit).toBe('abc123');
      expect(record.scope).toBe('Test scope');
      expect(record.nextAction).toBe('Run tests');
    });

    it('should create records with valid updatedAt timestamps', () => {
      const record1 = createRunRecord({
        runId: 'test-1',
        startedAt: '2026-10-24T21:30:00.000Z',
        status: 'IN_PROGRESS',
      });
      const record2 = createRunRecord({
        runId: 'test-2',
        startedAt: '2026-10-24T21:30:00.000Z',
        status: 'IN_PROGRESS',
      });

      expect(record1.updatedAt).toBeDefined();
      expect(record2.updatedAt).toBeDefined();
      expect(() => new Date(record1.updatedAt)).not.toThrow();
      expect(() => new Date(record2.updatedAt)).not.toThrow();
      expect(record1.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(record2.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('RunStatus type', () => {
    it('should allow valid statuses', () => {
      const validStatuses: RunStatus[] = ['IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'PAUSED'];
      for (const status of validStatuses) {
        const record = createRunRecord({
          runId: 'test',
          startedAt: '2026-10-24T21:30:00.000Z',
          status,
        });
        expect(record.status).toBe(status);
      }
    });
  });
});