import {
  FailureRecord,
  CorrectionAttempt,
  SelfCorrectionState,
  SelfCorrectionConfig,
  CorrectionResult,
  CorrectionStatus,
  FailureCategory,
} from './types.js';
import {
  validateFailureRecord,
  validateCorrectionAttempt,
  validateCorrectionResult,
  validateSelfCorrectionState,
  validateSelfCorrectionConfig,
} from './validation.js';
import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Actions that are allowed without a file path.
 * Currently only 'retry' is pathless. If additional pathless actions are needed
 * (e.g., 'wait', 'recheck'), add them to this set.
 * Note: Adding new pathless actions requires updating the authorization logic
 * in isActionAuthorized() and corresponding tests.
 */
const PATHLESS_ACTIONS = new Set(['retry']);

/**
 * Self-correction engine for tracking and managing correction attempts
 * within the autonomous execution contract.
 *
 * Enforces attempt limits (max 3 per failure, max 10 total) and
 * authorization policies (allowed paths, blocked actions, review-required files).
 */
export class SelfCorrectionEngine {
  private state: SelfCorrectionState;
  private config: SelfCorrectionConfig;

  constructor(runId: string, config?: Partial<SelfCorrectionConfig>) {
    const defaultConfig: SelfCorrectionConfig = {
      maxAttemptsPerFailure: 3,
      maxTotalAttempts: 10,
      allowedCorrectionPaths: [
        '.kilo/orchestration/',
      ],
      blockedActions: [
        'chmod',
        'chown',
        'git push',
        'git commit',
        'npm publish',
        'docker push',
      ],
      requireReviewFor: [
        'code-reviewer.md',
        'universal-rules.md',
        'project-rules.md',
        'autonomous-execution.md',
      ],
    };

    this.config = structuredClone({ ...defaultConfig, ...config });
    
    // Validate config
    const configValidation = validateSelfCorrectionConfig(this.config);
    if (!configValidation.isValid) {
      throw new Error(`Invalid self-correction config: ${configValidation.errors.join(', ')}`);
    }

    this.state = this.createInitialState(runId);
  }

  private createInitialState(runId: string): SelfCorrectionState {
    return {
      runId,
      failures: [],
      corrections: [],
      maxAttemptsPerFailure: this.config.maxAttemptsPerFailure,
      totalAttempts: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  public getState(): SelfCorrectionState {
    /** Returns a deep clone of the current engine state. */
    return structuredClone(this.state);
  }

  public getConfig(): SelfCorrectionConfig {
    /** Returns a deep clone of the engine configuration. */
    return structuredClone(this.config);
  }

  /**
   * Records a new failure for tracking correction attempts.
   * @param category - Failure category (TRANSIENT, DETERMINISTIC_TEST_BUILD, etc.)
   * @param message - Human-readable failure description
   * @param context - Additional structured context data
   * @returns The recorded failure record with generated ID
   * @throws Error if validation fails
   */
  public recordFailure(
    category: FailureCategory,
    message: string,
    context: Record<string, unknown>
  ): FailureRecord {
    const failureId = `fail-${crypto.randomUUID().slice(0, 8)}`;
    const failure: FailureRecord = {
      id: failureId,
      category,
      message,
      context,
      timestamp: new Date().toISOString(),
      attempt: 1,
      maxAttempts: this.config.maxAttemptsPerFailure,
    };

    const validation = validateFailureRecord(failure);
    if (!validation.isValid) {
      throw new Error(`Invalid failure record: ${validation.errors.join(', ')}`);
    }

    this.state.failures.push(failure);
    this.state.lastUpdated = new Date().toISOString();
    return structuredClone(failure);
  }

  /**
   * Retrieves a failure record by ID.
   * @param failureId - The failure identifier
   * @returns The failure record or undefined if not found
   */
  public getFailure(failureId: string): FailureRecord | undefined {
    const failure = this.state.failures.find(f => f.id === failureId);
    return failure ? structuredClone(failure) : undefined;
  }

  /**
   * Retrieves all failures matching a category.
   * @param category - The failure category to filter by
   * @returns Array of matching failure records
   */
  public getFailuresByCategory(category: FailureCategory): FailureRecord[] {
    return structuredClone(this.state.failures.filter(f => f.category === category));
  }

  /**
   * Checks if a correction attempt is allowed for the given failure.
   * @param failureId - The failure identifier
   * @returns True if attempts remain within per-failure and total limits
   */
  public canAttemptCorrection(failureId: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) return false;
    // Allow up to maxAttempts attempts (attempt starts at 1, so attempt <= maxAttempts)
    if (failure.attempt > failure.maxAttempts) return false;
    if (this.state.totalAttempts >= this.config.maxTotalAttempts) return false;
    return true;
  }

  /**
   * Checks if an action is authorized for a given file path.
   * Enforces blocked actions, path allowlists, and review-required patterns.
   * @param action - The action to authorize (e.g., 'edit', 'retry')
   * @param filePath - Optional file path; required for file-changing actions
   * @returns True if the action is authorized
   */
  public isActionAuthorized(action: string, filePath?: string): boolean {
    // Check blocked actions
    const normalizedAction = action.toLowerCase().replace(/\s+/g, ' ').trim();
    if (this.config.blockedActions.some(blocked =>
      normalizedAction.includes(blocked.toLowerCase().replace(/\s+/g, ' ').trim()),
    )) {
      return false;
    }

    if (!filePath && !PATHLESS_ACTIONS.has(normalizedAction)) {
      return false;
    }

    // Check if file path requires review
    if (filePath) {
      const requiresReview = this.config.requireReviewFor.some(pattern =>
        filePath.includes(pattern)
      );
      if (requiresReview) {
        return false; // Requires explicit review, not auto-correction
      }
    }

    // Check allowed paths using canonical resolution
    if (filePath) {
      // Fully decode URL encoding (handle multiple layers of encoding)
      let decodedPath = filePath;
      let prevDecoded = '';
      while (decodedPath !== prevDecoded) {
        prevDecoded = decodedPath;
        try {
          decodedPath = decodeURIComponent(decodedPath);
        } catch {
          break; // Invalid encoding, stop decoding
        }
      }
      // Normalize path separators
      const normalizedPath = decodedPath.replace(/\\/g, '/');

      // Reject absolute paths and Windows drive paths
      if (path.posix.isAbsolute(normalizedPath) || /^[a-zA-Z]:\//.test(normalizedPath)) {
        return false;
      }

      // Use canonical resolution: resolve both requested and allowed paths
      // against a common base to prevent traversal bypasses
      const basePath = path.posix.resolve('/');
      const resolvedRequested = path.posix.resolve(basePath, normalizedPath);

      // Ensure the resolved path is still under the base (no escape via ..)
      if (!resolvedRequested.startsWith(basePath)) {
        return false;
      }

const allowed = this.config.allowedCorrectionPaths.some(allowedPath => {
        const normalizedAllowed = allowedPath.replace(/\\/g, '/').replace(/\/$/, '');
        const resolvedAllowed = path.posix.resolve(basePath, normalizedAllowed);

        // Check if requested path is within allowed path
        return (
          resolvedRequested === resolvedAllowed ||
          resolvedRequested.startsWith(`${resolvedAllowed}/`)
        );
      });

      if (!allowed) {
        return false;
      }
    }

    return true;
  }

  /**
   * Attempts a correction for a recorded failure.
   * Validates authorization, increments attempt counters, and records the attempt.
   * @param failureId - The failure identifier
   * @param action - The corrective action (e.g., 'edit', 'retry')
   * @param description - Human-readable description of the correction
   * @param filePath - Optional file path for file-changing actions
   * @returns The recorded correction attempt
   * @throws Error if failure not found, limits exceeded, or action not authorized
   */
  public attemptCorrection(
    failureId: string,
    action: string,
    description: string,
    filePath?: string
  ): CorrectionAttempt {
    const failure = this.state.failures.find(item => item.id === failureId);
    if (!failure) {
      throw new Error(`Failure not found: ${failureId}`);
    }

    if (!this.canAttemptCorrection(failureId)) {
      throw new Error(`Cannot attempt correction: max attempts reached or total limit exceeded`);
    }

    const authorized = this.isActionAuthorized(action, filePath);
    if (!authorized) {
      throw new Error(`Action not authorized: ${action}${filePath ? ` on ${filePath}` : ''}`);
    }

    const attempt: CorrectionAttempt = {
      failureId,
      attempt: failure.attempt,
      action,
      description,
      authorized: true,
      startedAt: new Date().toISOString(),
    };

    const validation = validateCorrectionAttempt(attempt);
    if (!validation.isValid) {
      throw new Error(`Invalid correction attempt: ${validation.errors.join(', ')}`);
    }

    this.state.corrections.push(attempt);
    failure.attempt++;
    this.state.totalAttempts++;
    this.state.lastUpdated = new Date().toISOString();

    return structuredClone(attempt);
  }

  /**
   * Completes a correction attempt with its result.
   * @param failureId - The failure identifier
   * @param result - The correction result (status, message, evidence)
   * @throws Error if no active correction or invalid result
   */
  public completeCorrection(failureId: string, result: CorrectionResult): void {
    const correction = this.state.corrections
      .filter(c => c.failureId === failureId)
      .pop();

    if (!correction) {
      throw new Error(`No active correction for failure: ${failureId}`);
    }

    const resultValidation = validateCorrectionResult(result);
    if (!resultValidation.isValid) {
      throw new Error(`Invalid correction result: ${resultValidation.errors.join(', ')}`);
    }

    correction.completedAt = new Date().toISOString();
    correction.result = structuredClone(result);
    this.state.lastUpdated = new Date().toISOString();

    // If correction succeeded, mark failure as resolved (optional)
    if (result.status === 'SUCCEEDED') {
      const failure = this.getFailure(correction.failureId);
      if (failure) {
        // Could mark as resolved, but we keep it for history
      }
    }
  }

  /**
   * Checks if a failure has reached its maximum allowed attempts.
   * @param failureId - The failure identifier
   * @returns True if the failure's attempt count exceeds maxAttempts
   */
  public hasReachedMaxAttempts(failureId: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) return false;
    return failure.attempt > failure.maxAttempts;
  }

  /**
   * Checks if recent correction attempts show no progress.
   * No progress = last 2 attempts have identical status AND message.
   * @param failureId - The failure identifier
   * @returns True if last 2 completed attempts show no progress
   */
  public hasNoProgress(failureId: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) return false;
    // Check if last 2 attempts had same result (same status AND same message)
    const corrections = this.state.corrections
      .filter(c => c.failureId === failureId)
      .filter(c => c.result);
    if (corrections.length < 2) return false;
    const last = corrections[corrections.length - 1];
    const prev = corrections[corrections.length - 2];
    // No progress if both status AND message are the same
    return last.result?.status === prev.result?.status && 
           last.result?.message === prev.result?.message;
  }

  /**
   * Determines if correction should stop for a failure.
   * @param failureId - The failure identifier
   * @returns Object with shouldStop flag and reason
   */
  public shouldStopCorrecting(failureId: string): { shouldStop: boolean; reason: string } {
    const failure = this.getFailure(failureId);
    if (!failure) return { shouldStop: false, reason: '' };

    if (this.hasReachedMaxAttempts(failureId)) {
      return { shouldStop: true, reason: 'MAX_ATTEMPTS_REACHED' };
    }

    if (this.state.totalAttempts >= this.config.maxTotalAttempts) {
      return { shouldStop: true, reason: 'MAX_TOTAL_ATTEMPTS_REACHED' };
    }

    if (this.hasNoProgress(failureId)) {
      return { shouldStop: true, reason: 'NO_PROGRESS' };
    }

    return { shouldStop: false, reason: '' };
  }

  /**
   * Gets all failures that still have remaining attempts.
   * @returns Array of pending failure records
   */
  public getPendingFailures(): FailureRecord[] {
    return structuredClone(this.state.failures.filter(f => f.attempt <= f.maxAttempts));
  }

  /**
   * Serializes the engine state and configuration to JSON.
   * @returns JSON string containing state and config
   */
  public toJSON(): string {
    return JSON.stringify({ state: this.state, config: this.config });
  }

  /**
   * Deserializes a SelfCorrectionEngine from JSON.
   * Validates state, config, and config/state consistency.
   * @param json - JSON string from toJSON()
   * @returns Restored SelfCorrectionEngine instance
   * @throws Error if JSON is invalid, validation fails, or config/state mismatch
   */
  public static fromJSON(json: string): SelfCorrectionEngine {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid self-correction data: expected an object');
    }

    const serialized = parsed as Record<string, unknown>;
    const hasEnvelope = 'state' in serialized || 'config' in serialized;
    const state = (hasEnvelope ? serialized.state : parsed) as SelfCorrectionState;
    const config = hasEnvelope ? serialized.config as SelfCorrectionConfig : undefined;
    const stateValidation = validateSelfCorrectionState(state);
    if (!stateValidation.isValid) {
      throw new Error(`Invalid self-correction state: ${stateValidation.errors.join(', ')}`);
    }
    if (config !== undefined) {
      const configValidation = validateSelfCorrectionConfig(config);
      if (!configValidation.isValid) {
        throw new Error(`Invalid self-correction config: ${configValidation.errors.join(', ')}`);
      }

      // Validate config/state consistency
      if (state.maxAttemptsPerFailure !== config.maxAttemptsPerFailure) {
        throw new Error(
          `Config/state mismatch: state.maxAttemptsPerFailure (${state.maxAttemptsPerFailure}) !== config.maxAttemptsPerFailure (${config.maxAttemptsPerFailure})`
        );
      }
      if (state.totalAttempts !== undefined && config.maxTotalAttempts !== undefined) {
        // totalAttempts in state is the current count, maxTotalAttempts in config is the limit
        // They don't need to match, but we can check that totalAttempts doesn't exceed maxTotalAttempts
        if (state.totalAttempts > config.maxTotalAttempts) {
          throw new Error(
            `Config/state mismatch: state.totalAttempts (${state.totalAttempts}) exceeds config.maxTotalAttempts (${config.maxTotalAttempts})`
          );
        }
      }
    }

    const engine = new SelfCorrectionEngine(state.runId, config);
    engine.state = structuredClone(state);
    return engine;
  }
}