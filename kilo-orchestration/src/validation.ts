import { RunRecord, RunRecordValidationResult, RunStatus } from './types.js';

const VALID_STATUSES: RunStatus[] = ['IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'PAUSED'];
const REQUIRED_FIELDS: (keyof Required<RunRecord>)[] = ['runId', 'startedAt', 'status', 'updatedAt'];

const isValidISO8601 = (dateString: string): boolean => {
  const date = new Date(dateString);
  return !isNaN(date.getTime()) && dateString === date.toISOString();
};

const isValidRunStatus = (status: string): status is RunStatus => {
  return VALID_STATUSES.includes(status as RunStatus);
};

export function validateRunRecord(record: unknown): RunRecordValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['Record must be a non-null object'] };
  }

  const r = record as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    const fieldStr = String(field);
    if (!(fieldStr in r) || r[fieldStr] === undefined || r[fieldStr] === null) {
      errors.push(`Missing required field: ${fieldStr}`);
    }
  }

  if ('runId' in r && (typeof r.runId !== 'string' || r.runId.trim().length === 0)) {
    errors.push('runId must be a non-empty string');
  }

  if ('startedAt' in r && !isValidISO8601(r.startedAt as string)) {
    errors.push('startedAt must be a valid ISO 8601 date string');
  }

  if ('updatedAt' in r && !isValidISO8601(r.updatedAt as string)) {
    errors.push('updatedAt must be a valid ISO 8601 date string');
  }

  if ('status' in r && !isValidRunStatus(r.status as string)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if ('branch' in r && r.branch !== undefined && typeof r.branch !== 'string') {
    errors.push('branch must be a string or undefined');
  }

  if ('baseCommit' in r && r.baseCommit !== undefined && typeof r.baseCommit !== 'string') {
    errors.push('baseCommit must be a string or undefined');
  }

  if ('scope' in r && r.scope !== undefined && typeof r.scope !== 'string') {
    errors.push('scope must be a string or undefined');
  }

  if ('nextAction' in r && r.nextAction !== undefined && typeof r.nextAction !== 'string') {
    errors.push('nextAction must be a string or undefined');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function createRunRecord(params: {
  runId: string;
  startedAt: string;
  status: RunStatus;
  branch?: string;
  baseCommit?: string;
  scope?: string;
  nextAction?: string;
}): RunRecord {
  const now = new Date().toISOString();
  return {
    runId: params.runId,
    startedAt: params.startedAt,
    status: params.status,
    branch: params.branch,
    baseCommit: params.baseCommit,
    scope: params.scope,
    nextAction: params.nextAction,
    updatedAt: now,
  };
}