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
}

export interface RunRecordValidationResult {
  isValid: boolean;
  errors: string[];
}