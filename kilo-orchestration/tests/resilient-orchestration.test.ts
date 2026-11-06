// MP-35R — Resilient orchestration integration tests (CR-001, CR-002, CR-003, CR-005)
//
// These tests exercise the REAL orchestration entry points
// (`SequentialTaskOrchestrator.execute` / `executeFiprFlow`) through an injected
// `ResilientAgentDelegationPort` wrapping a controlled in-memory
// `AgentDelegationPort` mock, with injected checkpoint storage (temp dir).
//
// NO live provider calls, NO network, NO Mongo, NO credentials. GPT/Beam are
// marked SUPPORTED_STATIC inside this test file ONLY for the simulation chain;
// this does NOT claim production support for any provider.

import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';

import {
  ResilientAgentDelegationPort,
  getSchedulableTasks,
  hasReadyIndependent,
  isMissionTerminated,
} from '../src/resilient-orchestration.js';
import { SequentialTaskOrchestrator } from '../src/agent-orchestrator.js';
import { loadCheckpoint } from '../src/continuity-checkpoint.js';
import { classifyFailure } from '../src/provider-failover.js';
import type {
  AgentDelegationPort,
  BacklogTask,
  CodeExecutionReport,
  CodeReviewReport,
  ProviderDestination,
  TaskDelegationRequest,
} from '../src/types.js';
import type { TaskEntry } from '../src/task-state.js';

function makeTask(overrides: Partial<BacklogTask> = {}): BacklogTask {
  return {
    taskId: 'T-701',
    title: 'Implement product CRUD',
    phase: 'P2',
    dependencies: [],
    acceptanceCriteria: 'API and validation works',
    status: 'pending',
    humanApprovalRequired: false,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<TaskDelegationRequest> = {}): TaskDelegationRequest {
  return {
    runId: 'run-123',
    taskId: 'T-701',
    title: 'Implement product CRUD',
    phase: 'P2',
    baseCommit: 'base-commit',
    dependencies: [],
    acceptanceCriteria: 'API and validation works',
    authorizedScope: 'kilo-orchestration/src/',
    requiredChecks: ['npm test'],
    prohibitedActions: [],
    ...overrides,
  };
}

const baseReport: CodeExecutionReport = {
  runId: 'run-123',
  taskId: 'T-701',
  executionId: 'execution-123',
  snapshotId: 'snapshot-123',
  baseCommit: 'base-commit',
  status: 'COMPLETED',
  changedFiles: ['kilo-orchestration/src/example.ts'],
  commands: [{ command: 'npm test', exitCode: 0, summary: 'All tests passed' }],
  acceptanceEvidence: [{ criterion: 'API and validation works', evidence: ['example.test.ts'] }],
  fiprPhase: 'IMP',
};

const baseReview: CodeReviewReport = {
  runId: 'run-123',
  taskId: 'T-701',
  snapshotId: baseReport.snapshotId,
  verdict: 'PASS',
  findings: [],
};

function defaultDestinations(): ProviderDestination[] {
  // Test-only simulation destinations: gpt and beam are SUPPORTED_STATIC for
  // this test only. Not a claim of production provider support.
  return [
    { id: 'gpt', label: 'Test GPT', order: 1, configured: true, status: 'SUPPORTED_STATIC' },
    { id: 'beam', label: 'Test Beam', order: 2, configured: true, status: 'SUPPORTED_STATIC' },
  ];
}

function createPort(
  inner: AgentDelegationPort,
  storageDir: string,
  destinations: ProviderDestination[] = defaultDestinations(),
): ResilientAgentDelegationPort {
  return new ResilientAgentDelegationPort(inner, {
    destinations,
    checkpointStorage: { storageDir },
    missionId: 'm1',
    task: 't1',
    assignedAgent: 'dev',
    objective: 'implement',
  });
}

function rateLimitError(): Error & { httpStatus?: number } {
  const err = new Error('rate limit exceeded') as Error & { httpStatus?: number };
  err.httpStatus = 429;
  return err;
}

describe('MP-35R CR-001: real-entry-point resilient orchestration (simulation only)', () => {
  it('AC-R1: rotates gpt (HTTP 429) to beam on the real execute entry point and completes without replay', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mp35r-'));
    const invocationIds: string[] = [];
    const inner: AgentDelegationPort = {
      delegateToCode: vi.fn(async (req: TaskDelegationRequest): Promise<CodeExecutionReport> => {
        invocationIds.push(`${req.runId}:${req.taskId}`);
        if (invocationIds.length === 1) {
          throw rateLimitError(); // gpt: rotatable 429 -> controller rotates to beam
        }
        return { ...baseReport, executionId: 'execution-rotated' }; // beam: success (snapshotId must match the reviewer's)
      }),
      reviewWithCodeReviewer: vi.fn(async () => baseReview),
    };
    const port = createPort(inner, dir);
    const orchestrator = new SequentialTaskOrchestrator(port);

    const result = await orchestrator.execute('T-701', [makeTask({ phase: 'P2' })], makeRequest());

    expect(result.outcome).toBe('PASS');
    expect(result.confirmedCriteria).toEqual([makeRequest().acceptanceCriteria]);

    // Both provider attempts recorded: gpt failed rotatably, beam succeeded
    expect(inner.delegateToCode).toHaveBeenCalledTimes(2);
    expect(port.getAttemptHistory()).toEqual(
      expect.arrayContaining(['gpt:failed:rate_limit_429', 'beam:success']),
    );

    // Durable checkpoint persists the full attempt history (providerAttemptHistory authoritative)
    const cp = await loadCheckpoint('m1', 't1', { storageDir: dir });
    expect(cp).not.toBeNull();
    expect(cp!.providerAttemptHistory).toEqual(
      expect.arrayContaining(['gpt:failed:rate_limit_429', 'beam:success']),
    );

    // CR-003: stage history preserved in the checkpoint (full sequence, not just the last stage)
    expect(cp!.recentToolOutcomes).toEqual([
      'before_delegation_attempt',
      'after_failed_attempt',
      'after_completed_action',
    ]);

    // No completed operation repeated: each destination invoked once, bounded retries, no replay
    expect(invocationIds).toEqual(['run-123:T-701', 'run-123:T-701']);
    expect(port.getLastCompletedAction()).toBe('run-123:T-701');
  });

  it('AC-R2: exhaustion — all usable destinations fail rotatably -> durable checkpoint + safe stop, no infinite loop', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mp35r-'));
    const inner: AgentDelegationPort = {
      delegateToCode: vi.fn(async () => {
        throw rateLimitError(); // every destination fails rotatably
      }),
      reviewWithCodeReviewer: vi.fn(async () => baseReview),
    };
    const port = createPort(inner, dir);

    await expect(port.delegateToCode(makeRequest())).rejects.toThrow();

    // Bounded: each destination attempted once, no retry loop, no infinite loop
    expect(inner.delegateToCode).toHaveBeenCalledTimes(2);

    const cp = await loadCheckpoint('m1', 't1', { storageDir: dir });
    expect(cp).not.toBeNull();
    expect(cp!.knownBlockers).toContain('provider_exhausted');
    expect(cp!.recentToolOutcomes).toContain('on_exhaustion');
    expect(cp!.providerAttemptHistory).toEqual(
      expect.arrayContaining(['gpt:failed:rate_limit_429', 'beam:failed:rate_limit_429']),
    );
  });

  it('non-rotatable failure (HTTP 401) does not rotate providers', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mp35r-'));
    const inner: AgentDelegationPort = {
      delegateToCode: vi.fn(async () => {
        const err = new Error('unauthorized') as Error & { httpStatus?: number };
        err.httpStatus = 401; // auth_401_403 -> non-rotatable, immediate stop
        throw err;
      }),
      reviewWithCodeReviewer: vi.fn(async () => baseReview),
    };
    const port = createPort(inner, dir);

    await expect(port.delegateToCode(makeRequest())).rejects.toThrow();

    // No rotation to beam: single attempt, stopped
    expect(inner.delegateToCode).toHaveBeenCalledTimes(1);
  });

  it('classification: app/test failures are non-rotatable; 429 is rotatable', () => {
    expect(classifyFailure({ kind: 'app_failure', message: 'app failure' }).rotateProvider).toBe(false);
    expect(classifyFailure({ kind: 'repo_test_failure', message: 'test failed' }).rotateProvider).toBe(false);
    expect(classifyFailure({ kind: 'tool_failure' }).rotateProvider).toBe(false);
    expect(classifyFailure({ httpStatus: 401 }).rotateProvider).toBe(false);
    expect(classifyFailure({ httpStatus: 400 }).rotateProvider).toBe(false);
    expect(classifyFailure({ httpStatus: 429, message: 'rate limit' }).rotateProvider).toBe(true);
  });

  it('executeFiprFlow: completed FIX operation is not replayed in the IMP phase (same operationId)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mp35r-'));
    const inner: AgentDelegationPort = {
      delegateToCode: vi.fn(async () => baseReport),
      reviewWithCodeReviewer: vi.fn(async () => baseReview),
      performDocUpdate: vi.fn(async () => ({
        runId: 'run-123',
        taskId: 'T-701',
        verdict: 'COMPLETED' as const,
        updatedFiles: [],
        errors: [],
      })),
    };
    const port = createPort(inner, dir);
    const orchestrator = new SequentialTaskOrchestrator(port);

    const result = await orchestrator.executeFiprFlow('T-701', [makeTask({ phase: 'P2' })], makeRequest());

    expect(result.outcome).toBe('PASS');
    // FIX and IMP share operationId 'run-123:T-701'; IMP must be served from cache, not re-invoked
    expect(inner.delegateToCode).toHaveBeenCalledTimes(1);
    expect(port.getAttemptHistory()).toContain('gpt:success');
  });
});

describe('MP-35R CR-002: durable recovery (no replay across port restart)', () => {
  it('returns the stored report on a new port instance without re-delegating', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mp35r-'));

    // Seed a completed checkpoint through a real successful delegation.
    const firstInner: AgentDelegationPort = {
      delegateToCode: vi.fn(async () => baseReport),
      reviewWithCodeReviewer: vi.fn(async () => baseReview),
    };
    const firstPort = createPort(firstInner, dir);
    const first = await firstPort.delegateToCode(makeRequest());
    expect(first).toEqual(baseReport);
    expect(firstInner.delegateToCode).toHaveBeenCalledTimes(1);

    // New instance simulating a restart, same checkpoint storage: must recover,
    // not replay.
    const replayInner: AgentDelegationPort = {
      delegateToCode: vi.fn(async () => {
        throw new Error('completed operation must not be replayed');
      }),
      reviewWithCodeReviewer: vi.fn(async () => baseReview),
    };
    const replayPort = createPort(replayInner, dir);
    const recovered = await replayPort.delegateToCode(makeRequest());

    expect(recovered).toEqual(baseReport);
    expect(replayInner.delegateToCode).not.toHaveBeenCalled();
  });
});

describe('MP-35R CR-005: AWAITING_REVIEW non-blocking scheduling helpers', () => {
  const readyTask: TaskEntry = { id: 'T-READY', state: 'READY' };
  const awaitingTask: TaskEntry = { id: 'T-AWAITING', state: 'AWAITING_REVIEW' };
  const doneTask: TaskEntry = { id: 'T-DONE', state: 'VERIFIED_DONE' };

  it('getSchedulableTasks returns READY tasks while another task is AWAITING_REVIEW', () => {
    const schedulable = getSchedulableTasks([readyTask, awaitingTask]);
    expect(schedulable).toHaveLength(1);
    expect(schedulable[0].id).toBe('T-READY');
  });

  it('hasReadyIndependent is true with READY + AWAITING_REVIEW mixed states', () => {
    expect(hasReadyIndependent([readyTask, awaitingTask])).toBe(true);
    expect(hasReadyIndependent([awaitingTask])).toBe(false);
  });

  it('isMissionTerminated is false while a READY task remains alongside AWAITING_REVIEW', () => {
    expect(isMissionTerminated([readyTask, awaitingTask])).toBe(false);
  });

  it('isMissionTerminated is true only when no READY/AWAITING_REVIEW task remains', () => {
    // AWAITING_REVIEW is non-terminal for pause semantics
    expect(isMissionTerminated([awaitingTask, doneTask])).toBe(false);
    expect(isMissionTerminated([doneTask])).toBe(true);
    expect(isMissionTerminated([])).toBe(false);
  });
});
