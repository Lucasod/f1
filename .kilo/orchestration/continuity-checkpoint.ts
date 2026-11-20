// Durable continuity checkpoint (MP-35 §5.3)

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { CodeExecutionReport } from './types.js';

export const NON_IDEMPOTENT_OPS = [
  'db_destructive',
  'financial_transfer',
  'financial_capture',
  'financial_refund',
  'git_mutation',
  'credential_rotation',
  'prod_deploy',
  'non_idempotent_external_api',
] as const;

export type NonIdempotentOp = typeof NON_IDEMPOTENT_OPS[number];

export interface ContinuityCheckpoint {
  missionId: string;
  goal: string;
  task: string;
  assignedAgent: string;
  objective: string;
  dependencies: string[];
  relevantPaths: string[];
  authorizedScope: string;
  canonicalDecisions: string[];
  recentToolOutcomes: string[];
  lastCompletedAction: string;
  lastVerifiedTest: string;
  currentTddPhase: string;
  pendingReviewStatus: string;
  knownBlockers: string[];
  providerAttemptHistory: string[];
  workingTreeStateSummary: string;
  lastDurableCheckpoint: string;
  createdAt: string;
  nonIdempotentOpsEncountered: NonIdempotentOp[];
  /**
   * CR-002: durable recovery. When an operation completed, the completed
   * CodeExecutionReport is stored under this explicit key so a new port
   * instance can return it without re-running delegation. Optional to keep
   * checkpoints written by older versions loadable (backward compatible).
   */
  completedReport?: CodeExecutionReport;
}

export interface CheckpointStorageOptions { storageDir: string; }

function isValidCheckpoint(c: unknown): c is ContinuityCheckpoint {
  if (!c || typeof c !== 'object') return false;
  const r = c as Record<string, unknown>;
  const required = ['missionId','goal','task','assignedAgent','objective','dependencies','relevantPaths','authorizedScope','canonicalDecisions','recentToolOutcomes','lastCompletedAction','lastVerifiedTest','currentTddPhase','pendingReviewStatus','knownBlockers','providerAttemptHistory','workingTreeStateSummary','lastDurableCheckpoint','createdAt','nonIdempotentOpsEncountered'];
  if (!required.every(f => f in r && r[f] !== undefined && r[f] !== null)) return false;
  // CR-001: nonIdempotentOpsEncountered must be an array; element types are
  // string-preferred but not enforced at load time (see task spec).
  if (!Array.isArray(r['nonIdempotentOpsEncountered'])) return false;

  // completedReport is optional (CR-002); when present it must be an object so
  // a stored CodeExecutionReport can be returned on recovery. Absence is
  // valid for checkpoints written before this field existed.
  const completedReport = r['completedReport'];
  if (completedReport !== undefined && completedReport !== null && typeof completedReport !== 'object') {
    return false;
  }

  return true;
}

/**
 * Sanitizes a path-component identifier (missionId / task) to prevent path
 * traversal and directory-separator injection. Mirrors the style used in
 * `storage.ts` (`isValidRunId` / `validateAndResolvePath`).
 *
 * Throws a descriptive Error on any invalid input: path separators (`/`, `\`),
 * traversal sequences (`..`), or empty/whitespace-only values.
 */
function sanitizePathComponent(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}: must be a non-empty, non-whitespace string`);
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${label}: path separators are not allowed`);
  }
  if (value.includes('..')) {
    throw new Error(`Invalid ${label}: path traversal is not allowed`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`Invalid ${label}: absolute paths are not allowed`);
  }
}

export function safeToAutoReplay(op: string): boolean {
  return !NON_IDEMPOTENT_OPS.includes(op as NonIdempotentOp);
}

export async function writeCheckpoint(cp: ContinuityCheckpoint, opts: CheckpointStorageOptions): Promise<void> {
  if (!isValidCheckpoint(cp)) throw new Error('Invalid checkpoint');
  sanitizePathComponent(cp.missionId, 'missionId');
  sanitizePathComponent(cp.task, 'task');
  await fs.mkdir(opts.storageDir, { recursive: true });
  const filePath = path.join(opts.storageDir, `${cp.missionId}-${cp.task}.checkpoint.json`);
  const tmp = path.join(opts.storageDir, `.tmp.${cp.missionId}.${crypto.randomBytes(4).toString('hex')}.json`);
  await fs.writeFile(tmp, JSON.stringify(cp, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

export async function loadCheckpoint(missionId: string, task: string, opts: CheckpointStorageOptions): Promise<ContinuityCheckpoint | null> {
  sanitizePathComponent(missionId, 'missionId');
  sanitizePathComponent(task, 'task');
  const filePath = path.join(opts.storageDir, `${missionId}-${task}.checkpoint.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const cp = JSON.parse(content);
    if (!isValidCheckpoint(cp)) return null;
    return cp as ContinuityCheckpoint;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
