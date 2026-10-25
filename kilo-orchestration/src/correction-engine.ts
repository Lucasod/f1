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

const PATHLESS_ACTIONS = new Set(['retry']);

export class SelfCorrectionEngine {
  private state: SelfCorrectionState;
  private config: SelfCorrectionConfig;

  constructor(runId: string, config?: Partial<SelfCorrectionConfig>) {
    const defaultConfig: SelfCorrectionConfig = {
      maxAttemptsPerFailure: 3,
      maxTotalAttempts: 10,
      allowedCorrectionPaths: [
        'kilo-orchestration/src/',
        'kilo-orchestration/tests/',
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
        'code-reviewer-tests.md',
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
    return structuredClone(this.state);
  }

  public getConfig(): SelfCorrectionConfig {
    return structuredClone(this.config);
  }

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

  public getFailure(failureId: string): FailureRecord | undefined {
    const failure = this.state.failures.find(f => f.id === failureId);
    return failure ? structuredClone(failure) : undefined;
  }

  public getFailuresByCategory(category: FailureCategory): FailureRecord[] {
    return structuredClone(this.state.failures.filter(f => f.category === category));
  }

  public canAttemptCorrection(failureId: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) return false;
    // Allow up to maxAttempts attempts (attempt starts at 1, so attempt <= maxAttempts)
    if (failure.attempt > failure.maxAttempts) return false;
    if (this.state.totalAttempts >= this.config.maxTotalAttempts) return false;
    return true;
  }

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

    // Check allowed paths
    if (filePath) {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (
        path.posix.isAbsolute(normalizedPath) ||
        /^[a-zA-Z]:\//.test(normalizedPath) ||
        normalizedPath.split('/').includes('..')
      ) {
        return false;
      }
      const allowed = this.config.allowedCorrectionPaths.some(allowedPath => {
        const normalizedAllowedPath = path.posix.normalize(
          allowedPath.replace(/\\/g, '/'),
        ).replace(/\/$/, '');
        const resolvedPath = path.posix.normalize(normalizedPath);
        return (
          normalizedAllowedPath.length > 0 &&
          (resolvedPath === normalizedAllowedPath ||
            resolvedPath.startsWith(`${normalizedAllowedPath}/`))
        );
      });
      if (!allowed) {
        return false;
      }
    }

    return true;
  }

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

  public hasReachedMaxAttempts(failureId: string): boolean {
    const failure = this.getFailure(failureId);
    if (!failure) return false;
    return failure.attempt > failure.maxAttempts;
  }

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

  public getPendingFailures(): FailureRecord[] {
    return structuredClone(this.state.failures.filter(f => f.attempt <= f.maxAttempts));
  }

  public toJSON(): string {
    return JSON.stringify({ state: this.state, config: this.config });
  }

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
    }

    const engine = new SelfCorrectionEngine(state.runId, config);
    engine.state = structuredClone(state);
    return engine;
  }
}