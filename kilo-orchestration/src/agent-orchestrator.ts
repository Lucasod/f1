import type {
  BacklogTask,
  BacklogTaskStatus,
  CodeExecutionReport,
  CodeReviewReport,
  CodeReviewRequest,
  ConsolidatedTaskReport,
  OrchestrationAgentPort,
  OrchestratedTaskStatus,
  ReviewVerdict,
  TaskClassification,
  TaskDelegationRequest,
} from './types.js';
import { SelfCorrectionEngine } from './correction-engine.js';

const TASK_ID_PATTERN = /^T-\d+[a-z]?$/i;
const TASK_ID_GLOBAL_PATTERN = /T-\d+[a-z]?/gi;
const TASK_RANGE_PATTERN = /(T-\d+)\s*\.\.\s*(T-\d+)/gi;
const MAX_AUTHORIZED_PHASE = 2;
const PROHIBITED_ACTIONS = [
  'git commit',
  'git push',
  'git reset',
  'git checkout',
  'git clean',
  'P3',
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
  agents: OrchestrationAgentPort,
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

  public constructor(
    private readonly agents: OrchestrationAgentPort,
    private readonly failureTracker?: SelfCorrectionEngine,
  ) {}

  public execute(
    taskId: string,
    tasks: BacklogTask[],
    request: TaskDelegationRequest,
  ): Promise<ConsolidatedTaskReport> {
    const backlogSnapshot = structuredClone(tasks);
    const task = backlogSnapshot.find(item => item.taskId === taskId);
    if (!task) {
      return Promise.reject(new Error(`Task ${taskId} is missing from the backlog`));
    }
    const classification = classifyBacklogTasks(backlogSnapshot)
      .find(item => item.taskId === taskId);
    if (!classification) {
      return Promise.reject(new Error(`Task ${taskId} could not be classified`));
    }

    const execution = this.pendingExecution.then(() =>
      executeEligibleTask(task, classification, request, this.agents, this.failureTracker),
    );
    this.pendingExecution = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}
