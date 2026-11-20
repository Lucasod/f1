import {
  RunRecord,
  RunRecordValidationResult,
  RunStatus,
  FailureRecord,
  CorrectionAttempt,
  SelfCorrectionState,
  SelfCorrectionConfig,
  SelfCorrectionValidationResult,
  FailureCategory,
  CorrectionStatus,
  OrchestratedTaskStatus,
} from './types.js';

const VALID_STATUSES: RunStatus[] = ['IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'PAUSED'];
const REQUIRED_FIELDS: (keyof Required<RunRecord>)[] = ['runId', 'startedAt', 'status', 'updatedAt'];

const VALID_FAILURE_CATEGORIES: FailureCategory[] = [
  'TRANSIENT',
  'DETERMINISTIC_TEST_BUILD',
  'CONFIGURATION',
  'PERSISTENCE_INTEGRITY',
  'PERMISSION_POLICY',
  'UNKNOWN',
];

const VALID_CORRECTION_STATUSES: CorrectionStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED_POLICY',
  'MAX_ATTEMPTS_REACHED',
  'NO_PROGRESS',
];
const VALID_TASK_STATUSES: OrchestratedTaskStatus[] = [
  'ELIGIBLE',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED_AUDIT',
];

const isValidISO8601 = (dateString: string): boolean => {
  const date = new Date(dateString);
  return !isNaN(date.getTime()) && dateString === date.toISOString();
};

const isValidRunStatus = (status: string): status is RunStatus => {
  return VALID_STATUSES.includes(status as RunStatus);
};

const isValidFailureCategory = (category: string): category is FailureCategory => {
  return VALID_FAILURE_CATEGORIES.includes(category as FailureCategory);
};

const isValidCorrectionStatus = (status: string): status is CorrectionStatus => {
  return VALID_CORRECTION_STATUSES.includes(status as CorrectionStatus);
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

  if ('orchestration' in r && r.orchestration !== undefined) {
    const orchestrationValidation = validateOrchestrationSnapshot(r.orchestration);
    if (!orchestrationValidation.isValid) {
      errors.push(...orchestrationValidation.errors.map(error => `orchestration: ${error}`));
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateOrchestrationSnapshot(record: unknown): RunRecordValidationResult {
  const errors: string[] = [];
  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['must be a non-null object'] };
  }

  const snapshot = record as Record<string, unknown>;
  if (typeof snapshot.generatedAt !== 'string' || !isValidISO8601(snapshot.generatedAt)) {
    errors.push('generatedAt must be a valid ISO 8601 date string');
  }
  if (
    typeof snapshot.maxAuthorizedPhase !== 'number' ||
    !Number.isInteger(snapshot.maxAuthorizedPhase) ||
    snapshot.maxAuthorizedPhase < 0
  ) {
    errors.push('maxAuthorizedPhase must be a non-negative integer');
  }
  if (!Array.isArray(snapshot.classifications)) {
    errors.push('classifications must be an array');
  } else {
    const taskIds = new Set<string>();
    snapshot.classifications.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        errors.push(`classifications[${index}] must be an object`);
        return;
      }
      const classification = item as Record<string, unknown>;
      if (typeof classification.taskId !== 'string' || classification.taskId.trim().length === 0) {
        errors.push(`classifications[${index}].taskId must be a non-empty string`);
      } else if (taskIds.has(classification.taskId)) {
        errors.push(`classifications contains duplicate taskId: ${classification.taskId}`);
      } else {
        taskIds.add(classification.taskId);
      }
      if (
        typeof classification.status !== 'string' ||
        !VALID_TASK_STATUSES.includes(classification.status as OrchestratedTaskStatus)
      ) {
        errors.push(`classifications[${index}].status is invalid`);
      }
      if (
        !Array.isArray(classification.blockers) ||
        !classification.blockers.every(blocker => typeof blocker === 'string')
      ) {
        errors.push(`classifications[${index}].blockers must be an array of strings`);
      }
    });
  }

  return { isValid: errors.length === 0, errors };
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

export function validateFailureRecord(record: unknown): SelfCorrectionValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['FailureRecord must be a non-null object'] };
  }

  const r = record as Record<string, unknown>;

  const requiredFields: (keyof FailureRecord)[] = [
    'id',
    'category',
    'message',
    'context',
    'timestamp',
    'attempt',
    'maxAttempts',
  ];

  for (const field of requiredFields) {
    if (!(field in r) || r[field] === undefined || r[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if ('id' in r && (typeof r.id !== 'string' || r.id.trim().length === 0)) {
    errors.push('id must be a non-empty string');
  }

  if ('category' in r && !isValidFailureCategory(r.category as string)) {
    errors.push(`category must be one of: ${VALID_FAILURE_CATEGORIES.join(', ')}`);
  }

  if ('message' in r && (typeof r.message !== 'string' || r.message.trim().length === 0)) {
    errors.push('message must be a non-empty string');
  }

  if ('context' in r && (typeof r.context !== 'object' || r.context === null)) {
    errors.push('context must be an object');
  }

  if ('timestamp' in r && !isValidISO8601(r.timestamp as string)) {
    errors.push('timestamp must be a valid ISO 8601 date string');
  }

  if ('attempt' in r && (
    typeof r.attempt !== 'number' ||
    !Number.isInteger(r.attempt) ||
    r.attempt < 1
  )) {
    errors.push('attempt must be a positive integer');
  }

  if ('maxAttempts' in r && (
    typeof r.maxAttempts !== 'number' ||
    !Number.isInteger(r.maxAttempts) ||
    r.maxAttempts < 1
  )) {
    errors.push('maxAttempts must be a positive integer');
  }

  if ('attempt' in r && 'maxAttempts' in r) {
    const attempt = r.attempt as number;
    const maxAttempts = r.maxAttempts as number;
    if (attempt > maxAttempts) {
      errors.push('attempt cannot exceed maxAttempts');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateCorrectionAttempt(record: unknown): SelfCorrectionValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['CorrectionAttempt must be a non-null object'] };
  }

  const r = record as Record<string, unknown>;

  const requiredFields: (keyof CorrectionAttempt)[] = [
    'failureId',
    'attempt',
    'action',
    'description',
    'authorized',
    'startedAt',
  ];

  for (const field of requiredFields) {
    if (!(field in r) || r[field] === undefined || r[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if ('failureId' in r && (typeof r.failureId !== 'string' || r.failureId.trim().length === 0)) {
    errors.push('failureId must be a non-empty string');
  }

  if ('attempt' in r && (
    typeof r.attempt !== 'number' ||
    !Number.isInteger(r.attempt) ||
    r.attempt < 1
  )) {
    errors.push('attempt must be a positive integer');
  }

  if ('action' in r && (typeof r.action !== 'string' || r.action.trim().length === 0)) {
    errors.push('action must be a non-empty string');
  }

  if ('description' in r && (typeof r.description !== 'string' || r.description.trim().length === 0)) {
    errors.push('description must be a non-empty string');
  }

  if ('authorized' in r && typeof r.authorized !== 'boolean') {
    errors.push('authorized must be a boolean');
  }

  if ('startedAt' in r && !isValidISO8601(r.startedAt as string)) {
    errors.push('startedAt must be a valid ISO 8601 date string');
  }

  if ('completedAt' in r && r.completedAt !== undefined) {
    if (!isValidISO8601(r.completedAt as string)) {
      errors.push('completedAt must be a valid ISO 8601 date string');
    }
  }

  if ('result' in r && r.result !== undefined) {
    const resultValidation = validateCorrectionResult(r.result);
    if (!resultValidation.isValid) {
      errors.push(...resultValidation.errors.map(e => `result: ${e}`));
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateCorrectionResult(record: unknown): SelfCorrectionValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['CorrectionResult must be a non-null object'] };
  }

  const r = record as Record<string, unknown>;

  if (!('status' in r) || r.status === undefined || r.status === null) {
    errors.push('Missing required field: status');
  }
  if ('status' in r && !isValidCorrectionStatus(r.status as string)) {
    errors.push(`status must be one of: ${VALID_CORRECTION_STATUSES.join(', ')}`);
  }

  if (!('message' in r) || r.message === undefined || r.message === null) {
    errors.push('Missing required field: message');
  }
  if ('message' in r && (typeof r.message !== 'string' || r.message.trim().length === 0)) {
    errors.push('message must be a non-empty string');
  }

  if ('evidence' in r && r.evidence !== undefined) {
    if (typeof r.evidence !== 'object' || r.evidence === null) {
      errors.push('evidence must be an object or undefined');
    }
  }

  if ('filesModified' in r && r.filesModified !== undefined) {
    if (!Array.isArray(r.filesModified) || !r.filesModified.every(f => typeof f === 'string')) {
      errors.push('filesModified must be an array of strings or undefined');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateSelfCorrectionState(record: unknown): SelfCorrectionValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['SelfCorrectionState must be a non-null object'] };
  }

  const r = record as Record<string, unknown>;

  const requiredFields: (keyof SelfCorrectionState)[] = [
    'runId',
    'failures',
    'corrections',
    'maxAttemptsPerFailure',
    'totalAttempts',
    'lastUpdated',
  ];

  for (const field of requiredFields) {
    if (!(field in r) || r[field] === undefined || r[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if ('runId' in r && (typeof r.runId !== 'string' || r.runId.trim().length === 0)) {
    errors.push('runId must be a non-empty string');
  }

  if ('failures' in r) {
    if (!Array.isArray(r.failures)) {
      errors.push('failures must be an array');
    } else {
      for (let i = 0; i < r.failures.length; i++) {
        const failureValidation = validateFailureRecord(r.failures[i]);
        if (!failureValidation.isValid) {
          errors.push(...failureValidation.errors.map(e => `failures[${i}]: ${e}`));
        }
      }
    }
  }

  if ('corrections' in r) {
    if (!Array.isArray(r.corrections)) {
      errors.push('corrections must be an array');
    } else {
      for (let i = 0; i < r.corrections.length; i++) {
        const correctionValidation = validateCorrectionAttempt(r.corrections[i]);
        if (!correctionValidation.isValid) {
          errors.push(...correctionValidation.errors.map(e => `corrections[${i}]: ${e}`));
        }
      }
    }
  }

  if ('maxAttemptsPerFailure' in r && (typeof r.maxAttemptsPerFailure !== 'number' || r.maxAttemptsPerFailure < 1)) {
    errors.push('maxAttemptsPerFailure must be a positive integer');
  }

  if ('totalAttempts' in r && (typeof r.totalAttempts !== 'number' || r.totalAttempts < 0)) {
    errors.push('totalAttempts must be a non-negative integer');
  }

  if ('lastUpdated' in r && !isValidISO8601(r.lastUpdated as string)) {
    errors.push('lastUpdated must be a valid ISO 8601 date string');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateSelfCorrectionConfig(record: unknown): SelfCorrectionValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { isValid: false, errors: ['SelfCorrectionConfig must be a non-null object'] };
  }

  const r = record as Record<string, unknown>;

  if ('maxAttemptsPerFailure' in r && (
    typeof r.maxAttemptsPerFailure !== 'number' ||
    !Number.isInteger(r.maxAttemptsPerFailure) ||
    r.maxAttemptsPerFailure < 1
  )) {
    errors.push('maxAttemptsPerFailure must be a positive integer');
  }

  if ('maxTotalAttempts' in r && (
    typeof r.maxTotalAttempts !== 'number' ||
    !Number.isInteger(r.maxTotalAttempts) ||
    r.maxTotalAttempts < 1
  )) {
    errors.push('maxTotalAttempts must be a positive integer');
  }

  if ('allowedCorrectionPaths' in r) {
    if (!Array.isArray(r.allowedCorrectionPaths) || !r.allowedCorrectionPaths.every(
      p => typeof p === 'string' && p.trim().length > 0 &&
        !p.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(p) &&
        !p.replace(/\\/g, '/').split('/').includes('..'),
    )) {
      errors.push('allowedCorrectionPaths must be an array of strings');
    }
  }

  if ('blockedActions' in r) {
    if (!Array.isArray(r.blockedActions) || !r.blockedActions.every(
      a => typeof a === 'string' && a.trim().length > 0,
    )) {
      errors.push('blockedActions must be an array of strings');
    }
  }

  if ('requireReviewFor' in r) {
    if (!Array.isArray(r.requireReviewFor) || !r.requireReviewFor.every(
      a => typeof a === 'string' && a.trim().length > 0,
    )) {
      errors.push('requireReviewFor must be an array of strings');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}