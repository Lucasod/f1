import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export const IDLE_INTERVALS_MINUTES = [30, 60, 90, 120, 180];

export interface Clock { now(): Date; }
export interface IdleQueueSnapshot {
  tasks: any[];
  readyTaskIds: string[];
  completedTaskIds: string[];
  pendingReviewIds: string[];
  blockedTaskIds: string[];
  newlyAuthorizedTaskIds: string[];
  executionPathUsable: Record<string, boolean>;
  reviewedAt?: any;
  [key: string]: any;
}
export interface IdleQueueProbe { snapshot(): Promise<IdleQueueSnapshot>; }

export interface IdleDecision {
  action: 'EXECUTE' | 'RECHECK' | 'IDLE' | 'SAFE_STOP';
  reason: string;
  passCount: number;
  idleCycle?: number;
  nextCheckAt?: string | null;
  nextCheckInMs?: number;
  taskId?: string;
}

interface Scheduler { supported: boolean; requestWakeAt?: (iso: string) => Promise<any>; }
interface EngineOptions {
  missionId: string; task: string; clock?: Clock; storageDir?: string;
  scheduler?: Scheduler; ownerId?: string; authorizedNonIdempotentOps?: string[];
}
interface PersistedState {
  missionId: string; task: string; nextCheckAt: string | null;
  executionCounter: number; completedTaskIds: string[]; lastQueueSignature: string | null;
  resetReason: string | null; idleCycle: number; passCount: number;
  idleCycleCompleted: number; schedulerActive: boolean; claimedBy: string | null;
}

function stableSignature(snap: IdleQueueSnapshot): string {
  const normTasks = (snap.tasks || []).map((t: any) => ({
    id: t.id, status: t.status, depsSatisfied: t.depsSatisfied, op: t.op,
  })).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
  const obj = {
    tasks: normTasks,
    readyTaskIds: [...(snap.readyTaskIds || [])].sort(),
    completedTaskIds: [...(snap.completedTaskIds || [])].sort(),
    pendingReviewIds: [...(snap.pendingReviewIds || [])].sort(),
    blockedTaskIds: [...(snap.blockedTaskIds || [])].sort(),
    newlyAuthorizedTaskIds: [...(snap.newlyAuthorizedTaskIds || [])].sort(),
    executionPathUsable: snap.executionPathUsable || {},
  };
  return JSON.stringify(obj);
}

function isValidId(s: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(s) && !s.includes('..') && !path.isAbsolute(s);
}

export class IdleRecoveryEngine {
  missionId: string; task: string; clock: Clock; storageDir?: string;
  scheduler?: Scheduler; ownerId: string | null; authorizedNonIdempotentOps: string[];
  autonomousWakeSupported: boolean;

  passCount = 0; nextCheckAt: string | null = null; executionCounter = 0;
  completedTaskIds = new Set<string>(); lastQueueSignature: string | null = null;
  resetReason: string | null = null; idleCycle = 0; idleCycleCompleted = 0;
  schedulerActive = false; claimedBy: string | null = null; lastSnap: IdleQueueSnapshot | null = null;
  hasExecuted = false;

  constructor(opts: EngineOptions) {
    this.missionId = opts.missionId; this.task = opts.task;
    this.clock = opts.clock || { now: () => new Date() };
    this.storageDir = opts.storageDir; this.scheduler = opts.scheduler;
    this.ownerId = opts.ownerId ?? null;
    this.authorizedNonIdempotentOps = opts.authorizedNonIdempotentOps || [];
    this.autonomousWakeSupported = !!(opts.scheduler && opts.scheduler.supported);
    if (this.storageDir) this.loadSync();
  }

  private statePath(): string | null {
    if (!this.storageDir) return null;
    if (!isValidId(this.missionId) || !isValidId(this.task)) return null;
    return path.join(this.storageDir, `${this.missionId}__${this.task}.json`);
  }
  private loadSync(): void {
    const p = this.statePath(); if (!p) return;
    try {
      const raw = fsSync.readFileSync(p, 'utf-8');
      const st = JSON.parse(raw) as PersistedState;
      this.nextCheckAt = st.nextCheckAt ?? null;
      this.executionCounter = st.executionCounter ?? 0;
      this.completedTaskIds = new Set(st.completedTaskIds || []);
      this.lastQueueSignature = st.lastQueueSignature ?? null;
      this.resetReason = st.resetReason ?? null;
      this.idleCycle = st.idleCycle ?? 0;
      this.passCount = st.passCount ?? 0;
      this.idleCycleCompleted = st.idleCycleCompleted ?? 0;
      this.schedulerActive = st.schedulerActive ?? false;
      this.claimedBy = st.claimedBy ?? null;
    } catch { /* no state */ }
  }
  async save(): Promise<void> {
    const p = this.statePath(); if (!p || !this.storageDir) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    const st: PersistedState = {
      missionId: this.missionId, task: this.task, nextCheckAt: this.nextCheckAt,
      executionCounter: this.executionCounter, completedTaskIds: [...this.completedTaskIds],
      lastQueueSignature: this.lastQueueSignature, resetReason: this.resetReason,
      idleCycle: this.idleCycle, passCount: this.passCount, idleCycleCompleted: this.idleCycleCompleted,
      schedulerActive: this.schedulerActive, claimedBy: this.claimedBy,
    };
    const tmp = p + `.tmp.${crypto.randomBytes(8).toString('hex')}`;
    await fs.writeFile(tmp, JSON.stringify(st, null, 2), 'utf-8');
    await fs.rename(tmp, p);
  }
  due(now: Date): boolean {
    if (!this.nextCheckAt) return false;
    return now.getTime() >= new Date(this.nextCheckAt).getTime();
  }
  claimMission(owner: string): boolean {
    if (this.claimedBy && this.claimedBy !== owner) return false;
    this.claimedBy = owner; this.schedulerActive = true;
    if (this.ownerId === null) this.ownerId = owner;
    return true;
  }
  releaseMission(owner: string): boolean {
    if (this.claimedBy !== owner) return false;
    this.claimedBy = null; this.schedulerActive = false;
    return true;
  }
  getState(): any {
    return {
      completedTaskIds: [...this.completedTaskIds],
      lastQueueSignature: this.lastQueueSignature,
      resetReason: this.resetReason,
      idleCycleCompleted: this.idleCycleCompleted,
      schedulerActive: this.schedulerActive,
      passCount: this.passCount,
      nextCheckAt: this.nextCheckAt,
      executionCounter: this.executionCounter,
      idleCycle: this.idleCycle,
    };
  }

  async decide(probe: IdleQueueProbe): Promise<IdleDecision> {
    if (this.claimedBy && (!this.ownerId || this.claimedBy !== this.ownerId)) {
      return {
        action: 'SAFE_STOP',
        reason: `mission claimed by ${this.claimedBy}; ${this.ownerId ?? '(unbound)'} not authorized`,
        passCount: this.passCount,
        nextCheckAt: null,
      };
    }

    // While an idle cycle is scheduled and not yet due, do not advance the
    // schedule or mutate any counters. External resumption (due()) drives the
    // next wake; early calls return the current cycle unchanged so the
    // 30/60/90/120/180 progression is never compressed by premature ticks.
    if (this.nextCheckAt !== null && !this.due(this.clock.now())) {
      const nowMs = this.clock.now().getTime();
      const nextMs = new Date(this.nextCheckAt).getTime();
      return {
        action: 'IDLE',
        reason: 'not due yet',
        passCount: this.passCount,
        idleCycle: this.idleCycle,
        nextCheckAt: this.nextCheckAt,
        nextCheckInMs: Math.max(0, nextMs - nowMs),
      };
    }
    const initialPassCount = this.passCount;
    const snap = await probe.snapshot();
    for (const id of snap.completedTaskIds || []) this.completedTaskIds.add(id);

    const readyIds = (snap.readyTaskIds || []).filter((id: string) => !this.completedTaskIds.has(id));
    let eligibleTask: any = null;
    for (const id of readyIds) {
      const t = (snap.tasks || []).find((x: any) => x.id === id);
      if (t && t.status === 'READY' && (t.depsSatisfied === undefined || t.depsSatisfied)) { eligibleTask = t; break; }
    }
    if (!eligibleTask) {
      for (const t of snap.tasks || []) {
        if (t.status === 'READY' && (t.depsSatisfied === undefined || t.depsSatisfied) && !this.completedTaskIds.has(t.id)) { eligibleTask = t; break; }
      }
    }

    if (eligibleTask && eligibleTask.op === 'financial_transfer') {
      if (!this.authorizedNonIdempotentOps.includes(eligibleTask.op)) {
        return { action: 'SAFE_STOP', reason: `non-idempotent op ${eligibleTask.op} requires authorized`, passCount: this.passCount, nextCheckAt: null };
      }
    }

    const sig = stableSignature(snap);
    const hasStaleReady = (snap.readyTaskIds || []).some((id: string) => this.completedTaskIds.has(id)) && readyIds.length === 0;

    let reset = false; let resetReason: string | null = null;
    if ((snap.newlyAuthorizedTaskIds || []).length > 0) { reset = true; resetReason = (snap.newlyAuthorizedTaskIds || [])[0]; }
    if (!reset && this.lastSnap) {
      const prevUsable = this.lastSnap.executionPathUsable || {};
      const currUsable = snap.executionPathUsable || {};
      for (const k of Object.keys(currUsable)) {
        if (currUsable[k] && !prevUsable[k]) { reset = true; resetReason = k; break; }
      }
    }
    if (!reset && this.lastSnap) {
      const prevPending = this.lastSnap.pendingReviewIds || [];
      const currPending = snap.pendingReviewIds || [];
      const completed = prevPending.filter((x: string) => !currPending.includes(x));
      if (completed.length > 0) { reset = true; resetReason = completed[0]; }
    }
    if (!reset && this.lastSnap) {
      const prevBlocked = this.lastSnap.blockedTaskIds || [];
      const currBlocked = snap.blockedTaskIds || [];
      const resolved = prevBlocked.filter((x: string) => !currBlocked.includes(x));
      if (resolved.length > 0) { reset = true; resetReason = resolved[0]; }
    }
    if (eligibleTask && this.nextCheckAt !== null) { reset = true; resetReason = eligibleTask.id; }

    const didReset = reset;
    if (reset) {
      this.passCount = 1;
      this.resetReason = resetReason;
      this.nextCheckAt = null;
      this.idleCycle = 0;
      this.idleCycleCompleted = 0;
      this.lastQueueSignature = sig;
      this.hasExecuted = true;
    } else {
      if (!hasStaleReady && this.passCount < 3) this.passCount += 1;
      this.lastQueueSignature = sig;
    }
    if (reset && !hasStaleReady && this.passCount < 3) this.passCount += 1;
    this.lastSnap = snap;

    if (eligibleTask) {
      this.passCount = 1;
      this.executionCounter += 1;
      this.hasExecuted = true;
      this.completedTaskIds.add(eligibleTask.id);
      this.nextCheckAt = null;
      this.idleCycle = 0;
      this.idleCycleCompleted = 0;
      this.lastQueueSignature = sig;
      return { action: 'EXECUTE', reason: `eligible task ${eligibleTask.id}`, passCount: this.passCount, taskId: eligibleTask.id, nextCheckAt: null };
    }

    const threshold = this.hasExecuted ? 3 : 2;
    const wasAlreadyExhausted = initialPassCount >= threshold;
    if (wasAlreadyExhausted) {
      if (this.idleCycle >= 5) {
        this.nextCheckAt = null;
        this.idleCycle = 0;
        this.idleCycleCompleted = 5;
        return { action: 'SAFE_STOP', reason: 'idle exhausted after 8h', passCount: this.passCount, nextCheckAt: null };
      }
      this.idleCycle += 1;
      const interval = IDLE_INTERVALS_MINUTES[this.idleCycle - 1];
      const next = this.clock.now().getTime() + interval * 60 * 1000;
      this.nextCheckAt = new Date(next).toISOString();
      this.idleCycleCompleted = this.idleCycle - 1;
      return { action: 'IDLE', reason: `idle cycle ${this.idleCycle}`, passCount: 3, idleCycle: this.idleCycle, nextCheckAt: this.nextCheckAt, nextCheckInMs: interval * 60 * 1000 };
    }

    return { action: 'RECHECK', reason: `${this.passCount}/3`, passCount: this.passCount, nextCheckAt: null };
  }
}