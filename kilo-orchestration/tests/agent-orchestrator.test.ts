// Test file naming convention:
// - kebab-case for multi-word names (e.g., agent-orchestrator.test.ts, run-record.test.ts, self-correction.test.ts)
// - single word for single-concept names (e.g., storage.test.ts)
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  classifyBacklogTasks,
  parseBacklogTasks,
  SequentialTaskOrchestrator,
} from '../src/agent-orchestrator.js';
import type {
  BacklogTask,
  CodeExecutionReport,
  CodeReviewReport,
  TaskDelegationRequest,
  FIPRPhaseEnum,
  FIPRState,
  FIPRTransition,
  ReviewVerdict,
  ConsolidatedTaskReport,
  DocUpdateReport,
  DocUpdateRequest,
} from '../src/types.js';
import { SelfCorrectionEngine } from '../src/correction-engine.js';

const task = (overrides: Partial<BacklogTask> = {}): BacklogTask => ({
  taskId: 'T-701',
  title: 'Implement product CRUD',
  phase: 'P4',
  dependencies: [],
  acceptanceCriteria: 'API and validation works',
  status: 'pending',
  humanApprovalRequired: false,
  ...overrides,
});

describe('Backlog orchestration contract', () => {
  it('keeps independent authorized tasks eligible when another task is blocked', () => {
    const result = classifyBacklogTasks([
      task({
        taskId: 'T-702',
        dependencies: ['T-701'],
      }),
      task({
        taskId: 'T-703',
        phase: 'P2',
      }),
    ]);

    expect(result).toEqual([
      expect.objectContaining({ taskId: 'T-702', status: 'BLOCKED' }),
      expect.objectContaining({ taskId: 'T-703', status: 'ELIGIBLE' }),
    ]);
  });

  it('does not start tasks behind an unmet dependency or human approval gate', () => {
    const result = classifyBacklogTasks([
      task({
        taskId: 'T-117',
        phase: 'P1',
        humanApprovalRequired: true,
      }),
      task({
        taskId: 'T-1101',
        phase: 'P4',
        dependencies: ['T-117'],
      }),
    ]);

    expect(result[0].status).toBe('BLOCKED');
    expect(result[1].status).toBe('BLOCKED');
    expect(result[1].blockers).toContain('Dependency T-117 is BLOCKED');
  });

  it('allows P3 tasks when phase is authorized and dependencies are complete', () => {
    const result = classifyBacklogTasks([
      task({
        taskId: 'T-125',
        phase: 'P1',
        status: 'completed',
      }),
      task({
        taskId: 'T-301',
        phase: 'P3',
        dependencies: ['T-125'],
      }),
    ]);

    expect(result[1].status).toBe('ELIGIBLE');
    expect(result[1].blockers).toHaveLength(0);
  });

  it('parses task rows and dependency ranges from the actual project backlog format', () => {
    const markdown = [
      '## Phase 0: Baseline',
      '| ID | Task | Description | Dependencies | Completion Criteria | Status |',
      '| T-001 | Setup | Prepare baseline | — | File exists | ✅ completed |',
      '| T-002 | Rules | Document project rules | T-001 | Rules exist | ✅ completed |',
      '## Phase 1: Decisions',
      '| T-117 | Reviews | Business decisions require approval | T-001 | Moderation approved | ⏳ pending |',
      '| T-118 | Independent | Work that can proceed | T-001..T-002 | Done | ⏳ pending |',
      '## Phase 3: Design',
      '| T-301 | Schema | Design collections | T-117 | Schema exists | ⏳ pending |',
    ].join('\n');

    expect(parseBacklogTasks(markdown)).toEqual([
      expect.objectContaining({
        taskId: 'T-001',
        phase: 'P0',
        status: 'completed',
      }),
      expect.objectContaining({
        taskId: 'T-002',
        phase: 'P0',
        status: 'completed',
      }),
      expect.objectContaining({
        taskId: 'T-117',
        phase: 'P1',
        humanApprovalRequired: true,
      }),
      expect.objectContaining({
        taskId: 'T-118',
        dependencies: ['T-001', 'T-002'],
      }),
      expect.objectContaining({
        taskId: 'T-301',
        phase: 'P3',
      }),
    ]);
  });

  it('does not dispatch a blocked task to either agent', async () => {
    const dispatch = vi.fn();
    const review = vi.fn();

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: dispatch,
      reviewWithCodeReviewer: review,
    });
    await expect(orchestrator.execute(
      'T-701',
      [task({ humanApprovalRequired: true, phase: 'P1' })],
      request,
    )).rejects.toThrow('is not eligible');

    expect(dispatch).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('recomputes eligibility from the backlog instead of trusting caller status', async () => {
    const dispatch = vi.fn();
    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: dispatch,
      reviewWithCodeReviewer: vi.fn(),
    });

    await expect(orchestrator.execute('T-702', [
      task({ taskId: 'T-701', phase: 'P2' }),
      task({ taskId: 'T-702', phase: 'P2', dependencies: ['T-701'] }),
    ], { ...request, taskId: 'T-702' })).rejects.toThrow('is not eligible');

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('delegates one eligible task, then reviews the exact execution snapshot', async () => {
    const events: string[] = [];
    const dispatch = vi.fn(async () => {
      events.push('code');
      return executionReport;
    });
    const review = vi.fn(async () => {
      events.push('review');
      return reviewReport;
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: dispatch,
      reviewWithCodeReviewer: review,
    });
    const result = await orchestrator.execute(
      'T-701',
      [task({ phase: 'P2' })],
      request,
    );

    expect(events).toEqual(['code', 'review']);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      ...request,
      prohibitedActions: expect.arrayContaining([
        'git commit',
        'git push',
        'git reset',
        'git checkout',
        'git clean',
      ]),
    }));
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      runId: request.runId,
      taskId: request.taskId,
      snapshotId: executionReport.snapshotId,
      baseCommit: executionReport.baseCommit,
      changedFiles: executionReport.changedFiles,
      commands: executionReport.commands,
    }));
    expect(result.outcome).toBe('PASS');
    expect(result.confirmedCriteria).toEqual([request.acceptanceCriteria]);
  });

  it('refuses a reviewer verdict for a different snapshot', async () => {
    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: async () => executionReport,
      reviewWithCodeReviewer: async () => ({ ...reviewReport, snapshotId: 'new-snapshot' }),
    });
    const result = await orchestrator.execute(
      'T-701',
      [task({ phase: 'P2' })],
      request,
    );

    expect(result.outcome).toBe('BLOCKED');
    expect(result.divergences).toContain('Reviewer examined a different snapshot');
    expect(result.confirmedCriteria).toEqual([]);
  });

  it('does not report success when command evidence contradicts completion', async () => {
    const failedCommandReport: CodeExecutionReport = {
      ...executionReport,
      commands: [{ command: 'npm test', exitCode: 1, summary: 'Test failure' }],
    };
    const pass: CodeReviewReport = { ...reviewReport, verdict: 'PASS' };

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: async () => failedCommandReport,
      reviewWithCodeReviewer: async () => pass,
    });
    const result = await orchestrator.execute(
      'T-701',
      [task({ phase: 'P2' })],
      request,
    );

    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.divergences).toContain('Execution report includes a command with a non-zero exit code');
    expect(result.confirmedCriteria).toEqual([]);
  });

  it('serializes multiple dispatch requests to prevent workspace write conflicts', async () => {
    let active = 0;
    let maxActive = 0;
    const dispatch = vi.fn(async (delegation: TaskDelegationRequest) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return { ...executionReport, taskId: delegation.taskId };
    });
    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: dispatch,
      reviewWithCodeReviewer: async reviewRequest => ({
        ...reviewReport,
        taskId: reviewRequest.taskId,
      }),
    });

    await Promise.all([
      orchestrator.execute('T-701', [task({ phase: 'P2' })], request),
      orchestrator.execute(
        'T-702',
        [task({ taskId: 'T-702', phase: 'P2' })],
        { ...request, taskId: 'T-702' },
      ),
    ]);

    expect(maxActive).toBe(1);
  });

  it('records delegation failures without hiding the original error', async () => {
    const correctionEngine = new SelfCorrectionEngine(request.runId);
    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: async () => {
        throw new Error('agent runtime unavailable');
      },
      reviewWithCodeReviewer: async () => reviewReport,
    }, correctionEngine);

    await expect(orchestrator.execute(
      'T-701',
      [task({ phase: 'P2' })],
      request,
    )).rejects.toThrow('agent runtime unavailable');

    expect(correctionEngine.getFailuresByCategory('UNKNOWN')).toEqual([
      expect.objectContaining({
        message: 'Code delegation failed',
        context: expect.objectContaining({ stage: 'CODE_DELEGATION' }),
      }),
    ]);
  });

  it('records audit findings but does not claim success or self-approve them', async () => {
    const correctionEngine = new SelfCorrectionEngine(request.runId);
    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: async () => executionReport,
      reviewWithCodeReviewer: async () => ({
        ...reviewReport,
        verdict: 'CORRECTIONS_NEEDED',
        findings: [{
          id: 'F-1',
          severity: 'HIGH',
          description: 'Acceptance behavior is incomplete',
          evidence: ['snapshot:src/example.ts'],
        }],
      }),
    }, correctionEngine);

    const result = await orchestrator.execute(
      'T-701',
      [task({ phase: 'P2' })],
      request,
    );

    expect(result.outcome).toBe('CORRECTIONS_NEEDED');
    expect(result.findings).toHaveLength(1);
    expect(correctionEngine.getFailuresByCategory('UNKNOWN')).toHaveLength(1);
  });

  it('records a failed Code report for bounded follow-up handling', async () => {
    const correctionEngine = new SelfCorrectionEngine(request.runId);
    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: async () => ({ ...executionReport, status: 'FAILED' }),
      reviewWithCodeReviewer: vi.fn(),
    }, correctionEngine);

    const result = await orchestrator.execute(
      'T-701',
      [task({ phase: 'P2' })],
      request,
    );

    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(correctionEngine.getFailuresByCategory('UNKNOWN')).toEqual([
      expect.objectContaining({
        message: 'Code execution reported failure',
        context: expect.objectContaining({
          taskId: 'T-701',
          stage: 'CODE_EXECUTION',
        }),
      }),
    ]);
  });

  it('classifies tasks with human approval gate as BLOCKED even in authorized phase', () => {
    const result = classifyBacklogTasks([
      task({
        taskId: 'T-117',
        phase: 'P1',
        humanApprovalRequired: true,
      }),
      task({
        taskId: 'T-118',
        phase: 'P1',
      }),
    ]);

    expect(result[0].status).toBe('BLOCKED');
    expect(result[0].blockers).toContain('Human approval is required');
    // T-118 should be ELIGIBLE since it's in P1 and has no human approval required
    expect(result[1].status).toBe('ELIGIBLE');
  });

  it('correctly handles T-106B with human approval required', () => {
    const result = classifyBacklogTasks([
      task({
        taskId: 'T-106B',
        phase: 'P1',
        humanApprovalRequired: true,
      }),
    ]);

    expect(result[0].status).toBe('BLOCKED');
    expect(result[0].blockers).toContain('Human approval is required');
  });

  it('treats pending tasks in authorized phases (P1/P2/P3) with no blockers as ELIGIBLE (intentional behavior)', () => {
    const result = classifyBacklogTasks([
      task({ taskId: 'T-P1-PENDING', phase: 'P1', status: 'pending' }),
      task({ taskId: 'T-P2-PENDING', phase: 'P2', status: 'pending' }),
      task({ taskId: 'T-P3-PENDING', phase: 'P3', status: 'pending' }),
      task({ taskId: 'T-P1-PENDING-DEP', phase: 'P1', status: 'pending', dependencies: ['T-P1-PENDING'] }),
    ]);

    const p1Pending = result.find(r => r.taskId === 'T-P1-PENDING')!;
    const p2Pending = result.find(r => r.taskId === 'T-P2-PENDING')!;
    const p3Pending = result.find(r => r.taskId === 'T-P3-PENDING')!;
    const p1PendingDep = result.find(r => r.taskId === 'T-P1-PENDING-DEP')!;

    expect(p1Pending.status).toBe('ELIGIBLE');
    expect(p1Pending.blockers).toHaveLength(0);

    expect(p2Pending.status).toBe('ELIGIBLE');
    expect(p2Pending.blockers).toHaveLength(0);

    // Task with unmet dependency should be BLOCKED
    expect(p1PendingDep.status).toBe('BLOCKED');
    expect(p1PendingDep.blockers.some(b => b.includes('T-P1-PENDING'))).toBe(true);

    expect(p3Pending.status).toBe('ELIGIBLE');
    expect(p3Pending.blockers).toHaveLength(0);
  });

  it('correctly identifies human approval tasks in P1', () => {
    const tasks = [
      task({ taskId: 'T-117', phase: 'P1', humanApprovalRequired: true, title: 'Review moderation' }),
      task({ taskId: 'T-122', phase: 'P1', humanApprovalRequired: true, title: 'Currency decision' }),
      task({ taskId: 'T-106B', phase: 'P1', humanApprovalRequired: true, title: 'Product variants' }),
      task({ taskId: 'T-126', phase: 'P1', humanApprovalRequired: true, title: 'Conceptual model review' }),
      task({ taskId: 'T-118', phase: 'P1', humanApprovalRequired: false, title: 'Independent work' }),
    ];

    const result = classifyBacklogTasks(tasks);

    const blockedWithHumanApproval = result.filter(r => r.blockers.includes('Human approval is required'));
    expect(blockedWithHumanApproval).toHaveLength(4); // T-117, T-122, T-106B, T-126

    const eligible = result.filter(r => r.status === 'ELIGIBLE');
    expect(eligible).toHaveLength(1);
    expect(eligible[0].taskId).toBe('T-118');
  });

  it('correctly identifies tasks beyond authorized phase P2', () => {
    const tasks = [
      task({ taskId: 'T-301', phase: 'P3' }),
      task({ taskId: 'T-401', phase: 'P4' }),
      task({ taskId: 'T-501', phase: 'P5' }),
      task({ taskId: 'T-601', phase: 'P6' }),
      task({ taskId: 'T-701', phase: 'P7' }),
      task({ taskId: 'T-801', phase: 'P8' }),
      task({ taskId: 'T-901', phase: 'P9' }),
      task({ taskId: 'T-1001', phase: 'P10' }),
      task({ taskId: 'T-1101', phase: 'P11' }),
      task({ taskId: 'T-1201', phase: 'P12' }),
    ];

    const result = classifyBacklogTasks(tasks, 2);

    for (const classification of result) {
      expect(classification.status).toBe('BLOCKED');
      expect(classification.blockers.some(b => b.includes('Phase P'))).toBe(true);
      expect(classification.blockers.some(b => b.includes('outside the authorized limit P2'))).toBe(true);
    }
  });

  it('treats unspecified status as BLOCKED with appropriate blocker', () => {
    const result = classifyBacklogTasks([
      task({ taskId: 'T-999', phase: 'P2', status: 'unspecified' }),
    ]);

    expect(result[0].status).toBe('BLOCKED');
    expect(result[0].blockers).toContain('Backlog status is missing or unrecognized');
  });

  it('treats cancelled tasks as CANCELLED', () => {
    const result = classifyBacklogTasks([
      task({ taskId: 'T-999', phase: 'P1', status: 'cancelled' }),
    ]);

    expect(result[0].status).toBe('CANCELLED');
  });

  it('treats rejected_audit tasks as REJECTED_AUDIT', () => {
    const result = classifyBacklogTasks([
      task({ taskId: 'T-999', phase: 'P1', status: 'rejected_audit' }),
    ]);

    expect(result[0].status).toBe('REJECTED_AUDIT');
  });

  it('does not duplicate task IDs in backlog', () => {
    const markdown = [
      '## Phase 1: Test',
      '| ID | Task | Description | Dependencies | Completion Criteria | Status |',
      '| T-100 | Task A | Desc A | — | Criteria A | ⏳ pending |',
      '| T-100 | Task B | Desc B | — | Criteria B | ⏳ pending |',
    ].join('\n');

    expect(() => parseBacklogTasks(markdown)).toThrow('Duplicate task ID in backlog: T-100');
  });
});

describe('FIPR flow orchestration', () => {
  let correctionEngine: SelfCorrectionEngine;
  let mockAgents: {
    delegateToCode: ReturnType<typeof vi.fn>;
    reviewWithCodeReviewer: ReturnType<typeof vi.fn>;
    performDocUpdate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    correctionEngine = new SelfCorrectionEngine('run-123');
    mockAgents = {
      delegateToCode: vi.fn(),
      reviewWithCodeReviewer: vi.fn(),
      performDocUpdate: vi.fn(),
    };
  });

  it('enforces correct FIPR phase sequence: FIX -> IMP -> REVIEW -> DOCUPDATE', async () => {
    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: ['README.md'],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    // Verify phase history via FIPR state (tracks ALL phases including REVIEW and DOCUPDATE)
    const fiprState = orchestrator.getFiprState('T-701');
    expect(fiprState).toBeDefined();
    expect(fiprState!.phaseHistory.map(h => h.phase)).toEqual(['FIX', 'IMP', 'REVIEW', 'DOCUPDATE']);
    expect(mockAgents.performDocUpdate).toHaveBeenCalled();
  });

  it('enters FIX phase first when a task starts', async () => {
    let firstPhase: FIPRPhaseEnum | undefined;

    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      if (!firstPhase) firstPhase = req.fiprPhase!;
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: [],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(firstPhase).toBe('FIX');
  });

  it('delegates to IMP phase after FIX completes', async () => {
    const phases: FIPRPhaseEnum[] = [];

    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      phases.push(req.fiprPhase!);
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: [],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(phases[0]).toBe('FIX');
    expect(phases[1]).toBe('IMP');
  });

  it('delegates to REVIEW phase after IMP completes with COMPLETED', async () => {
    const reviewCalled = { current: false };

    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockImplementation(async () => {
      reviewCalled.current = true;
      return { ...reviewReport, verdict: 'PASS', findings: [] };
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: [],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(reviewCalled.current).toBe(true);
    expect(mockAgents.delegateToCode).toHaveBeenCalledTimes(2); // FIX and IMP
  });

  it('does not mark DOCUPDATE successful when the handler is unavailable', async () => {
    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => ({
      ...executionReport,
      fiprPhase: req.fiprPhase!,
      snapshotId: `snapshot-${req.fiprPhase}`,
    }));
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
    }, correctionEngine);

    const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.docUpdatePerformed).toBe(false);
    expect(result.divergences).toContain('DOCUPDATE phase failed: Doc update handler is not configured');
  });

  it('executes DOCUPDATE phase after REVIEW returns PASS', async () => {
    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => ({
      ...executionReport,
      fiprPhase: req.fiprPhase!,
      snapshotId: `snapshot-${req.fiprPhase}`,
    }));
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: ['docs/readme.md'],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(mockAgents.performDocUpdate).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-123',
      taskId: 'T-701',
    }));
    expect(result.docUpdatePerformed).toBe(true);
    expect(result.docUpdateFiles).toEqual(['docs/readme.md']);
    expect(result.outcome).toBe('PASS');
  });

  describe('CORRECTIONS_NEEDED handling', () => {
    it('returns to FIX phase for code defect findings', async () => {
      const phases: FIPRPhaseEnum[] = [];
      let reviewCallCount = 0;

      mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
        phases.push(req.fiprPhase!);
        return {
          ...executionReport,
          fiprPhase: req.fiprPhase!,
          snapshotId: `snapshot-${req.fiprPhase}-${phases.length}`,
        };
      });
      mockAgents.reviewWithCodeReviewer.mockImplementation(async () => {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          return {
            ...reviewReport,
            verdict: 'CORRECTIONS_NEEDED',
            findings: [{
              id: 'F-1',
              severity: 'HIGH',
              description: 'Code defect: missing null check',
              evidence: ['src/file.ts:42'],
            }],
          };
        }
        return { ...reviewReport, verdict: 'PASS', findings: [] };
      });
      mockAgents.performDocUpdate.mockResolvedValue({
        runId: 'run-123',
        taskId: 'T-701',
        verdict: 'COMPLETED',
        updatedFiles: [],
        errors: [],
      });

      const orchestrator = new SequentialTaskOrchestrator({
        delegateToCode: mockAgents.delegateToCode,
        reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
        performDocUpdate: mockAgents.performDocUpdate,
      }, correctionEngine);

      const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

      expect(phases).toContain('FIX');
      expect(phases).toContain('IMP');
      expect(phases.filter(p => p === 'FIX').length).toBe(2); // Initial FIX + correction FIX
      expect(result.outcome).toBe('PASS');
    });

    it('returns to IMP phase for implementation gap findings', async () => {
      const phases: FIPRPhaseEnum[] = [];
      let reviewCallCount = 0;

      mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
        phases.push(req.fiprPhase!);
        return {
          ...executionReport,
          fiprPhase: req.fiprPhase!,
          snapshotId: `snapshot-${req.fiprPhase}-${phases.length}`,
        };
      });
      mockAgents.reviewWithCodeReviewer.mockImplementation(async () => {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          return {
            ...reviewReport,
            verdict: 'CORRECTIONS_NEEDED',
            findings: [{
              id: 'F-1',
              severity: 'MEDIUM',
              description: 'Implementation gap: missing validation for edge case',
              evidence: ['src/file.ts'],
            }],
          };
        }
        return { ...reviewReport, verdict: 'PASS', findings: [] };
      });
      mockAgents.performDocUpdate.mockResolvedValue({
        runId: 'run-123',
        taskId: 'T-701',
        verdict: 'COMPLETED',
        updatedFiles: [],
        errors: [],
      });

      const orchestrator = new SequentialTaskOrchestrator({
        delegateToCode: mockAgents.delegateToCode,
        reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
        performDocUpdate: mockAgents.performDocUpdate,
      }, correctionEngine);

      const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

      expect(phases).toContain('IMP');
      expect(phases.filter(p => p === 'IMP').length).toBe(2); // Initial IMP + correction IMP
      expect(result.outcome).toBe('PASS');
    });

    it('tracks attempts per finding via SelfCorrectionEngine (max 3)', async () => {
      let reviewCallCount = 0;

      mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
        return {
          ...executionReport,
          fiprPhase: req.fiprPhase!,
          snapshotId: `snapshot-${req.fiprPhase}-${reviewCallCount}`,
        };
      });
      mockAgents.reviewWithCodeReviewer.mockImplementation(async () => {
        reviewCallCount++;
        // Always return CORRECTIONS_NEEDED - orchestrator will stop after max attempts
        return {
          ...reviewReport,
          verdict: 'CORRECTIONS_NEEDED',
          findings: [{
            id: 'F-1',
            severity: 'HIGH',
            description: 'Persistent code defect',
            evidence: ['src/file.ts'],
          }],
        };
      });
      mockAgents.performDocUpdate.mockResolvedValue({
        runId: 'run-123',
        taskId: 'T-701',
        verdict: 'COMPLETED',
        updatedFiles: [],
        errors: [],
      });

      const orchestrator = new SequentialTaskOrchestrator({
        delegateToCode: mockAgents.delegateToCode,
        reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
        performDocUpdate: mockAgents.performDocUpdate,
      }, correctionEngine);

      const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

      // Should have attempted 3 corrections (max 3) + 1 initial = 4 review calls
      // After max attempts, orchestrator returns INCONCLUSIVE
      expect(reviewCallCount).toBe(4);
      expect(correctionEngine.getFailuresByCategory('UNKNOWN').length).toBeGreaterThan(0);
      // After max attempts, should return INCONCLUSIVE
      expect(result.outcome).toBe('INCONCLUSIVE');
      
      // Verify phase history includes all phases
      // For code defects: FIX (initial), IMP (initial), then 3 cycles of REVIEW -> FIX -> IMP
      const fiprState = orchestrator.getFiprState('T-701');
      expect(fiprState).toBeDefined();
      const phases = fiprState!.phaseHistory.map(h => h.phase);
      expect(phases.filter(p => p === 'FIX').length).toBe(4); // Initial + 3 corrections
      expect(phases.filter(p => p === 'IMP').length).toBe(4); // Initial + 3 corrections (after each FIX)
      expect(phases.filter(p => p === 'REVIEW').length).toBe(4); // Initial + 3 corrections
    });

    it('re-delegates to appropriate phase and then REVIEW again', async () => {
      let reviewCallCount = 0;

      mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
        return {
          ...executionReport,
          fiprPhase: req.fiprPhase!,
          snapshotId: `snapshot-${req.fiprPhase}-${reviewCallCount}`,
        };
      });
      mockAgents.reviewWithCodeReviewer.mockImplementation(async () => {
        reviewCallCount++;
        if (reviewCallCount === 1) { // After initial FIX + IMP
          return {
            ...reviewReport,
            verdict: 'CORRECTIONS_NEEDED',
            findings: [{
              id: 'F-1',
              severity: 'HIGH',
              description: 'Code defect',
              evidence: ['src/file.ts'],
            }],
          };
        }
        return { ...reviewReport, verdict: 'PASS', findings: [] };
      });
      mockAgents.performDocUpdate.mockResolvedValue({
        runId: 'run-123',
        taskId: 'T-701',
        verdict: 'COMPLETED',
        updatedFiles: [],
        errors: [],
      });

      const orchestrator = new SequentialTaskOrchestrator({
        delegateToCode: mockAgents.delegateToCode,
        reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
        performDocUpdate: mockAgents.performDocUpdate,
      }, correctionEngine);

      await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

      // Should have: FIX, IMP, REVIEW, FIX (correction), IMP (after correction), REVIEW, DOCUPDATE
      const fiprState = orchestrator.getFiprState('T-701');
      expect(fiprState).toBeDefined();
      expect(fiprState!.phaseHistory.map(h => h.phase)).toEqual(['FIX', 'IMP', 'REVIEW', 'FIX', 'IMP', 'REVIEW', 'DOCUPDATE']);
    });

    it('stops after max attempts and returns INCONCLUSIVE', async () => {
      let reviewCallCount = 0;

      mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
        return {
          ...executionReport,
          fiprPhase: req.fiprPhase!,
          snapshotId: `snapshot-${req.fiprPhase}-${reviewCallCount}`,
        };
      });
      mockAgents.reviewWithCodeReviewer.mockImplementation(async () => {
        reviewCallCount++;
        // Always return CORRECTIONS_NEEDED - orchestrator will stop after max attempts
        return {
          ...reviewReport,
          verdict: 'CORRECTIONS_NEEDED',
          findings: [{
            id: 'F-1',
            severity: 'HIGH',
            description: 'Persistent code defect',
            evidence: ['src/file.ts'],
          }],
        };
      });
      mockAgents.performDocUpdate.mockResolvedValue({
        runId: 'run-123',
        taskId: 'T-701',
        verdict: 'COMPLETED',
        updatedFiles: [],
        errors: [],
      });

      const orchestrator = new SequentialTaskOrchestrator({
        delegateToCode: mockAgents.delegateToCode,
        reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
        performDocUpdate: mockAgents.performDocUpdate,
      }, correctionEngine);

      const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

      // Max 3 attempts per failure, so 3 correction cycles + initial = 4 review calls
      // But should stop at max attempts and return INCONCLUSIVE
      expect(reviewCallCount).toBe(4);
      expect(result.outcome).toBe('INCONCLUSIVE');
      expect(correctionEngine.getState().totalAttempts).toBeLessThanOrEqual(10);
      
      // Verify phase history
      // For code defects: FIX (initial), IMP (initial), then 3 cycles of REVIEW -> FIX -> IMP
      const fiprState = orchestrator.getFiprState('T-701');
      expect(fiprState).toBeDefined();
      const phases = fiprState!.phaseHistory.map(h => h.phase);
      expect(phases.filter(p => p === 'FIX').length).toBe(4); // Initial + 3 corrections
      expect(phases.filter(p => p === 'IMP').length).toBe(4); // Initial + 3 corrections (after each FIX)
      expect(phases.filter(p => p === 'REVIEW').length).toBe(4); // Initial + 3 corrections
    });
  });

  it('stops the flow and returns BLOCKED when review returns BLOCKED', async () => {
    const phases: FIPRPhaseEnum[] = [];

    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      phases.push(req.fiprPhase!);
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'BLOCKED',
      findings: [{
        id: 'F-1',
        severity: 'CRITICAL',
        description: 'Security violation',
        evidence: ['src/file.ts'],
      }],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: [],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(result.outcome).toBe('BLOCKED');
    expect(mockAgents.performDocUpdate).not.toHaveBeenCalled();
    expect(phases).not.toContain('DOCUPDATE');
  });

  it('stops the flow and returns INCONCLUSIVE when review returns INCONCLUSIVE', async () => {
    const phases: FIPRPhaseEnum[] = [];

    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      phases.push(req.fiprPhase!);
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'INCONCLUSIVE',
      findings: [{
        id: 'F-1',
        severity: 'MEDIUM',
        description: 'Insufficient evidence',
        evidence: [],
      }],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: [],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(mockAgents.performDocUpdate).not.toHaveBeenCalled();
  });

  it('does not proceed to review when execution fails, returns INCONCLUSIVE', async () => {
    const phases: FIPRPhaseEnum[] = [];

    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      phases.push(req.fiprPhase!);
      if (req.fiprPhase === 'FIX') {
        return { ...executionReport, status: 'FAILED', fiprPhase: 'FIX' as FIPRPhaseEnum };
      }
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: [],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(mockAgents.reviewWithCodeReviewer).not.toHaveBeenCalled();
    expect(mockAgents.performDocUpdate).not.toHaveBeenCalled();
  });

  it('does not declare success if DOCUPDATE fails', async () => {
    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => ({
      ...executionReport,
      fiprPhase: req.fiprPhase!,
      snapshotId: `snapshot-${req.fiprPhase}`,
    }));
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'FAILED',
      updatedFiles: [],
      errors: ['Failed to write documentation'],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    expect(result.outcome).toBe('INCONCLUSIVE');
    expect(result.docUpdatePerformed).toBe(false);
    expect(result.divergences.some(d => d.includes('DOCUPDATE'))).toBe(true);
  });

  it('tracks phase history and current phase in FIPR state', async () => {
    const phases: FIPRPhaseEnum[] = [];

    mockAgents.delegateToCode.mockImplementation(async (req: TaskDelegationRequest) => {
      phases.push(req.fiprPhase!);
      return {
        ...executionReport,
        fiprPhase: req.fiprPhase!,
        snapshotId: `snapshot-${req.fiprPhase}`,
      };
    });
    mockAgents.reviewWithCodeReviewer.mockResolvedValue({
      ...reviewReport,
      verdict: 'PASS',
      findings: [],
    });
    mockAgents.performDocUpdate.mockResolvedValue({
      runId: 'run-123',
      taskId: 'T-701',
      verdict: 'COMPLETED',
      updatedFiles: ['docs/readme.md'],
      errors: [],
    });

    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    const result = await orchestrator.executeFiprFlow('T-701', [task({ phase: 'P2' })], request);

    // Check that FIPR state is tracked
    const fiprState = orchestrator.getFiprState?.('T-701');
    expect(fiprState).toBeDefined();
    if (fiprState) {
      expect(fiprState.currentPhase).toBe('DOCUPDATE');
      expect(fiprState.phaseHistory.length).toBeGreaterThanOrEqual(3);
      expect(fiprState.phaseHistory.map(h => h.phase)).toEqual(['FIX', 'IMP', 'REVIEW', 'DOCUPDATE']);
      expect(fiprState.fixAttempts).toBe(1);
      expect(fiprState.impAttempts).toBe(1);
    }
  });

  it('does not delegate to itself (no self-delegation)', async () => {
    const orchestrator = new SequentialTaskOrchestrator({
      delegateToCode: mockAgents.delegateToCode,
      reviewWithCodeReviewer: mockAgents.reviewWithCodeReviewer,
      performDocUpdate: mockAgents.performDocUpdate,
    }, correctionEngine);

    // The orchestrator should use the injected agents, not call itself
    // This test verifies the architecture - the orchestrator is a coordinator
    // that delegates to external agents via the AgentDelegationPort
    expect(orchestrator).toBeInstanceOf(SequentialTaskOrchestrator);
    // Verify the agents port is properly typed and not the orchestrator itself
    const port = (orchestrator as unknown as { agents: { delegateToCode: Function } }).agents;
    expect(port.delegateToCode).toBe(mockAgents.delegateToCode);
  });
});

const request: TaskDelegationRequest = {
  runId: 'run-123',
  taskId: 'T-701',
  title: 'Implement product CRUD',
  phase: 'P2',
  baseCommit: 'base-commit',
  dependencies: [],
  acceptanceCriteria: 'API and validation works',
  authorizedScope: 'kilo-orchestration/src/',
  requiredChecks: ['npm test'],
  prohibitedActions: ['git commit', 'git push'],
};

const executionReport: CodeExecutionReport = {
  runId: request.runId,
  taskId: request.taskId,
  executionId: 'execution-123',
  snapshotId: 'snapshot-123',
  baseCommit: request.baseCommit,
  status: 'COMPLETED',
  changedFiles: ['kilo-orchestration/src/agent-orchestrator.ts'],
  commands: [{ command: 'npm test', exitCode: 0, summary: 'All tests passed' }],
  acceptanceEvidence: [{
    criterion: request.acceptanceCriteria,
    evidence: ['agent-orchestrator.test.ts'],
  }],
};

const reviewReport: CodeReviewReport = {
  runId: request.runId,
  taskId: request.taskId,
  snapshotId: executionReport.snapshotId,
  verdict: 'PASS',
  findings: [],
};
