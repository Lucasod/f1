import { describe, it, expect } from 'vitest';
import { writeCheckpoint, loadCheckpoint, safeToAutoReplay, NON_IDEMPOTENT_OPS, ContinuityCheckpoint } from './index';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

describe('Continuity checkpoint', () => {
  it('persists required fields', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    const cp: ContinuityCheckpoint = {
      missionId: 'm1', goal:'g', task:'t', assignedAgent:'dev', objective:'o',
      dependencies:[], relevantPaths:[], authorizedScope:'s', canonicalDecisions:[], recentToolOutcomes:[],
      lastCompletedAction:'a', lastVerifiedTest:'v', currentTddPhase:'red', pendingReviewStatus:'none',
      knownBlockers:[], providerAttemptHistory:[], workingTreeStateSummary:'clean', lastDurableCheckpoint:'x',
      createdAt: new Date().toISOString(), nonIdempotentOpsEncountered: [],
    };
    await writeCheckpoint(cp, { storageDir: dir });
    const loaded = await loadCheckpoint('m1','t', { storageDir: dir });
    expect(loaded).not.toBeNull();
    expect(loaded!.missionId).toBe('m1');
    expect(loaded!.lastVerifiedTest).toBe('v');
  });
  it('non-idempotent ops blocked from auto-replay', () => {
    expect(safeToAutoReplay('db_destructive')).toBe(false);
    expect(safeToAutoReplay('git_mutation')).toBe(false);
    expect(safeToAutoReplay('read_only_inspect')).toBe(true);
    expect(NON_IDEMPOTENT_OPS).toContain('financial_refund');
  });

  // CR-001: nonIdempotentOpsEncountered is a required field
  it('rejects checkpoint missing nonIdempotentOpsEncountered on load (returns null)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    const cp: any = {
      missionId: 'm1', goal:'g', task:'t', assignedAgent:'dev', objective:'o',
      dependencies:[], relevantPaths:[], authorizedScope:'s', canonicalDecisions:[], recentToolOutcomes:[],
      lastCompletedAction:'a', lastVerifiedTest:'v', currentTddPhase:'red', pendingReviewStatus:'none',
      knownBlockers:[], providerAttemptHistory:[], workingTreeStateSummary:'clean', lastDurableCheckpoint:'x',
      createdAt: new Date().toISOString(),
      // nonIdempotentOpsEncountered intentionally omitted
    };
    await writeFile(path.join(dir, 'm1-t.checkpoint.json'), JSON.stringify(cp), 'utf-8');
    const loaded = await loadCheckpoint('m1','t', { storageDir: dir });
    expect(loaded).toBeNull();
  });

  // CR-001: nonIdempotentOpsEncountered must be an array (non-array shape rejected)
  it('rejects checkpoint with non-array nonIdempotentOpsEncountered on load (returns null)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    const cp: any = {
      missionId: 'm1', goal:'g', task:'t', assignedAgent:'dev', objective:'o',
      dependencies:[], relevantPaths:[], authorizedScope:'s', canonicalDecisions:[], recentToolOutcomes:[],
      lastCompletedAction:'a', lastVerifiedTest:'v', currentTddPhase:'red', pendingReviewStatus:'none',
      knownBlockers:[], providerAttemptHistory:[], workingTreeStateSummary:'clean', lastDurableCheckpoint:'x',
      createdAt: new Date().toISOString(), nonIdempotentOpsEncountered: 'not-an-array',
    };
    await writeFile(path.join(dir, 'm1-t.checkpoint.json'), JSON.stringify(cp), 'utf-8');
    const loaded = await loadCheckpoint('m1','t', { storageDir: dir });
    expect(loaded).toBeNull();
  });

  // CR-001: valid checkpoint with non-empty ops array still persists and loads
  it('persists and loads checkpoint with non-empty nonIdempotentOpsEncountered', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    const cp: ContinuityCheckpoint = {
      missionId: 'm1', goal:'g', task:'t', assignedAgent:'dev', objective:'o',
      dependencies:[], relevantPaths:[], authorizedScope:'s', canonicalDecisions:[], recentToolOutcomes:[],
      lastCompletedAction:'a', lastVerifiedTest:'v', currentTddPhase:'red', pendingReviewStatus:'none',
      knownBlockers:[], providerAttemptHistory:[], workingTreeStateSummary:'clean', lastDurableCheckpoint:'x',
      createdAt: new Date().toISOString(), nonIdempotentOpsEncountered: ['db_destructive','git_mutation'],
    };
    await writeCheckpoint(cp, { storageDir: dir });
    const loaded = await loadCheckpoint('m1','t', { storageDir: dir });
    expect(loaded).not.toBeNull();
    expect(loaded!.nonIdempotentOpsEncountered).toEqual(['db_destructive','git_mutation']);
  });

  // CR-002: path traversal / separator sanitization on write
  it('writeCheckpoint rejects missionId containing path separator /', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    const cp: any = {
      missionId: 'm/1', goal:'g', task:'t', assignedAgent:'dev', objective:'o',
      dependencies:[], relevantPaths:[], authorizedScope:'s', canonicalDecisions:[], recentToolOutcomes:[],
      lastCompletedAction:'a', lastVerifiedTest:'v', currentTddPhase:'red', pendingReviewStatus:'none',
      knownBlockers:[], providerAttemptHistory:[], workingTreeStateSummary:'clean', lastDurableCheckpoint:'x',
      createdAt: new Date().toISOString(), nonIdempotentOpsEncountered: [],
    };
    await expect(writeCheckpoint(cp as ContinuityCheckpoint, { storageDir: dir })).rejects.toThrow(/Invalid missionId/);
  });

  it('writeCheckpoint rejects task containing backslash separator', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    const cp: any = {
      missionId: 'm1', goal:'g', task:'t\\x', assignedAgent:'dev', objective:'o',
      dependencies:[], relevantPaths:[], authorizedScope:'s', canonicalDecisions:[], recentToolOutcomes:[],
      lastCompletedAction:'a', lastVerifiedTest:'v', currentTddPhase:'red', pendingReviewStatus:'none',
      knownBlockers:[], providerAttemptHistory:[], workingTreeStateSummary:'clean', lastDurableCheckpoint:'x',
      createdAt: new Date().toISOString(), nonIdempotentOpsEncountered: [],
    };
    await expect(writeCheckpoint(cp as ContinuityCheckpoint, { storageDir: dir })).rejects.toThrow(/Invalid task/);
  });

  it('writeCheckpoint rejects missionId with path traversal ..', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    const cp: any = {
      missionId: '../escape', goal:'g', task:'t', assignedAgent:'dev', objective:'o',
      dependencies:[], relevantPaths:[], authorizedScope:'s', canonicalDecisions:[], recentToolOutcomes:[],
      lastCompletedAction:'a', lastVerifiedTest:'v', currentTddPhase:'red', pendingReviewStatus:'none',
      knownBlockers:[], providerAttemptHistory:[], workingTreeStateSummary:'clean', lastDurableCheckpoint:'x',
      createdAt: new Date().toISOString(), nonIdempotentOpsEncountered: [],
    };
    await expect(writeCheckpoint(cp as ContinuityCheckpoint, { storageDir: dir })).rejects.toThrow(/Invalid missionId/);
  });

  it('loadCheckpoint rejects empty/whitespace missionId (throws)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    await expect(loadCheckpoint('   ', 't', { storageDir: dir })).rejects.toThrow(/Invalid missionId/);
  });

  it('loadCheckpoint rejects empty task (throws)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cp-'));
    await expect(loadCheckpoint('m1', '', { storageDir: dir })).rejects.toThrow(/Invalid task/);
  });

  // CR-003: safeToAutoReplay covers every listed op
  it('safeToAutoReplay rejects every NON_IDEMPOTENT_OP and accepts unknown ops', () => {
    for (const op of NON_IDEMPOTENT_OPS) {
      expect(safeToAutoReplay(op)).toBe(false);
    }
    expect(safeToAutoReplay('non_existent_op')).toBe(true);
  });
});
