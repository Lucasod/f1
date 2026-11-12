// Test file naming convention:
// - kebab-case for multi-word names (e.g., agent-orchestrator.test.ts, run-record.test.ts, self-correction.test.ts)
// - single word for single-concept names (e.g., storage.test.ts)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SelfCorrectionEngine } from './correction-engine';
import {
  FailureCategory,
  CorrectionStatus,
  SelfCorrectionConfig,
} from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SelfCorrectionEngine', () => {
  let engine: SelfCorrectionEngine;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-self-correction-test-'));
    engine = new SelfCorrectionEngine('test-run-123');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createValidConfig = (overrides: Partial<SelfCorrectionConfig> = {}): SelfCorrectionConfig => ({
    maxAttemptsPerFailure: 3,
    maxTotalAttempts: 10,
    allowedCorrectionPaths: ['.kilo/orchestration/src/', '.kilo/orchestration/tests/'],
    blockedActions: ['chmod', 'chown', 'git push', 'git commit', 'npm publish'],
    requireReviewFor: ['code-reviewer.md', 'universal-rules.md', 'project-rules.md', 'autonomous-execution.md'],
    ...overrides,
  });

  describe('Engine Initialization', () => {
    it('should create engine with valid runId', () => {
      const engine = new SelfCorrectionEngine('test-run-456');
      const state = engine.getState();
      expect(state.runId).toBe('test-run-456');
      expect(state.failures).toHaveLength(0);
      expect(state.corrections).toHaveLength(0);
      expect(state.maxAttemptsPerFailure).toBe(3);
      expect(state.totalAttempts).toBe(0);
    });

    it('should accept custom config', () => {
      const config = createValidConfig({ maxAttemptsPerFailure: 5, maxTotalAttempts: 20 });
      const engine = new SelfCorrectionEngine('test-run', config);
      const state = engine.getState();
      expect(state.maxAttemptsPerFailure).toBe(5);
      const configResult = engine.getConfig();
      expect(configResult.maxTotalAttempts).toBe(20);
    });

    it('should serialize and deserialize state', () => {
      engine.recordFailure('TRANSIENT', 'Test failure', { key: 'value' });
      const json = engine.toJSON();
      const restored = SelfCorrectionEngine.fromJSON(json);
      const state = restored.getState();
      expect(state.runId).toBe('test-run-123');
      expect(state.failures).toHaveLength(1);
    });

    it('should preserve safety limits when restoring a custom configuration', () => {
      const customEngine = new SelfCorrectionEngine('custom-run', createValidConfig({
        maxAttemptsPerFailure: 5,
        maxTotalAttempts: 2,
      }));
      const restored = SelfCorrectionEngine.fromJSON(customEngine.toJSON());

      expect(restored.getConfig().maxAttemptsPerFailure).toBe(5);
      expect(restored.getConfig().maxTotalAttempts).toBe(2);
    });

    it('should not expose mutable internal state or configuration', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Test failure', {});
      const state = engine.getState();
      state.failures[0].attempt = 99;
      state.failures.length = 0;
      const config = engine.getConfig();
      config.allowedCorrectionPaths.push('back/src/');

      expect(engine.getFailure(failure.id)?.attempt).toBe(1);
      expect(engine.getState().failures).toHaveLength(1);
      expect(engine.isActionAuthorized('edit', 'back/src/main.ts')).toBe(false);
    });
  });

  describe('Failure Recording', () => {
    it('should record a transient failure', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Network timeout', { endpoint: '/api/test' });
      expect(failure.id).toMatch(/^fail-/);
      expect(failure.category).toBe('TRANSIENT');
      expect(failure.message).toBe('Network timeout');
      expect(failure.context).toEqual({ endpoint: '/api/test' });
      expect(failure.attempt).toBe(1);
      expect(failure.maxAttempts).toBe(3);
    });

    it('should record a deterministic test/build failure', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test failed: expected 1 got 2', { test: 'test-add' });
      expect(failure.category).toBe('DETERMINISTIC_TEST_BUILD');
      expect(failure.message).toContain('Test failed');
    });

    it('should record a configuration failure', () => {
      const failure = engine.recordFailure('CONFIGURATION', 'Invalid config value', { key: 'maxAttempts', value: 0 });
      expect(failure.category).toBe('CONFIGURATION');
    });

    it('should record a persistence integrity failure', () => {
      const failure = engine.recordFailure('PERSISTENCE_INTEGRITY', 'Corrupted record', { runId: 'run-123' });
      expect(failure.category).toBe('PERSISTENCE_INTEGRITY');
    });

    it('should record a permission policy failure', () => {
      const failure = engine.recordFailure('PERMISSION_POLICY', 'Unauthorized access', { path: 'secret.key' });
      expect(failure.category).toBe('PERMISSION_POLICY');
    });

    it('should record an unknown failure', () => {
      const failure = engine.recordFailure('UNKNOWN', 'Something went wrong', {});
      expect(failure.category).toBe('UNKNOWN');
    });

    it('should reject invalid failure category', () => {
      expect(() => engine.recordFailure('INVALID' as any, 'Test', {})).toThrow();
    });

    it('should increment attempt counter on each failure', () => {
      engine.recordFailure('TRANSIENT', 'First', {});
      engine.recordFailure('TRANSIENT', 'Second', {});
      const state = engine.getState();
      expect(state.failures).toHaveLength(2);
      expect(state.totalAttempts).toBe(0); // Only corrections increment totalAttempts
    });
  });

  describe('Correction Attempts', () => {
    beforeEach(() => {
      engine.recordFailure('TRANSIENT', 'Test failure', { key: 'value' });
    });

    it('should allow correction attempt within limits', () => {
      const failure = engine.getFailuresByCategory('TRANSIENT')[0];
      const attempt = engine.attemptCorrection(failure.id, 'retry', 'Retry operation');
      expect(attempt.failureId).toBe(failure.id);
      expect(attempt.attempt).toBe(1);
      expect(attempt.action).toBe('retry');
      expect(attempt.authorized).toBe(true);
      expect(attempt.startedAt).toBeDefined();
    });

    it('should reject correction when max attempts reached', () => {
      const failure = engine.getFailuresByCategory('TRANSIENT')[0];
      // Max attempts is 3, so we need to attempt 3 times first
      for (let i = 0; i < 3; i++) {
        engine.attemptCorrection(failure.id, 'retry', `Attempt ${i + 1}`);
        engine.completeCorrection(failure.id, { status: 'FAILED', message: 'Failed' });
      }
      expect(() => engine.attemptCorrection(failure.id, 'retry', 'Fourth attempt')).toThrow('max attempts reached or total limit exceeded');
    });

    it('should reject correction when total attempts exceeded', () => {
      const config = createValidConfig({ maxTotalAttempts: 2 });
      const engine2 = new SelfCorrectionEngine('test-run-2', config);
      const failure = engine2.recordFailure('TRANSIENT', 'Test', {});
      engine2.attemptCorrection(failure.id, 'retry', 'First');
      engine2.completeCorrection(failure.id, { status: 'FAILED', message: 'Failed' });
      engine2.attemptCorrection(failure.id, 'retry', 'Second');
      engine2.completeCorrection(failure.id, { status: 'FAILED', message: 'Failed' });
      expect(() => engine2.attemptCorrection(failure.id, 'retry', 'Third')).toThrow('max attempts reached or total limit exceeded');
    });

    it('should prevent mutating correction history through returned records', () => {
      const failure = engine.getFailuresByCategory('TRANSIENT')[0];
      const attempt = engine.attemptCorrection(failure.id, 'retry', 'Retry');
      attempt.authorized = false;
      attempt.action = 'git commit';

      const storedAttempt = engine.getState().corrections[0];
      expect(storedAttempt.authorized).toBe(true);
      expect(storedAttempt.action).toBe('retry');
    });

    it('should reject unauthorized action', () => {
      const failure = engine.getFailuresByCategory('TRANSIENT')[0];
      expect(() => engine.attemptCorrection(failure.id, 'chmod 777', 'Change permissions')).toThrow('not authorized');
    });

    it('should reject blocked action', () => {
      const failure = engine.getFailuresByCategory('TRANSIENT')[0];
      expect(() => engine.attemptCorrection(failure.id, 'git push origin main', 'Push changes')).toThrow('not authorized');
    });

    it('should reject modification of review-required file', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
      expect(() => engine.attemptCorrection(failure.id, 'edit', 'Fix test', '.kilo/agents/code-reviewer.md')).toThrow('not authorized');
    });

    it('should allow correction within allowed paths', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
      const attempt = engine.attemptCorrection(failure.id, 'edit', 'Fix test', '.kilo/orchestration/storage.ts');
      expect(attempt.authorized).toBe(true);
    });

    it('should reject correction outside allowed paths', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
      expect(() => engine.attemptCorrection(failure.id, 'edit', 'Fix test', 'back/src/main.ts')).toThrow('not authorized');
    });

    it('should reject a path that escapes an allowed correction directory', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
      expect(() => engine.attemptCorrection(
        failure.id,
        'edit',
        'Change a project decision',
        '.kilo/orchestration/../../F01/docs/decisions.md',
      )).toThrow('not authorized');
    });

    it('should reject sibling directory traversal via .. path segment', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
      // Attempt to escape via ../ sibling traversal
      expect(() => engine.attemptCorrection(
        failure.id,
        'edit',
        'Sibling traversal',
        '.kilo/orchestration/../F01.kilo/orchestration/src/evil.ts',
      )).toThrow('not authorized');
    });

    it('should reject URL-encoded path traversal attempts', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
      // URL-encoded ../ as %2e%2e%2f
      expect(() => engine.attemptCorrection(
        failure.id,
        'edit',
        'URL encoded traversal',
        '.kilo/orchestration/..%2f..%2fetc%2fpasswd',
      )).toThrow('not authorized');
      // Double URL encoding
      expect(() => engine.attemptCorrection(
        failure.id,
        'edit',
        'Double URL encoded traversal',
        '.kilo/orchestration/..%252f..%252fetc%252fpasswd',
      )).toThrow('not authorized');
    });

    it('should reject file-changing corrections that omit the target path', () => {
      const failure = engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
      expect(() => engine.attemptCorrection(
        failure.id,
        'edit',
        'Edit a source file',
      )).toThrow('not authorized');
    });
  });

  describe('Correction Completion', () => {
    let failureId: string;

    beforeEach(() => {
      const failure = engine.recordFailure('TRANSIENT', 'Test failure', {});
      failureId = failure.id;
    });

    it('should complete correction with success', () => {
      const attempt = engine.attemptCorrection(failureId, 'retry', 'Retry');
      engine.completeCorrection(failureId, { status: 'SUCCEEDED', message: 'Fixed', evidence: { fixed: true } });
      const state = engine.getState();
      const correction = state.corrections.find(c => c.failureId === failureId);
      expect(correction).toBeDefined();
      expect(correction!.result?.status).toBe('SUCCEEDED');
      expect(correction!.completedAt).toBeDefined();
    });

    it('should complete correction with failure', () => {
      const attempt = engine.attemptCorrection(failureId, 'retry', 'Retry');
      engine.completeCorrection(failureId, { status: 'FAILED', message: 'Still failing' });
      const state = engine.getState();
      const correction = state.corrections.find(c => c.failureId === failureId);
      expect(correction!.result?.status).toBe('FAILED');
    });

    it('should record blocked policy result', () => {
      const attempt = engine.attemptCorrection(failureId, 'retry', 'Retry');
      engine.completeCorrection(failureId, { status: 'BLOCKED_POLICY', message: 'Blocked by policy' });
      const state = engine.getState();
      const correction = state.corrections.find(c => c.failureId === failureId);
      expect(correction!.result?.status).toBe('BLOCKED_POLICY');
    });

    it('should record max attempts reached', () => {
      const attempt = engine.attemptCorrection(failureId, 'retry', 'Retry');
      engine.completeCorrection(failureId, { status: 'MAX_ATTEMPTS_REACHED', message: 'Max attempts' });
      const state = engine.getState();
      const correction = state.corrections.find(c => c.failureId === failureId);
      expect(correction!.result?.status).toBe('MAX_ATTEMPTS_REACHED');
    });

    it('should record no progress', () => {
      const attempt = engine.attemptCorrection(failureId, 'retry', 'Retry');
      engine.completeCorrection(failureId, { status: 'NO_PROGRESS', message: 'Same error' });
      const state = engine.getState();
      const correction = state.corrections.find(c => c.failureId === failureId);
      expect(correction!.result?.status).toBe('NO_PROGRESS');
    });

    it('should reject invalid correction result', () => {
      const attempt = engine.attemptCorrection(failureId, 'retry', 'Retry');
      expect(() => engine.completeCorrection(failureId, { status: 'INVALID' as any, message: 'Test' })).toThrow('Invalid correction result');
    });
  });

  describe('Progress Detection', () => {
    it('should detect max attempts reached', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Test', {});
      // Simulate 3 failed attempts
      for (let i = 0; i < 3; i++) {
        engine.attemptCorrection(failure.id, 'retry', `Attempt ${i + 1}`);
        engine.completeCorrection(failure.id, { status: 'FAILED', message: 'Failed' });
      }
      const result = engine.shouldStopCorrecting(failure.id);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('MAX_ATTEMPTS_REACHED');
    });

    it('should detect max total attempts', () => {
      const config = createValidConfig({ maxTotalAttempts: 2 });
      const engine2 = new SelfCorrectionEngine('test-run-2', config);
      const failure = engine2.recordFailure('TRANSIENT', 'Test', {});
      engine2.attemptCorrection(failure.id, 'retry', 'First');
      engine2.completeCorrection(failure.id, { status: 'FAILED', message: 'Failed' });
      engine2.attemptCorrection(failure.id, 'retry', 'Second');
      engine2.completeCorrection(failure.id, { status: 'FAILED', message: 'Failed' });
      const result = engine2.shouldStopCorrecting(failure.id);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('MAX_TOTAL_ATTEMPTS_REACHED');
    });

    it('should detect no progress after repeated failures', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Test', {});
      // First failed attempt
      engine.attemptCorrection(failure.id, 'retry', 'First');
      engine.completeCorrection(failure.id, { status: 'FAILED', message: 'Same error' });
      // Second failed attempt with same result
      engine.attemptCorrection(failure.id, 'retry', 'Second');
      engine.completeCorrection(failure.id, { status: 'FAILED', message: 'Same error' });
      const result = engine.shouldStopCorrecting(failure.id);
      expect(result.shouldStop).toBe(true);
      expect(result.reason).toBe('NO_PROGRESS');
    });

    it('should not stop if progress is made', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Test', {});
      engine.attemptCorrection(failure.id, 'retry', 'First');
      engine.completeCorrection(failure.id, { status: 'FAILED', message: 'Error A' });
      engine.attemptCorrection(failure.id, 'retry', 'Second');
      engine.completeCorrection(failure.id, { status: 'FAILED', message: 'Error B' }); // Different error = progress
      const result = engine.shouldStopCorrecting(failure.id);
      expect(result.shouldStop).toBe(false);
    });

    it('should not stop if correction succeeded', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Test', {});
      engine.attemptCorrection(failure.id, 'retry', 'First');
      engine.completeCorrection(failure.id, { status: 'SUCCEEDED', message: 'Fixed' });
      const result = engine.shouldStopCorrecting(failure.id);
      expect(result.shouldStop).toBe(false);
    });
  });

  describe('Failure Queries', () => {
    it('should get failure by id', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Test', {});
      const found = engine.getFailure(failure.id);
      expect(found).toEqual(failure);
    });

    it('should return undefined for non-existent failure', () => {
      const found = engine.getFailure('non-existent');
      expect(found).toBeUndefined();
    });

    it('should filter failures by category', () => {
      engine.recordFailure('TRANSIENT', 'Transient 1', {});
      engine.recordFailure('TRANSIENT', 'Transient 2', {});
      engine.recordFailure('CONFIGURATION', 'Config error', {});
      const transient = engine.getFailuresByCategory('TRANSIENT');
      const config = engine.getFailuresByCategory('CONFIGURATION');
      expect(transient).toHaveLength(2);
      expect(config).toHaveLength(1);
    });

    it('should get pending failures', () => {
      const f1 = engine.recordFailure('TRANSIENT', 'Test 1', {});
      const f2 = engine.recordFailure('CONFIGURATION', 'Test 2', {});
      // Exhaust f1 attempts
      for (let i = 0; i < 3; i++) {
        engine.attemptCorrection(f1.id, 'retry', `Attempt ${i + 1}`);
        engine.completeCorrection(f1.id, { status: 'FAILED', message: 'Failed' });
      }
      const pending = engine.getPendingFailures();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(f2.id);
    });
  });

  describe('Authorization Checks', () => {
    beforeEach(() => {
      engine.recordFailure('DETERMINISTIC_TEST_BUILD', 'Test fail', {});
    });

    it('should authorize edit in allowed path', () => {
      const failure = engine.getFailuresByCategory('DETERMINISTIC_TEST_BUILD')[0];
      const attempt = engine.attemptCorrection(failure.id, 'edit', 'Fix', '.kilo/orchestration/storage.ts');
      expect(attempt.authorized).toBe(true);
    });

    it('should deny edit outside allowed path', () => {
      const failure = engine.getFailuresByCategory('DETERMINISTIC_TEST_BUILD')[0];
      expect(() => engine.attemptCorrection(failure.id, 'edit', 'Fix', 'back/src/main.ts')).toThrow('not authorized');
    });

    it('should deny blocked actions', () => {
      const failure = engine.getFailuresByCategory('DETERMINISTIC_TEST_BUILD')[0];
      expect(() => engine.attemptCorrection(failure.id, 'git commit -m "fix"', 'Commit')).toThrow('not authorized');
      expect(() => engine.attemptCorrection(failure.id, 'GIT COMMIT -m "fix"', 'Commit')).toThrow('not authorized');
      expect(() => engine.attemptCorrection(failure.id, 'npm publish', 'Publish')).toThrow('not authorized');
      expect(() => engine.attemptCorrection(failure.id, 'chmod 777 secret', 'Chmod')).toThrow('not authorized');
    });

    it('should deny files requiring review', () => {
      const failure = engine.getFailuresByCategory('DETERMINISTIC_TEST_BUILD')[0];
      expect(() => engine.attemptCorrection(failure.id, 'edit', 'Fix', '.kilo/agents/code-reviewer.md')).toThrow('not authorized');
      expect(() => engine.attemptCorrection(failure.id, 'edit', 'Fix', '.kilo/rules/project-rules.md')).toThrow('not authorized');
    });
  });

  describe('State Persistence', () => {
    it('should serialize state correctly', () => {
      engine.recordFailure('TRANSIENT', 'Test', { key: 'value' });
      const json = engine.toJSON();
      expect(json).toContain('"runId":"test-run-123"');
      expect(json).toContain('"failures"');
      expect(json).toContain('"corrections"');
    });

    it('should restore from JSON correctly', () => {
      engine.recordFailure('TRANSIENT', 'Test', { key: 'value' });
      const json = engine.toJSON();
      const restored = SelfCorrectionEngine.fromJSON(json);
      const state = restored.getState();
      expect(state.runId).toBe('test-run-123');
      expect(state.failures).toHaveLength(1);
      expect(state.failures[0].message).toBe('Test');
      expect(state.failures[0].context).toEqual({ key: 'value' });
    });

    it('should preserve corrections in serialization', () => {
      const failure = engine.recordFailure('TRANSIENT', 'Test', {});
      engine.attemptCorrection(failure.id, 'retry', 'Retry');
      engine.completeCorrection(failure.id, { status: 'SUCCEEDED', message: 'Fixed' });
      const json = engine.toJSON();
      const restored = SelfCorrectionEngine.fromJSON(json);
      const state = restored.getState();
      expect(state.corrections).toHaveLength(1);
      expect(state.corrections[0].result?.status).toBe('SUCCEEDED');
    });

    it('should reject JSON with mismatched maxAttemptsPerFailure between state and config', () => {
      engine.recordFailure('TRANSIENT', 'Test', {});
      const json = JSON.parse(engine.toJSON());
      json.state.maxAttemptsPerFailure = 3;
      json.config.maxAttemptsPerFailure = 5;
      expect(() => SelfCorrectionEngine.fromJSON(JSON.stringify(json))).toThrow(
        'Config/state mismatch: state.maxAttemptsPerFailure (3) !== config.maxAttemptsPerFailure (5)'
      );
    });

    it('should reject JSON where state.totalAttempts exceeds config.maxTotalAttempts', () => {
      engine.recordFailure('TRANSIENT', 'Test', {});
      const json = JSON.parse(engine.toJSON());
      json.state.totalAttempts = 15;
      json.config.maxTotalAttempts = 10;
      expect(() => SelfCorrectionEngine.fromJSON(JSON.stringify(json))).toThrow(
        'Config/state mismatch: state.totalAttempts (15) exceeds config.maxTotalAttempts (10)'
      );
    });
  });

  describe('Configuration Validation', () => {
    it('should reject invalid config', () => {
      expect(() => new SelfCorrectionEngine('test', { maxAttemptsPerFailure: 0 as any })).toThrow();
      expect(() => new SelfCorrectionEngine('test', { maxTotalAttempts: -1 as any })).toThrow();
    });

    it('should accept valid config', () => {
      const config = createValidConfig({ maxAttemptsPerFailure: 5, maxTotalAttempts: 15 });
      const engine = new SelfCorrectionEngine('test', config);
      expect(engine.getConfig().maxAttemptsPerFailure).toBe(5);
      expect(engine.getConfig().maxTotalAttempts).toBe(15);
    });
  });
});