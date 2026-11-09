// Opt-in resilient orchestration integration (MP-35R)
// Integrates provider-failover, task-state, continuity-checkpoint into actual execution path.
// No live provider calls; simulation only.

import type { AgentDelegationPort, CodeExecutionReport, TaskDelegationRequest } from './types.js';
import {
  FailoverController,
  classifyFailure,
  type ProviderDestination,
  type FailoverResult,
} from './provider-failover.js';
import {
  writeCheckpoint,
  loadCheckpoint,
  type ContinuityCheckpoint,
  type CheckpointStorageOptions,
} from './continuity-checkpoint.js';
import { hasReadyIndependentTasks, isGlobalCompletion, type TaskEntry } from './task-state.js';

export interface ResilientPortOptions {
  destinations: ProviderDestination[];
  checkpointStorage: CheckpointStorageOptions;
  missionId: string;
  task: string;
  assignedAgent: string;
  objective: string;
  dependencies?: string[];
  relevantPaths?: string[];
  authorizedScope?: string;
  canonicalDecisions?: string[];
}

export class ResilientAgentDelegationPort implements AgentDelegationPort {
  private readonly inner: AgentDelegationPort;
  private readonly opts: ResilientPortOptions;
  private readonly completedOps = new Map<string, CodeExecutionReport>();
  private readonly attemptHistory: string[] = [];
  private readonly stageHistory: string[] = [];
  private lastCompletedAction = 'none';
  private lastVerifiedTest = 'none';

  constructor(inner: AgentDelegationPort, opts: ResilientPortOptions) {
    this.inner = inner;
    this.opts = opts;
  }

  getAttemptHistory(): string[] {
    return [...this.attemptHistory];
  }

  getLastCompletedAction(): string {
    return this.lastCompletedAction;
  }

  async delegateToCode(request: TaskDelegationRequest): Promise<CodeExecutionReport> {
    const operationId = `${request.runId}:${request.taskId}`;

    // Idempotency guard (in-process): never repeat a completed operation.
    if (this.completedOps.has(operationId)) {
      return this.completedOps.get(operationId)!;
    }

    // Durable recovery (cross-process restart): if the checkpoint indicates this
    // operation already completed, return the stored report without re-running
    // delegation. Returning the stored report never re-invokes the inner port,
    // so non-idempotent ops are never replayed. The completed report is
    // persisted in the checkpoint under the explicit `completedReport` key
    // (see writeCp / continuity-checkpoint.ts) so a valid CodeExecutionReport
    // can be reconstructed on recovery.
    const recovered = await loadCheckpoint(this.opts.missionId, this.opts.task, this.opts.checkpointStorage);
    if (recovered && recovered.lastCompletedAction === operationId) {
      const stored = recovered.completedReport;
      if (stored && typeof stored === 'object' && 'runId' in stored && 'status' in stored) {
        this.completedOps.set(operationId, stored as CodeExecutionReport);
        this.lastCompletedAction = operationId;
        return stored as CodeExecutionReport;
      }
      // Checkpoint claims completion but no recoverable report: refuse to
      // replay rather than risk re-executing a potentially non-idempotent op.
      throw new Error(
        `Durable recovery failed: operation ${operationId} marked completed but no stored report; refusing to replay`,
      );
    }

    // Checkpoint before delegation attempt
    await this.writeCp('before_delegation_attempt');

    const controller = new FailoverController(this.opts.destinations, { maxRetriesPerDestination: 1, maxTotalAttempts: 10 });

    let lastError: unknown;
    let result: FailoverResult | undefined;

    result = await controller.run(async (dest) => {
      try {
        const report = await this.inner.delegateToCode(request);
        if (report.status !== 'COMPLETED') {
          const cls = classifyFailure({ message: 'execution not completed' });
          this.attemptHistory.push(`${dest.id}:failed:${cls.type}`);
          await this.writeCp('after_failed_attempt');
          return { ok: false, failure: { message: 'execution not completed' } };
        }
        // success
        this.attemptHistory.push(`${dest.id}:success`);
        this.lastCompletedAction = operationId;
        this.lastVerifiedTest = request.requiredChecks.join(',') || 'none';
        this.completedOps.set(operationId, report);
        await this.writeCp('after_completed_action', report);
        return { ok: true };
      } catch (e) {
        const err = e as Error;
        const cls = classifyFailure({ message: err.message, httpStatus: (e as { httpStatus?: number }).httpStatus });
        this.attemptHistory.push(`${dest.id}:failed:${cls.type}`);
        await this.writeCp('after_failed_attempt');
        lastError = e;
        return { ok: false, failure: { httpStatus: (e as { httpStatus?: number }).httpStatus, message: err.message } };
      }
    });

    // Need to return the actual report. On success, retrieve cached report.
    if (result.finalState === 'success') {
      const cached = this.completedOps.get(operationId);
      if (cached) return cached;
      throw new Error('Failover reported success but no completed report was cached');
    }

    // Exhaustion / stopped: durable checkpoint + throw (no replay)
    await this.writeCp('on_exhaustion');
    if (lastError) throw lastError;
    throw new Error(`Provider failover ${result.finalState}: ${result.exhausted ? 'exhausted' : 'stopped'}`);
  }

  async reviewWithCodeReviewer(request: Parameters<AgentDelegationPort['reviewWithCodeReviewer']>[0]) {
    return this.inner.reviewWithCodeReviewer(request);
  }

  async performDocUpdate(request: Parameters<NonNullable<AgentDelegationPort['performDocUpdate']>>[0]) {
    if (this.inner.performDocUpdate) return this.inner.performDocUpdate(request);
    return undefined as never;
  }

  private async writeCp(stage: string, completedReport?: CodeExecutionReport): Promise<void> {
    // CR-003: append the stage to an internal history so checkpoints record the
    // full stage sequence instead of being overwritten with a single entry.
    this.stageHistory.push(stage);
    const cp: ContinuityCheckpoint = {
      missionId: this.opts.missionId,
      goal: this.opts.objective,
      task: this.opts.task,
      assignedAgent: this.opts.assignedAgent,
      objective: this.opts.objective,
      dependencies: this.opts.dependencies ?? [],
      relevantPaths: this.opts.relevantPaths ?? [],
      authorizedScope: this.opts.authorizedScope ?? '',
      canonicalDecisions: this.opts.canonicalDecisions ?? [],
      recentToolOutcomes: [...this.stageHistory],
      lastCompletedAction: this.lastCompletedAction,
      lastVerifiedTest: this.lastVerifiedTest,
      currentTddPhase: stage,
      pendingReviewStatus: 'none',
      knownBlockers: stage === 'on_exhaustion' ? ['provider_exhausted'] : [],
      // providerAttemptHistory remains authoritative for the attempt sequence
      providerAttemptHistory: [...this.attemptHistory],
      workingTreeStateSummary: 'clean',
      lastDurableCheckpoint: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      nonIdempotentOpsEncountered: [],
      // CR-002: persist the completed report under an explicit key so a valid
      // CodeExecutionReport can be returned on durable recovery (backward
      // compatible: absent when no operation has completed yet).
      completedReport,
    };
    await writeCheckpoint(cp, this.opts.checkpointStorage);
  }
}

// Scheduling helpers (opt-in) using task-state
export function getSchedulableTasks(tasks: TaskEntry[]): TaskEntry[] {
  // READY tasks are schedulable even when AWAITING_REVIEW tasks exist
  return tasks.filter(t => t.state === 'READY');
}

export function isMissionTerminated(tasks: TaskEntry[]): boolean {
  return isGlobalCompletion(tasks);
}

export function hasReadyIndependent(tasks: TaskEntry[]): boolean {
  return hasReadyIndependentTasks(tasks);
}
