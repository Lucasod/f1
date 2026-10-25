export type RunStatus =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'PAUSED';

export interface RunRecord {
  runId: string;
  startedAt: string;
  status: RunStatus;
  branch?: string;
  baseCommit?: string;
  scope?: string;
  nextAction?: string;
  updatedAt: string;
  orchestration?: OrchestrationSnapshot;
}

export interface RunRecordValidationResult {
  isValid: boolean;
  errors: string[];
}

// Self-Correction Types
export type FailureCategory =
  | 'TRANSIENT'
  | 'DETERMINISTIC_TEST_BUILD'
  | 'CONFIGURATION'
  | 'PERSISTENCE_INTEGRITY'
  | 'PERMISSION_POLICY'
  | 'UNKNOWN';

export type CorrectionStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'BLOCKED_POLICY'
  | 'MAX_ATTEMPTS_REACHED'
  | 'NO_PROGRESS';

export interface FailureRecord {
  id: string;
  category: FailureCategory;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
  attempt: number;
  maxAttempts: number;
}

export interface CorrectionAttempt {
  failureId: string;
  attempt: number;
  action: string;
  description: string;
  authorized: boolean;
  startedAt: string;
  completedAt?: string;
  result?: CorrectionResult;
}

export interface CorrectionResult {
  status: CorrectionStatus;
  message: string;
  evidence?: Record<string, unknown>;
  filesModified?: string[];
}

export interface SelfCorrectionState {
  runId: string;
  failures: FailureRecord[];
  corrections: CorrectionAttempt[];
  maxAttemptsPerFailure: number;
  totalAttempts: number;
  lastUpdated: string;
}

export interface SelfCorrectionConfig {
  maxAttemptsPerFailure: number;
  maxTotalAttempts: number;
  allowedCorrectionPaths: string[];
  blockedActions: string[];
  requireReviewFor: string[];
}

export interface SelfCorrectionValidationResult {
  isValid: boolean;
  errors: string[];
}

export type BacklogTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'covered_by_decision'
  | 'cancelled'
  | 'rejected_audit'
  | 'unspecified';

export type OrchestratedTaskStatus =
  | 'ELIGIBLE'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED_AUDIT';

export interface BacklogTask {
  taskId: string;
  title: string;
  phase: string;
  dependencies: string[];
  acceptanceCriteria: string;
  status: BacklogTaskStatus;
  humanApprovalRequired: boolean;
}

export interface TaskClassification {
  taskId: string;
  status: OrchestratedTaskStatus;
  blockers: string[];
}

export interface TaskDelegationRequest {
  runId: string;
  taskId: string;
  title: string;
  phase: string;
  baseCommit: string;
  dependencies: string[];
  acceptanceCriteria: string;
  authorizedScope: string;
  requiredChecks: string[];
  prohibitedActions: string[];
}

export interface CommandEvidence {
  command: string;
  exitCode: number;
  summary: string;
}

export interface AcceptanceEvidence {
  criterion: string;
  evidence: string[];
}

export interface CodeExecutionReport {
  runId: string;
  taskId: string;
  executionId: string;
  snapshotId: string;
  baseCommit: string;
  status: 'COMPLETED' | 'FAILED';
  changedFiles: string[];
  commands: CommandEvidence[];
  acceptanceEvidence: AcceptanceEvidence[];
}

export type ReviewVerdict =
  | 'PASS'
  | 'CORRECTIONS_NEEDED'
  | 'INCONCLUSIVE'
  | 'BLOCKED';

export interface ReviewFinding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  evidence: string[];
}

export interface CodeReviewReport {
  runId: string;
  taskId: string;
  snapshotId: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
}

export interface CodeReviewRequest {
  runId: string;
  taskId: string;
  baseCommit: string;
  snapshotId: string;
  changedFiles: string[];
  commands: CommandEvidence[];
  acceptanceCriteria: string;
}

export interface OrchestrationAgentPort {
  delegateToCode(request: TaskDelegationRequest): Promise<CodeExecutionReport>;
  reviewWithCodeReviewer(request: CodeReviewRequest): Promise<CodeReviewReport>;
}

export interface ConsolidatedTaskReport {
  runId: string;
  taskId: string;
  executionId: string;
  snapshotId: string;
  outcome: ReviewVerdict;
  confirmedCriteria: string[];
  unverifiedCriteria: string[];
  divergences: string[];
  findings: ReviewFinding[];
}

export interface OrchestrationSnapshot {
  generatedAt: string;
  maxAuthorizedPhase: number;
  classifications: TaskClassification[];
}