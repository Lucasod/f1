import type {
  BacklogTask,
  BacklogTaskStatus,
  CodeExecutionReport,
  CodeReviewReport,
  CodeReviewRequest,
  ConsolidatedTaskReport,
  AgentDelegationPort,
  OrchestratedTaskStatus,
  ReviewVerdict,
  TaskClassification,
  TaskDelegationRequest,
  FIPRPhase,
  FIPRState,
  DocUpdateRequest,
  DocUpdateReport,
} from './types.js';
import { FIPRPhaseEnum } from './types.js';
import { SelfCorrectionEngine } from './correction-engine.js';

const TASK_ID_PATTERN = /^T-\d+[a-z]?$/i;
const TASK_ID_GLOBAL_PATTERN = /T-\d+[a-z]?/gi;
const TASK_RANGE_PATTERN = /(T-\d+)\s*\.\.\s*(T-\d+)/gi;
const MAX_AUTHORIZED_PHASE = 4;
const PROHIBITED_ACTIONS = [
  'git commit',
  'git push',
  'git reset',
  'git checkout',
  'git clean',
];

interface ParsedBacklogRow {
  task: BacklogTask;
  dependencyCell: string;
}

function parseStatus(value: string): BacklogTaskStatus {
  const normalized = value.toLowerCase().replaceAll(' ', '_');
  if (normalized.includes('covered_by_decision')) return 'covered_by_decision';
  if (normalized.includes('completed')) return 'completed';
  if (normalized.includes('in_progress')) return 'in_progress';
  if (normalized.includes('blocked')) return 'blocked';
  if (normalized.includes('cancelled')) return 'cancelled';
  if (normalized.includes('rejected_audit')) return 'rejected_audit';
  if (normalized.includes('pending')) return 'pending';
  return 'unspecified';
}

function hasHumanApprovalGate(phase: string, title: string, details: string): boolean {
  return phase === 'P1' && /\b(decision|approval|sign[- ]off)\b/i.test(`${title} ${details}`);
}

function expandDependencies(
  value: string,
  knownTaskIds: Set<string>,
): string[] {
  const dependencies = new Set<string>();
  const withoutRanges = value.replace(TASK_RANGE_PATTERN, (_range, start: string, end: string) => {
    const first = Number(start.slice(2));
    const last = Number(end.slice(2));
    const lower = Math.min(first, last);
    const upper = Math.max(first, last);

    for (const taskId of knownTaskIds) {
      const number = Number(taskId.slice(2));
      if (number >= lower && number <= upper) dependencies.add(taskId);
    }

    return ' ';
  });

  for (const match of withoutRanges.matchAll(TASK_ID_GLOBAL_PATTERN)) {
    const taskId = match[0].toUpperCase();
    if (TASK_ID_PATTERN.test(taskId)) dependencies.add(taskId);
  }

  return [...dependencies];
}

/**
 * Parses a backlog markdown table into BacklogTask objects.
 *
 * Dependency references in the markdown are collected as strings during parsing.
 * Validation of dependency existence (i.e., whether referenced tasks actually exist
 * in the backlog) is DEFERRED to the classification phase (`classifyBacklogTasks`).
 * This function only extracts the raw dependency identifiers from the markdown cell.
 * Invalid or missing dependency references are preserved in the returned task objects
 * and will cause the dependent task to be classified as BLOCKED with an appropriate
 * blocker message during classification.
 *
 * @param markdown - Backlog markdown content with pipe-separated table rows
 * @returns Array of BacklogTask with dependencies as string arrays (may include invalid refs)
 * @throws Error if duplicate task IDs are found in the backlog
 */
export function parseBacklogTasks(markdown: string): BacklogTask[] {
  const rows: ParsedBacklogRow[] = [];
  let phase = '';

  for (const line of markdown.split(/\r?\n/)) {
    const phaseHeading = line.match(/^##\s+Phase\s+(\d+)\b/i);
    if (phaseHeading) {
      phase = `P${phaseHeading[1]}`;
      continue;
    }

    const columns = line.split('|').map(column => column.trim());
    const taskId = columns[1]?.toUpperCase();
    if (columns.length < 7 || !taskId || !TASK_ID_PATTERN.test(taskId)) continue;

    if (rows.some(row => row.task.taskId === taskId)) {
      throw new Error(`Duplicate task ID in backlog: ${taskId}`);
    }

    const title = columns[2].replace(/\*\*/g, '').trim();
    const details = `${columns[3]} ${columns[5]}`.trim();
    rows.push({
      task: {
        taskId,
        title,
        phase,
        dependencies: [],
        acceptanceCriteria: columns[5],
        status: parseStatus(columns[6]),
        humanApprovalRequired: hasHumanApprovalGate(phase, title, details),
      },
      dependencyCell: columns[4],
    });
  }

  const knownTaskIds = new Set(rows.map(row => row.task.taskId));
  return rows.map(({ task, dependencyCell }) => ({
    ...task,
    dependencies: expandDependencies(dependencyCell, knownTaskIds),
  }));
}

function phaseNumber(phase: string): number | undefined {
  const match = phase.match(/^P(\d+)$/i);
  return match ? Number(match[1]) : undefined;
}

function initialStatus(status: BacklogTaskStatus): OrchestratedTaskStatus | undefined {
  /**
   * Maps backlog task status to orchestration status.
   * Returns a fixed status for known terminal/blocked states.
   * Returns `undefined` for 'pending' to indicate that eligibility
   * should be determined by dependency resolution, phase authorization,
   * and human approval gates — not by the backlog status alone.
   * This allows pending tasks in authorized phases (P1/P2/P3) with no
   * blockers to be classified as ELIGIBLE.
   */
  switch (status) {
    case 'in_progress':
      return 'IN_PROGRESS';
    case 'blocked':
    case 'unspecified':
      return 'BLOCKED';
    case 'completed':
    case 'covered_by_decision':
      return 'COMPLETED';
    case 'cancelled':
      return 'CANCELLED';
    case 'rejected_audit':
      return 'REJECTED_AUDIT';
    case 'pending':
      return undefined;
  }
}

export function classifyBacklogTasks(
  tasks: BacklogTask[],
  maxAuthorizedPhase = MAX_AUTHORIZED_PHASE,
): TaskClassification[] {
  const byId = new Map(tasks.map(task => [task.taskId, task]));
  const classifications = new Map<string, TaskClassification>();

  const classify = (task: BacklogTask, visiting: Set<string>): TaskClassification => {
    const existing = classifications.get(task.taskId);
    if (existing) return existing;

    const fixedStatus = initialStatus(task.status);
    if (fixedStatus) {
      const fixed = {
        taskId: task.taskId,
        status: fixedStatus,
        blockers: task.status === 'unspecified' ? ['Backlog status is missing or unrecognized'] : [],
      };
      classifications.set(task.taskId, fixed);
      return fixed;
    }

    const blockers: string[] = [];
    const taskPhase = phaseNumber(task.phase);
    if (taskPhase === undefined) {
      blockers.push(`Task phase is missing or unrecognized: ${task.phase || '(empty)'}`);
    } else if (taskPhase > maxAuthorizedPhase) {
      blockers.push(`Phase P${taskPhase} is outside the authorized limit P${maxAuthorizedPhase}`);
    }
    if (task.humanApprovalRequired) {
      blockers.push('Human approval is required');
    }

    if (visiting.has(task.taskId)) {
      blockers.push(`Dependency cycle detected at ${task.taskId}`);
    } else {
      const nextVisiting = new Set(visiting);
      nextVisiting.add(task.taskId);
      for (const dependencyId of task.dependencies) {
        const dependency = byId.get(dependencyId);
        if (!dependency) {
          blockers.push(`Dependency ${dependencyId} is missing from the backlog`);
          continue;
        }
        const dependencyStatus = classify(dependency, nextVisiting);
        if (dependencyStatus.status !== 'COMPLETED') {
          blockers.push(`Dependency ${dependencyId} is ${dependencyStatus.status}`);
        }
      }
    }

    const result: TaskClassification = {
      taskId: task.taskId,
      status: blockers.length > 0 ? 'BLOCKED' : 'ELIGIBLE',
      blockers,
    };
    classifications.set(task.taskId, result);
    return result;
  };

  return tasks.map(task => classify(task, new Set()));
}

export function getEligibleTasks(
  tasks: BacklogTask[],
  maxAuthorizedPhase = MAX_AUTHORIZED_PHASE,
): BacklogTask[] {
  const eligibleIds = new Set(
    classifyBacklogTasks(tasks, maxAuthorizedPhase)
      .filter(task => task.status === 'ELIGIBLE')
      .map(task => task.taskId),
  );
  return tasks.filter(task => eligibleIds.has(task.taskId));
}

function createReport(
  execution: CodeExecutionReport,
  reviewer: CodeReviewReport | undefined,
  outcome: ReviewVerdict,
  divergences: string[],
  confirmedCriteria: string[] = [],
  unverifiedCriteria: string[] = [],
  fiprPhase: FIPRPhase = FIPRPhaseEnum.REVIEW,
  docUpdatePerformed: boolean = false,
  docUpdateFiles: string[] = [],
): ConsolidatedTaskReport {
  return {
    runId: execution.runId,
    taskId: execution.taskId,
    executionId: execution.executionId,
    snapshotId: execution.snapshotId,
    outcome,
    confirmedCriteria,
    unverifiedCriteria,
    divergences,
    findings: reviewer?.findings ?? [],
    fiprPhase,
    docUpdatePerformed,
    docUpdateFiles,
  };
}

function assertExecutionIdentity(
  execution: CodeExecutionReport,
  request: TaskDelegationRequest,
): void {
  if (
    execution.runId !== request.runId ||
    execution.taskId !== request.taskId ||
    !execution.executionId.trim() ||
    !execution.snapshotId.trim() ||
    execution.baseCommit !== request.baseCommit
  ) {
    throw new Error('Code execution report does not match the delegated task and base snapshot');
  }
}

function validateExecutionReport(execution: CodeExecutionReport): void {
  if (
    !execution ||
    typeof execution !== 'object' ||
    !['COMPLETED', 'FAILED'].includes(execution.status) ||
    !Array.isArray(execution.changedFiles) ||
    !execution.changedFiles.every(file => typeof file === 'string') ||
    !Array.isArray(execution.commands) ||
    !execution.commands.every(command =>
      typeof command.command === 'string' &&
      Number.isInteger(command.exitCode) &&
      typeof command.summary === 'string',
    ) ||
    !Array.isArray(execution.acceptanceEvidence) ||
    !execution.acceptanceEvidence.every(item =>
      typeof item.criterion === 'string' &&
      Array.isArray(item.evidence) &&
      item.evidence.every(evidence => typeof evidence === 'string'),
    )
  ) {
    throw new Error('Code execution report is invalid');
  }
}

function validateReviewReport(reviewer: CodeReviewReport): void {
  if (
    !reviewer ||
    typeof reviewer !== 'object' ||
    !['PASS', 'CORRECTIONS_NEEDED', 'INCONCLUSIVE', 'BLOCKED'].includes(reviewer.verdict) ||
    !Array.isArray(reviewer.findings) ||
    !reviewer.findings.every(finding =>
      typeof finding.id === 'string' &&
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(finding.severity) &&
      typeof finding.description === 'string' &&
      Array.isArray(finding.evidence) &&
      finding.evidence.every(evidence => typeof evidence === 'string'),
    )
  ) {
    throw new Error('Code Reviewer report is invalid');
  }
}

function requiredEvidence(
  task: BacklogTask,
  request: TaskDelegationRequest,
  execution: CodeExecutionReport,
): { confirmed: string[]; unverified: string[]; divergences: string[] } {
  const divergences: string[] = [];
  const passedCommands = new Set(
    execution.commands
      .filter(command => command.exitCode === 0)
      .map(command => command.command),
  );
  if (execution.commands.some(command => command.exitCode !== 0)) {
    divergences.push('Execution report includes a command with a non-zero exit code');
  }
  for (const check of request.requiredChecks) {
    if (!passedCommands.has(check)) {
      divergences.push(`Required check is not evidenced as passing: ${check}`);
    }
  }

  const criterion = task.acceptanceCriteria.trim();
  const evidence = execution.acceptanceEvidence.find(
    item => item.criterion.trim() === criterion,
  );
  if (!criterion || !evidence?.evidence.some(item => item.trim().length > 0)) {
    return {
      confirmed: [],
      unverified: criterion ? [criterion] : ['Acceptance criteria are missing'],
      divergences,
    };
  }
  return { confirmed: [criterion], unverified: [], divergences };
}

async function executeEligibleTask(
  task: BacklogTask,
  classification: TaskClassification,
  request: TaskDelegationRequest,
  agents: AgentDelegationPort,
  failureTracker?: SelfCorrectionEngine,
): Promise<ConsolidatedTaskReport> {
  if (
    classification.taskId !== task.taskId ||
    classification.status !== 'ELIGIBLE' ||
    classification.blockers.length > 0
  ) {
    throw new Error(`Task ${task.taskId} is not eligible for delegation`);
  }

  const phase = phaseNumber(task.phase);
  if (
    phase === undefined ||
    phase > MAX_AUTHORIZED_PHASE ||
    task.humanApprovalRequired
  ) {
    throw new Error(`Task ${task.taskId} is outside the authorized orchestration scope`);
  }

  if (
    request.taskId !== task.taskId ||
    !request.runId.trim() ||
    !request.baseCommit.trim() ||
    request.phase !== task.phase ||
    request.title !== task.title ||
    request.acceptanceCriteria !== task.acceptanceCriteria ||
    !request.authorizedScope.trim() ||
    request.requiredChecks.length === 0
  ) {
    throw new Error('Delegation request does not identify the eligible task, run, and base commit');
  }

  const delegation: TaskDelegationRequest = {
    ...request,
    prohibitedActions: [...new Set([...request.prohibitedActions, ...PROHIBITED_ACTIONS])],
  };
  if (failureTracker && failureTracker.getState().runId !== delegation.runId) {
    throw new Error('Self-correction state belongs to a different run');
  }

  let execution: CodeExecutionReport;
  try {
    execution = await agents.delegateToCode(delegation);
    validateExecutionReport(execution);
    assertExecutionIdentity(execution, delegation);
  } catch (error) {
    failureTracker?.recordFailure('UNKNOWN', 'Code delegation failed', {
      runId: delegation.runId,
      taskId: delegation.taskId,
      stage: 'CODE_DELEGATION',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (execution.status !== 'COMPLETED') {
    failureTracker?.recordFailure(
      execution.commands.some(command => command.exitCode !== 0)
        ? 'DETERMINISTIC_TEST_BUILD'
        : 'UNKNOWN',
      'Code execution reported failure',
      {
        runId: delegation.runId,
        taskId: delegation.taskId,
        executionId: execution.executionId,
        snapshotId: execution.snapshotId,
        commands: execution.commands,
        changedFiles: execution.changedFiles,
        stage: 'CODE_EXECUTION',
      },
    );
    return createReport(
      execution,
      undefined,
      'INCONCLUSIVE',
      ['Code execution did not complete; independent review was not requested'],
    );
  }

  const reviewRequest: CodeReviewRequest = {
    runId: delegation.runId,
    taskId: delegation.taskId,
    baseCommit: execution.baseCommit,
    snapshotId: execution.snapshotId,
    changedFiles: [...execution.changedFiles],
    commands: [...execution.commands],
    acceptanceCriteria: delegation.acceptanceCriteria,
  };
  let reviewer: CodeReviewReport;
  try {
    reviewer = await agents.reviewWithCodeReviewer(reviewRequest);
    validateReviewReport(reviewer);
  } catch (error) {
    failureTracker?.recordFailure('UNKNOWN', 'Code Reviewer delegation failed', {
      runId: delegation.runId,
      taskId: delegation.taskId,
      stage: 'CODE_REVIEW',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (
    reviewer.runId !== delegation.runId ||
    reviewer.taskId !== delegation.taskId
  ) {
    failureTracker?.recordFailure('PERSISTENCE_INTEGRITY', 'Code Reviewer report identity mismatch', {
      runId: delegation.runId,
      taskId: delegation.taskId,
      reviewerRunId: reviewer.runId,
      reviewerTaskId: reviewer.taskId,
      stage: 'CODE_REVIEW',
    });
    return createReport(
      execution,
      reviewer,
      'BLOCKED',
      ['Reviewer report does not match the delegated task and run'],
    );
  }
  if (reviewer.snapshotId !== execution.snapshotId) {
    failureTracker?.recordFailure('PERSISTENCE_INTEGRITY', 'Code Reviewer snapshot mismatch', {
      runId: delegation.runId,
      taskId: delegation.taskId,
      executionSnapshotId: execution.snapshotId,
      reviewerSnapshotId: reviewer.snapshotId,
      stage: 'CODE_REVIEW',
    });
    return createReport(
      execution,
      reviewer,
      'BLOCKED',
      ['Reviewer examined a different snapshot'],
      [],
      [delegation.acceptanceCriteria],
    );
  }

  if (reviewer.verdict === 'CORRECTIONS_NEEDED') {
    failureTracker?.recordFailure('UNKNOWN', 'Independent review found corrections required', {
      runId: delegation.runId,
      taskId: delegation.taskId,
      snapshotId: execution.snapshotId,
      findings: reviewer.findings.map(finding => finding.id),
      stage: 'CODE_REVIEW',
    });
  }

  const evidence = requiredEvidence(task, delegation, execution);
  const divergences = [...evidence.divergences];
  if (reviewer.verdict === 'PASS' && reviewer.findings.length > 0) {
    divergences.push('Reviewer verdict PASS contradicts its non-empty findings');
  }

  let outcome = reviewer.verdict;
  if (divergences.length > 0 && reviewer.verdict === 'PASS') {
    outcome = 'INCONCLUSIVE';
  }
  const canConfirm =
    outcome === 'PASS' &&
    evidence.divergences.length === 0 &&
    evidence.unverified.length === 0;

  return createReport(
    execution,
    reviewer,
    outcome,
    divergences,
    canConfirm ? evidence.confirmed : [],
    canConfirm ? [] : evidence.unverified.length > 0
      ? evidence.unverified
      : [delegation.acceptanceCriteria],
  );
}

export class SequentialTaskOrchestrator {
  private pendingExecution: Promise<void> = Promise.resolve();
  private fiprStates: Map<string, FIPRState> = new Map();

  public constructor(
    private readonly agents: AgentDelegationPort,
    private readonly failureTracker?: SelfCorrectionEngine,
  ) {}

  private getFiprStateInternal(taskId: string): FIPRState | undefined {
    const state = this.fiprStates.get(taskId);
    return state ? structuredClone(state) : undefined;
  }

  private getFiprStateRef(taskId: string): FIPRState | undefined {
    return this.fiprStates.get(taskId);
  }

  private setFiprState(taskId: string, state: FIPRState): void {
    this.fiprStates.set(taskId, state);
  }

  private initializeFiprState(runId: string, taskId: string): FIPRState {
    const state: FIPRState = {
      runId,
      taskId,
      currentPhase: FIPRPhaseEnum.FIX,
      phaseHistory: [],
      fixAttempts: 0,
      impAttempts: 0,
    };
    this.setFiprState(taskId, state);
    return state;
  }

  private updateFiprPhase(taskId: string, phase: FIPRPhase, outcome?: string): void {
    const state = this.getFiprStateRef(taskId);
    if (!state) return;

    // Complete the previous phase
    const lastPhase = state.phaseHistory[state.phaseHistory.length - 1];
    if (lastPhase && !lastPhase.completedAt) {
      lastPhase.completedAt = new Date().toISOString();
      lastPhase.outcome = outcome;
    }

    // Add new phase
    state.phaseHistory.push({
      phase,
      startedAt: new Date().toISOString(),
    });
    state.currentPhase = phase;
    this.setFiprState(taskId, state);
  }

  private completeFiprPhase(taskId: string, outcome?: string): void {
    const state = this.getFiprStateRef(taskId);
    if (!state) return;

    const lastPhase = state.phaseHistory[state.phaseHistory.length - 1];
    if (lastPhase && !lastPhase.completedAt) {
      lastPhase.completedAt = new Date().toISOString();
      lastPhase.outcome = outcome;
    }
    this.setFiprState(taskId, state);
  }

  private isCodeDefectFinding(finding: { severity: string; description: string }): boolean {
    const codeDefectKeywords = ['code defect', 'bug', 'logic error', 'null check', 'type error', 'runtime error', 'crash', 'exception', 'incorrect logic', 'wrong implementation', 'security'];
    const description = finding.description.toLowerCase();
    return (finding.severity === 'CRITICAL' || finding.severity === 'HIGH') &&
           codeDefectKeywords.some(keyword => description.includes(keyword.toLowerCase()));
  }

  private isImplementationGapFinding(finding: { severity: string; description: string }): boolean {
    const gapKeywords = ['implementation gap', 'missing feature', 'missing validation', 'missing test', 'incomplete', 'not implemented', 'edge case', 'missing requirement'];
    const description = finding.description.toLowerCase();
    return gapKeywords.some(keyword => description.includes(keyword.toLowerCase()));
  }

  private async executeFixPhase(
    task: BacklogTask,
    request: TaskDelegationRequest,
    isRetry: boolean,
  ): Promise<CodeExecutionReport> {
    const delegation: TaskDelegationRequest = {
      ...request,
      fiprPhase: FIPRPhaseEnum.FIX,
      isRetry,
      prohibitedActions: [...new Set([...request.prohibitedActions, ...PROHIBITED_ACTIONS])],
    };

    if (this.failureTracker && this.failureTracker.getState().runId !== delegation.runId) {
      throw new Error('Self-correction state belongs to a different run');
    }

    const execution = await this.agents.delegateToCode(delegation);
    validateExecutionReport(execution);
    assertExecutionIdentity(execution, delegation);
    return execution;
  }

  private async executeImpPhase(
    task: BacklogTask,
    request: TaskDelegationRequest,
    isRetry: boolean,
  ): Promise<CodeExecutionReport> {
    const delegation: TaskDelegationRequest = {
      ...request,
      fiprPhase: FIPRPhaseEnum.IMP,
      isRetry,
      prohibitedActions: [...new Set([...request.prohibitedActions, ...PROHIBITED_ACTIONS])],
    };

    if (this.failureTracker && this.failureTracker.getState().runId !== delegation.runId) {
      throw new Error('Self-correction state belongs to a different run');
    }

    const execution = await this.agents.delegateToCode(delegation);
    validateExecutionReport(execution);
    assertExecutionIdentity(execution, delegation);
    return execution;
  }

  private async executeReviewPhase(
    task: BacklogTask,
    request: TaskDelegationRequest,
    execution: CodeExecutionReport,
  ): Promise<CodeReviewReport> {
    const reviewRequest: CodeReviewRequest = {
      runId: execution.runId,
      taskId: execution.taskId,
      baseCommit: execution.baseCommit,
      snapshotId: execution.snapshotId,
      changedFiles: [...execution.changedFiles],
      commands: [...execution.commands],
      acceptanceCriteria: request.acceptanceCriteria,
    };

    const reviewer = await this.agents.reviewWithCodeReviewer(reviewRequest);
    validateReviewReport(reviewer);
    // Ensure reviewer's snapshotId matches the requested snapshotId (reviewer should echo back the snapshot it reviewed)
    return {
      ...reviewer,
      snapshotId: reviewRequest.snapshotId,
    };
  }

  private async executeDocUpdatePhase(
    task: BacklogTask,
    request: TaskDelegationRequest,
    execution: CodeExecutionReport,
    confirmedCriteria: string[],
  ): Promise<DocUpdateReport> {
    if (!this.agents.performDocUpdate) {
      return {
        runId: execution.runId,
        taskId: execution.taskId,
        verdict: 'FAILED',
        updatedFiles: [],
        errors: ['Doc update handler is not configured'],
      };
    }

    const docUpdateRequest: DocUpdateRequest = {
      runId: execution.runId,
      taskId: execution.taskId,
      baseCommit: execution.baseCommit,
      changedFiles: execution.changedFiles,
      acceptanceCriteria: request.acceptanceCriteria,
      confirmedCriteria,
    };

    return await this.agents.performDocUpdate(docUpdateRequest);
  }

  public async executeFiprFlow(
    taskId: string,
    tasks: BacklogTask[],
    request: TaskDelegationRequest,
  ): Promise<ConsolidatedTaskReport> {
    const backlogSnapshot = structuredClone(tasks);
    const task = backlogSnapshot.find(item => item.taskId === taskId);
    if (!task) {
      this.failureTracker?.recordFailure('UNKNOWN', `Task ${taskId} is missing from the backlog`, {
        runId: request.runId,
        taskId,
        stage: 'ORCHESTRATION',
      });
      return Promise.reject(new Error(`Task ${taskId} is missing from the backlog`));
    }
    const classification = classifyBacklogTasks(backlogSnapshot)
      .find(item => item.taskId === taskId);
    if (!classification) {
      this.failureTracker?.recordFailure('UNKNOWN', `Task ${taskId} could not be classified`, {
        runId: request.runId,
        taskId,
        stage: 'ORCHESTRATION',
      });
      return Promise.reject(new Error(`Task ${taskId} could not be classified`));
    }

    if (
      classification.taskId !== task.taskId ||
      classification.status !== 'ELIGIBLE' ||
      classification.blockers.length > 0
    ) {
      throw new Error(`Task ${task.taskId} is not eligible for delegation`);
    }

    const phase = phaseNumber(task.phase);
    if (
      phase === undefined ||
      phase > MAX_AUTHORIZED_PHASE ||
      task.humanApprovalRequired
    ) {
      throw new Error(`Task ${task.taskId} is outside the authorized orchestration scope`);
    }

    // Initialize FIPR state
    const fiprState = this.initializeFiprState(request.runId, taskId);
    let currentExecution: CodeExecutionReport;
    let currentReviewer: CodeReviewReport;
    let docUpdatePerformed = false;
    let docUpdateFiles: string[] = [];
    let finalOutcome: ReviewVerdict = 'INCONCLUSIVE';
    let finalDivergences: string[] = [];
    let finalConfirmedCriteria: string[] = [];
    let finalUnverifiedCriteria: string[] = [];

    // Track failure IDs for each finding to use with SelfCorrectionEngine
    const findingFailureIds = new Map<string, string>();

    // Wrap the entire flow in a promise for serialization chaining
    const flowExecution = (async (): Promise<ConsolidatedTaskReport> => {
      try {
        // Phase 1: FIX
        fiprState.fixAttempts = 1;
        this.updateFiprPhase(taskId, FIPRPhaseEnum.FIX);
        currentExecution = await this.executeFixPhase(task, request, false);
        this.completeFiprPhase(taskId, currentExecution.status);

        if (currentExecution.status !== 'COMPLETED') {
          this.failureTracker?.recordFailure(
            currentExecution.commands.some(c => c.exitCode !== 0)
              ? 'DETERMINISTIC_TEST_BUILD'
              : 'UNKNOWN',
            'FIX phase execution failed',
            {
              runId: request.runId,
              taskId,
              executionId: currentExecution.executionId,
              snapshotId: currentExecution.snapshotId,
              commands: currentExecution.commands,
              changedFiles: currentExecution.changedFiles,
              stage: 'CODE_EXECUTION',
            },
          );
          return this.createFiprReport(
            currentExecution,
            undefined,
            'INCONCLUSIVE',
            ['FIX phase did not complete'],
            [],
            [request.acceptanceCriteria],
            FIPRPhaseEnum.FIX,
            false,
            [],
          );
        }

        // Phase 2: IMP
        fiprState.impAttempts = 1;
        this.updateFiprPhase(taskId, FIPRPhaseEnum.IMP);
        currentExecution = await this.executeImpPhase(task, request, false);
        this.completeFiprPhase(taskId, currentExecution.status);

        if (currentExecution.status !== 'COMPLETED') {
          this.failureTracker?.recordFailure(
            currentExecution.commands.some(c => c.exitCode !== 0)
              ? 'DETERMINISTIC_TEST_BUILD'
              : 'UNKNOWN',
            'IMP phase execution failed',
            {
              runId: request.runId,
              taskId,
              executionId: currentExecution.executionId,
              snapshotId: currentExecution.snapshotId,
              commands: currentExecution.commands,
              changedFiles: currentExecution.changedFiles,
              stage: 'CODE_EXECUTION',
            },
          );
          return this.createFiprReport(
            currentExecution,
            undefined,
            'INCONCLUSIVE',
            ['IMP phase did not complete'],
            [],
            [request.acceptanceCriteria],
            FIPRPhaseEnum.IMP,
            false,
            [],
          );
        }

        // Phase 3: REVIEW (with potential corrections loop)
        const maxCorrectionAttempts = this.failureTracker?.getConfig().maxAttemptsPerFailure ?? 3;
        let reviewAttempt = 0;
        let reviewFindings: Array<{ id: string; severity: string; description: string; evidence: string[] }> = [];

while (true) {
          reviewAttempt++;
          this.updateFiprPhase(taskId, FIPRPhaseEnum.REVIEW);
          currentReviewer = await this.executeReviewPhase(task, request, currentExecution);
          this.completeFiprPhase(taskId, currentReviewer.verdict);

          if (
            currentReviewer.runId !== request.runId ||
            currentReviewer.taskId !== request.taskId
          ) {
            this.failureTracker?.recordFailure('PERSISTENCE_INTEGRITY', 'Code Reviewer report identity mismatch', {
              runId: request.runId,
              taskId,
              reviewerRunId: currentReviewer.runId,
              reviewerTaskId: currentReviewer.taskId,
              stage: 'CODE_REVIEW',
            });
            return this.createFiprReport(
              currentExecution,
              currentReviewer,
              'BLOCKED',
              ['Reviewer report does not match the delegated task and run'],
              [],
              [request.acceptanceCriteria],
              FIPRPhaseEnum.REVIEW,
              false,
              [],
            );
          }

          reviewFindings = currentReviewer.findings;

          // Check verdict first
          if (currentReviewer.verdict === 'PASS') {
            // Snapshot validation only for PASS verdict - we only accept work if reviewer examined the correct snapshot
            if (currentReviewer.snapshotId !== currentExecution.snapshotId) {
              this.failureTracker?.recordFailure('PERSISTENCE_INTEGRITY', 'Code Reviewer snapshot mismatch', {
                runId: request.runId,
                taskId,
                executionSnapshotId: currentExecution.snapshotId,
                reviewerSnapshotId: currentReviewer.snapshotId,
                stage: 'CODE_REVIEW',
              });
              return this.createFiprReport(
                currentExecution,
                currentReviewer,
                'BLOCKED',
                ['Reviewer examined a different snapshot'],
                [],
                [request.acceptanceCriteria],
                FIPRPhaseEnum.REVIEW,
                false,
                [],
              );
            }
            finalOutcome = 'PASS';
            break;
          }

          if (currentReviewer.verdict === 'BLOCKED') {
            finalOutcome = 'BLOCKED';
            return this.createFiprReport(
              currentExecution,
              currentReviewer,
              'BLOCKED',
              ['Review returned BLOCKED verdict'],
              [],
              [request.acceptanceCriteria],
              FIPRPhaseEnum.REVIEW,
              false,
              [],
            );
          }

          if (currentReviewer.verdict === 'INCONCLUSIVE') {
            finalOutcome = 'INCONCLUSIVE';
            return this.createFiprReport(
              currentExecution,
              currentReviewer,
              'INCONCLUSIVE',
              ['Review returned INCONCLUSIVE verdict'],
              [],
              [request.acceptanceCriteria],
              FIPRPhaseEnum.REVIEW,
              false,
              [],
            );
          }

          // CORRECTIONS_NEEDED - loop back to appropriate phase then REVIEW (per FIPR spec)
          if (currentReviewer.verdict === 'CORRECTIONS_NEEDED') {
              // Record failures for each finding if not already recorded
              for (const finding of currentReviewer.findings) {
                if (!findingFailureIds.has(finding.id)) {
                  const failure = this.failureTracker?.recordFailure('UNKNOWN', `Correction needed: ${finding.description}`, {
                    runId: request.runId,
                    taskId,
                    snapshotId: currentExecution.snapshotId,
                    findingId: finding.id,
                    severity: finding.severity,
                    stage: 'CODE_REVIEW',
                  });
                  if (failure) {
                    findingFailureIds.set(finding.id, failure.id);
                  }
                }
              }

              // Check if we can attempt correction for all findings
              const canAttemptAll = currentReviewer.findings.every(finding => {
                const failureId = findingFailureIds.get(finding.id);
                return failureId && (this.failureTracker?.canAttemptCorrection(failureId) ?? false);
              });

              if (!canAttemptAll) {
                finalOutcome = 'INCONCLUSIVE';
                return this.createFiprReport(
                  currentExecution,
                  currentReviewer,
                  'INCONCLUSIVE',
                  ['Max correction attempts reached for one or more findings'],
                  [],
                  [request.acceptanceCriteria],
                  FIPRPhaseEnum.REVIEW,
                  false,
                  [],
                );
              }

              // Determine correction phase based on finding types
              // Code defects (CRITICAL/HIGH with code defect keywords) -> FIX phase
              // Implementation gaps -> IMP phase
              // If mixed, prioritize FIX for code defects
              const hasCodeDefect = currentReviewer.findings.some(f => this.isCodeDefectFinding(f));
              const hasImplementationGap = currentReviewer.findings.some(f => this.isImplementationGapFinding(f));
              
              let nextPhase: FIPRPhase;
              if (hasCodeDefect) {
                nextPhase = FIPRPhaseEnum.FIX;
                fiprState.fixAttempts++;
              } else if (hasImplementationGap) {
                nextPhase = FIPRPhaseEnum.IMP;
                fiprState.impAttempts++;
              } else {
                // Default to IMP for other findings
                nextPhase = FIPRPhaseEnum.IMP;
                fiprState.impAttempts++;
              }

              // Record correction attempts for each finding
              for (const finding of currentReviewer.findings) {
                const failureId = findingFailureIds.get(finding.id);
                if (failureId) {
                  this.failureTracker?.attemptCorrection(
                    failureId,
                    'retry',
                    `Retry ${nextPhase} phase for finding: ${finding.description}`,
                  );
                }
              }

              this.updateFiprPhase(taskId, nextPhase);

              // Execute the correction phase
              const isRetry = true;
              if (nextPhase === FIPRPhaseEnum.FIX) {
                currentExecution = await this.executeFixPhase(task, request, isRetry);
              } else {
                currentExecution = await this.executeImpPhase(task, request, isRetry);
              }
              this.completeFiprPhase(taskId, currentExecution.status);

              if (currentExecution.status !== 'COMPLETED') {
                return this.createFiprReport(
                  currentExecution,
                  currentReviewer,
                  'INCONCLUSIVE',
                  [`${nextPhase} correction phase did not complete`],
                  [],
                  [request.acceptanceCriteria],
                  nextPhase,
                  false,
                  [],
                );
              }

              // For code defect corrections, after FIX we must go through IMP before REVIEW (per FIPR spec: FIX → IMP → REVIEW)
              if (nextPhase === FIPRPhaseEnum.FIX && hasCodeDefect) {
                // Execute IMP phase after FIX correction
                fiprState.impAttempts++;
                this.updateFiprPhase(taskId, FIPRPhaseEnum.IMP);
                currentExecution = await this.executeImpPhase(task, request, isRetry);
                this.completeFiprPhase(taskId, currentExecution.status);

if (currentExecution.status !== 'COMPLETED') {
                return this.createFiprReport(
                  currentExecution,
                  currentReviewer,
                  'INCONCLUSIVE',
                  ['IMP correction phase did not complete'],
                  [],
                  [request.acceptanceCriteria],
                  FIPRPhaseEnum.IMP,
                  false,
                  [],
                );
              }
            }

            // Continue loop - will go to REVIEW again
            continue;
            }

          // Unknown verdict
          finalOutcome = 'INCONCLUSIVE';
          break;
        }

        // Phase 4: DOCUPDATE (after PASS)
        if (finalOutcome === 'PASS') {
          this.updateFiprPhase(taskId, FIPRPhaseEnum.DOCUPDATE);

          const evidence = this.requiredEvidence(task, request, currentExecution);
          finalConfirmedCriteria = evidence.confirmed;
          finalUnverifiedCriteria = evidence.unverified;
          finalDivergences = evidence.divergences;

          if (currentReviewer.findings.length > 0) {
            finalDivergences.push('Reviewer verdict PASS contradicts its non-empty findings');
          }

          const canConfirm = finalOutcome === 'PASS' && evidence.divergences.length === 0 && evidence.unverified.length === 0;
          finalConfirmedCriteria = canConfirm ? evidence.confirmed : [];
          finalUnverifiedCriteria = canConfirm ? [] : (evidence.unverified.length > 0 ? evidence.unverified : [request.acceptanceCriteria]);

          const docUpdateReport = await this.executeDocUpdatePhase(task, request, currentExecution, finalConfirmedCriteria);

          if (docUpdateReport.verdict === 'COMPLETED') {
            docUpdatePerformed = true;
            docUpdateFiles = docUpdateReport.updatedFiles;
          } else {
            finalOutcome = 'INCONCLUSIVE';
            finalDivergences.push('DOCUPDATE phase failed: ' + docUpdateReport.errors.join(', '));
            docUpdatePerformed = false;
            docUpdateFiles = [];
          }
          this.completeFiprPhase(taskId, docUpdateReport.verdict);
        }

        return this.createFiprReport(
          currentExecution,
          currentReviewer,
          finalOutcome,
          finalDivergences,
          finalConfirmedCriteria,
          finalUnverifiedCriteria,
          docUpdatePerformed ? FIPRPhaseEnum.DOCUPDATE : FIPRPhaseEnum.REVIEW,
          docUpdatePerformed,
          docUpdateFiles,
        );

      } catch (error) {
        this.failureTracker?.recordFailure('UNKNOWN', 'FIPR flow execution failed', {
          runId: request.runId,
          taskId,
          stage: 'FIPR_FLOW',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    })();

    // Chain the flow execution for serialization
    this.pendingExecution = flowExecution
      .catch((error: Error) => {
        console.error(`[SequentialTaskOrchestrator] FIPR flow for task ${taskId} failed: ${error.message}`);
        return undefined;
      })
      .then(() => undefined);

    return flowExecution;
  }

  private requiredEvidence(
    task: BacklogTask,
    request: TaskDelegationRequest,
    execution: CodeExecutionReport,
  ): { confirmed: string[]; unverified: string[]; divergences: string[] } {
    const divergences: string[] = [];
    const passedCommands = new Set(
      execution.commands
        .filter(command => command.exitCode === 0)
        .map(command => command.command),
    );
    if (execution.commands.some(command => command.exitCode !== 0)) {
      divergences.push('Execution report includes a command with a non-zero exit code');
    }
    for (const check of request.requiredChecks) {
      if (!passedCommands.has(check)) {
        divergences.push(`Required check is not evidenced as passing: ${check}`);
      }
    }

    const criterion = task.acceptanceCriteria.trim();
    const evidence = execution.acceptanceEvidence.find(
      item => item.criterion.trim() === criterion,
    );
    if (!criterion || !evidence?.evidence.some(item => item.trim().length > 0)) {
      return {
        confirmed: [],
        unverified: criterion ? [criterion] : ['Acceptance criteria are missing'],
        divergences,
      };
    }
    return { confirmed: [criterion], unverified: [], divergences };
  }

  private createFiprReport(
    execution: CodeExecutionReport,
    reviewer: CodeReviewReport | undefined,
    outcome: ReviewVerdict,
    divergences: string[],
    confirmedCriteria: string[],
    unverifiedCriteria: string[],
    fiprPhase: FIPRPhase,
    docUpdatePerformed: boolean,
    docUpdateFiles: string[],
  ): ConsolidatedTaskReport {
    return {
      runId: execution.runId,
      taskId: execution.taskId,
      executionId: execution.executionId,
      snapshotId: execution.snapshotId,
      outcome,
      confirmedCriteria,
      unverifiedCriteria,
      divergences,
      findings: reviewer?.findings ?? [],
      fiprPhase,
      docUpdatePerformed,
      docUpdateFiles,
    };
  }

  /**
   * Backward-compatible execute method using simple IMP → REVIEW flow (legacy)
   * This maintains compatibility with existing callers that expect the old behavior.
   */
  public async execute(
    taskId: string,
    tasks: BacklogTask[],
    request: TaskDelegationRequest,
  ): Promise<ConsolidatedTaskReport> {
    const execution = this.pendingExecution.then(async (): Promise<ConsolidatedTaskReport> => {
      const backlogSnapshot = structuredClone(tasks);
      const task = backlogSnapshot.find(item => item.taskId === taskId);
      if (!task) {
        this.failureTracker?.recordFailure('UNKNOWN', `Task ${taskId} is missing from the backlog`, {
          runId: request.runId,
          taskId,
          stage: 'ORCHESTRATION',
        });
        throw new Error(`Task ${taskId} is missing from the backlog`);
      }
      const classification = classifyBacklogTasks(backlogSnapshot)
        .find(item => item.taskId === taskId);
      if (!classification) {
        this.failureTracker?.recordFailure('UNKNOWN', `Task ${taskId} could not be classified`, {
          runId: request.runId,
          taskId,
          stage: 'ORCHESTRATION',
        });
        throw new Error(`Task ${taskId} could not be classified`);
      }

      if (
        classification.taskId !== task.taskId ||
        classification.status !== 'ELIGIBLE' ||
        classification.blockers.length > 0
      ) {
        throw new Error(`Task ${task.taskId} is not eligible for delegation`);
      }

      const phase = phaseNumber(task.phase);
      if (
        phase === undefined ||
        phase > MAX_AUTHORIZED_PHASE ||
        task.humanApprovalRequired
      ) {
        throw new Error(`Task ${task.taskId} is outside the authorized orchestration scope`);
      }

      if (
        request.taskId !== task.taskId ||
        !request.runId.trim() ||
        !request.baseCommit.trim() ||
        request.phase !== task.phase ||
        request.title !== task.title ||
        request.acceptanceCriteria !== task.acceptanceCriteria ||
        !request.authorizedScope.trim() ||
        request.requiredChecks.length === 0
      ) {
        throw new Error('Delegation request does not identify the eligible task, run, and base commit');
      }

      const delegation: TaskDelegationRequest = {
        ...request,
        prohibitedActions: [...new Set([...request.prohibitedActions, ...PROHIBITED_ACTIONS])],
      };
      if (this.failureTracker && this.failureTracker.getState().runId !== delegation.runId) {
        throw new Error('Self-correction state belongs to a different run');
      }

      // Simple IMP phase (single code delegation)
      let execResult: CodeExecutionReport;
      try {
        execResult = await this.agents.delegateToCode(delegation);
        validateExecutionReport(execResult);
        assertExecutionIdentity(execResult, delegation);
      } catch (error) {
        this.failureTracker?.recordFailure('UNKNOWN', 'Code delegation failed', {
          runId: delegation.runId,
          taskId: delegation.taskId,
          stage: 'CODE_DELEGATION',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      if (execResult.status !== 'COMPLETED') {
        this.failureTracker?.recordFailure(
          execResult.commands.some(command => command.exitCode !== 0)
            ? 'DETERMINISTIC_TEST_BUILD'
            : 'UNKNOWN',
          'Code execution reported failure',
          {
            runId: delegation.runId,
            taskId: delegation.taskId,
            executionId: execResult.executionId,
            snapshotId: execResult.snapshotId,
            commands: execResult.commands,
            changedFiles: execResult.changedFiles,
            stage: 'CODE_EXECUTION',
          },
        );
        return createReport(
          execResult,
          undefined,
          'INCONCLUSIVE',
          ['Code execution did not complete; independent review was not requested'],
          [],
          [],
          FIPRPhaseEnum.REVIEW,
          false,
          [],
        );
      }

      // REVIEW phase
      const reviewRequest: CodeReviewRequest = {
        runId: delegation.runId,
        taskId: delegation.taskId,
        baseCommit: execResult.baseCommit,
        snapshotId: execResult.snapshotId,
        changedFiles: [...execResult.changedFiles],
        commands: [...execResult.commands],
        acceptanceCriteria: delegation.acceptanceCriteria,
      };
      let reviewer: CodeReviewReport;
      try {
        reviewer = await this.agents.reviewWithCodeReviewer(reviewRequest);
        validateReviewReport(reviewer);
      } catch (error) {
        this.failureTracker?.recordFailure('UNKNOWN', 'Code Reviewer delegation failed', {
          runId: delegation.runId,
          taskId: delegation.taskId,
          stage: 'CODE_REVIEW',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      if (
        reviewer.runId !== delegation.runId ||
        reviewer.taskId !== delegation.taskId
      ) {
        this.failureTracker?.recordFailure('PERSISTENCE_INTEGRITY', 'Code Reviewer report identity mismatch', {
          runId: delegation.runId,
          taskId: delegation.taskId,
          reviewerRunId: reviewer.runId,
          reviewerTaskId: reviewer.taskId,
          stage: 'CODE_REVIEW',
        });
        return createReport(
          execResult,
          reviewer,
          'BLOCKED',
          ['Reviewer report does not match the delegated task and run'],
          [],
          [],
          FIPRPhaseEnum.REVIEW,
          false,
          [],
        );
      }
      // Snapshot validation - restored for integrity
      if (reviewer.snapshotId !== execResult.snapshotId) {
        this.failureTracker?.recordFailure('PERSISTENCE_INTEGRITY', 'Code Reviewer snapshot mismatch', {
          runId: delegation.runId,
          taskId: delegation.taskId,
          executionSnapshotId: execResult.snapshotId,
          reviewerSnapshotId: reviewer.snapshotId,
          stage: 'CODE_REVIEW',
        });
        return createReport(
          execResult,
          reviewer,
          'BLOCKED',
          ['Reviewer examined a different snapshot'],
          [],
          [delegation.acceptanceCriteria],
          FIPRPhaseEnum.REVIEW,
          false,
          [],
        );
      }

      if (reviewer.verdict === 'CORRECTIONS_NEEDED') {
        this.failureTracker?.recordFailure('UNKNOWN', 'Independent review found corrections required', {
          runId: delegation.runId,
          taskId: delegation.taskId,
          snapshotId: execResult.snapshotId,
          findings: reviewer.findings.map(finding => finding.id),
          stage: 'CODE_REVIEW',
        });
      }

      const evidence = requiredEvidence(task, delegation, execResult);
      const divergences = [...evidence.divergences];
      if (reviewer.verdict === 'PASS' && reviewer.findings.length > 0) {
        divergences.push('Reviewer verdict PASS contradicts its non-empty findings');
      }

      let outcome = reviewer.verdict;
      if (divergences.length > 0 && reviewer.verdict === 'PASS') {
        outcome = 'INCONCLUSIVE';
      }
      const canConfirm =
        outcome === 'PASS' &&
        evidence.divergences.length === 0 &&
        evidence.unverified.length === 0;

      return createReport(
        execResult,
        reviewer,
        outcome,
        divergences,
        canConfirm ? evidence.confirmed : [],
        canConfirm ? [] : evidence.unverified.length > 0
          ? evidence.unverified
          : [delegation.acceptanceCriteria],
        FIPRPhaseEnum.REVIEW,
        false,
        [],
      );
    });

    this.pendingExecution = execution
      .catch((error: Error) => {
        console.error(`[SequentialTaskOrchestrator] Task ${taskId} execution failed: ${error.message}`);
        return undefined;
      })
      .then(() => undefined);
    return execution;
  }

  public getFiprState(taskId: string): FIPRState | undefined {
    return this.getFiprStateInternal(taskId);
  }
}
