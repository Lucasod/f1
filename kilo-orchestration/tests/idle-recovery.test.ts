// Idle recovery — MP-35R Addendum C (IDLE-01..15)
// Pure unit tests: fake clocks, temp dir storage, in-memory probe.
// No real waits, no provider calls, no Mongo, no credentials.

import { describe, it, expect } from 'vitest';
import {
  IdleRecoveryEngine,
  IDLE_INTERVALS_MINUTES,
  type IdleQueueSnapshot,
  type IdleQueueProbe,
  type Clock,
} from '../src/idle-recovery.js';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const MISSION = 'mp-35-2026-11-06';
const TASK = 'mp35r-addendum-c-idle-recovery';

class FakeClock implements Clock {
  private ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
  get(): number {
    return this.ms;
  }
}

function emptySnap(): IdleQueueSnapshot {
  return {
    tasks: [],
    readyTaskIds: [],
    completedTaskIds: [],
    pendingReviewIds: [],
    blockedTaskIds: [],
    newlyAuthorizedTaskIds: [],
    executionPathUsable: {},
  };
}

class Probe implements IdleQueueProbe {
  private snap: IdleQueueSnapshot;
  constructor(snap: IdleQueueSnapshot) {
    this.snap = snap;
  }
  update(patch: Partial<IdleQueueSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
  }
  async snapshot(): Promise<IdleQueueSnapshot> {
    return this.snap;
  }
}

async function tempDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'idle-'));
}

const T0 = Date.UTC(2026, 10, 6, 10, 0, 0); // 2026-11-06T10:00:00Z

describe('Idle recovery (MP-35R Addendum C) IDLE-01..15', () => {
  // IDLE-01: three complete queue evaluations before idle; first idle interval 30m
  it('IDLE-01: performs three immediate queue passes, then idles at +30m', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe(emptySnap());
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('RECHECK');
    expect(d1.reason).toContain('1/3');
    expect(eng.passCount).toBe(1);
    expect(eng.nextCheckAt).toBeNull();

    const d2 = await eng.decide(probe);
    expect(d2.action).toBe('RECHECK');
    expect(eng.passCount).toBe(2);

    const d3 = await eng.decide(probe);
    expect(d3.action).toBe('IDLE');
    expect(d3.idleCycle).toBe(1);
    expect(d3.nextCheckAt).toBe(new Date(T0 + 30 * 60 * 1000).toISOString());
    expect(d3.nextCheckInMs).toBe(30 * 60 * 1000);
    expect(eng.passCount).toBe(3);
    expect(IDLE_INTERVALS_MINUTES).toEqual([30, 60, 90, 120, 180]);
    // No built-in autonomous wake: external resumption is required via due()/tick().
    expect(eng.autonomousWakeSupported).toBe(false);
    expect(eng.schedulerActive).toBe(false);
  });

  // IDLE-02: progressive intervals 30/60/90/120/180 (total 8h) then SAFE_STOP
  it('IDLE-02: progresses through all five idle cycles totaling 8h, then safe-stops', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe(emptySnap());
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    await eng.decide(probe);
    await eng.decide(probe);
    let d = await eng.decide(probe);
    expect(d.action).toBe('IDLE');
    expect(d.idleCycle).toBe(1);
    expect(eng.due(clock.now())).toBe(false); // not due before nextCheckAt

    // Wake after each interval; each wake reloads state and rechecks the queue.
    for (const cycle of [2, 3, 4, 5]) {
      clock.advance(IDLE_INTERVALS_MINUTES[cycle - 2] * 60 * 1000 + 1000);
      expect(eng.due(clock.now())).toBe(true);
      d = await eng.decide(probe);
      expect(d.action).toBe('IDLE', `cycle ${cycle} should re-idle`);
      expect(d.idleCycle).toBe(cycle);
      expect(new Date(d.nextCheckAt!).getTime()).toBeGreaterThan(clock.get());
    }

    // After cycle 5 (180m) finds nothing: total 480m = 8h elapsed -> SAFE_STOP.
    clock.advance(IDLE_INTERVALS_MINUTES[4] * 60 * 1000 + 1000);
    expect(eng.due(clock.now())).toBe(true);
    expect(clock.get()).toBeGreaterThan(T0 + 8 * 60 * 60 * 1000);
    const dStop = await eng.decide(probe);
    expect(dStop.action).toBe('SAFE_STOP');
    expect(dStop.reason).toContain('8h');
    expect(eng.nextCheckAt).toBeNull();
  });

  // IDLE-03: eligible task during the passes exits exhaustion and executes immediately
  it('IDLE-03: eligible task triggers immediate EXECUTE and exits the idle path', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe({
      ...emptySnap(),
      tasks: [
        { id: 'T-2', status: 'AWAITING_REVIEW' }, // pending review must NOT block independent READY
        { id: 'T-1', status: 'READY', depsSatisfied: true },
      ],
      readyTaskIds: ['T-1'],
    });
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('EXECUTE');
    expect(d1.taskId).toBe('T-1');
    expect(eng.executionCounter).toBe(1);
    expect(eng.passCount).toBe(1);
    expect(eng.nextCheckAt).toBeNull();
    expect(eng.getState().completedTaskIds).toContain('T-1');

    // Same ready task reported again (stale cache): no replay.
    const d2 = await eng.decide(probe);
    expect(d2.action).not.toBe('EXECUTE');
    expect(eng.executionCounter).toBe(1);

    // After real execution the 3-pass + idle sequence restarts from pass 1.
    probe.update({ tasks: [], readyTaskIds: [], completedTaskIds: ['T-1'] });
    const r1 = await eng.decide(probe);
    expect(r1.action).toBe('RECHECK');
    expect(r1.passCount).toBe(2);
    const r2 = await eng.decide(probe);
    expect(r2.action).toBe('RECHECK');
    expect(r2.passCount).toBe(3);
    const r3 = await eng.decide(probe);
    expect(r3.action).toBe('IDLE');
    expect(r3.idleCycle).toBe(1);
  });

  // IDLE-04: reset on eligible task during idle; normal execution resumes
  it('IDLE-04: eligible task during idle resets passes and executes immediately', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe(emptySnap());
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    await eng.decide(probe);
    await eng.decide(probe);
    const d3 = await eng.decide(probe);
    expect(d3.action).toBe('IDLE');
    expect(d3.idleCycle).toBe(1);

    probe.update({
      tasks: [{ id: 'T-2', status: 'READY', depsSatisfied: true }],
      readyTaskIds: ['T-2'],
    });
    clock.advance(31 * 60 * 1000); // past nextCheckAt -> idle wake fires
    expect(eng.due(clock.now())).toBe(true);

    const d4 = await eng.decide(probe);
    expect(d4.action).toBe('EXECUTE');
    expect(d4.taskId).toBe('T-2');
    expect(eng.passCount).toBe(1); // reset: normal execution resumed
    expect(eng.nextCheckAt).toBeNull();
    expect(eng.executionCounter).toBe(1);
  });

  // IDLE-05: reset when a pending review completes (unblocks work)
  it('IDLE-05: reset on pending review completed', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe({ ...emptySnap(), pendingReviewIds: ['R-1'] });
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('RECHECK');
    expect(eng.passCount).toBe(1);
    expect(eng.nextCheckAt).toBeNull();

    probe.update({ pendingReviewIds: [] }); // R-1 completed -> unblocks work
    const d2 = await eng.decide(probe);
    expect(d2.action).toBe('RECHECK'); // fresh sequence: pass 2
    expect(eng.passCount).toBe(2);
    expect(eng.nextCheckAt).toBeNull();
    expect(eng.getState().resetReason).toContain('R-1');
  });

  // IDLE-06: reset when a genuine blocker is resolved
  it('IDLE-06: reset on genuine blocker resolved', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe({ ...emptySnap(), blockedTaskIds: ['T-2'] });
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('RECHECK');
    expect(eng.passCount).toBe(1);

    probe.update({ blockedTaskIds: [] }); // blocker resolved
    const d2 = await eng.decide(probe);
    expect(d2.action).toBe('RECHECK');
    expect(eng.passCount).toBe(2);
    expect(eng.nextCheckAt).toBeNull();
    expect(eng.getState().resetReason).toContain('T-2');
  });

  // IDLE-07: reset on new authorized task
  it('IDLE-07: reset on new authorized task', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe(emptySnap());
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('RECHECK');
    expect(eng.passCount).toBe(1);

    probe.update({ newlyAuthorizedTaskIds: ['T-9'] });
    const d2 = await eng.decide(probe);
    expect(d2.action).toBe('RECHECK');
    expect(eng.passCount).toBe(2);
    expect(eng.nextCheckAt).toBeNull();
    expect(eng.getState().resetReason).toContain('T-9');
  });

  // IDLE-08: reset when an unavailable execution path becomes usable
  it('IDLE-08: reset when execution path becomes usable; unchanged path does not re-reset', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe({ ...emptySnap(), executionPathUsable: {} });
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('RECHECK');
    expect(eng.passCount).toBe(1);

    probe.update({ executionPathUsable: { 's3-ingest': true } });
    const d2 = await eng.decide(probe);
    expect(d2.action).toBe('RECHECK');
    expect(eng.passCount).toBe(2);
    expect(eng.getState().resetReason).toContain('s3-ingest');

    // Same usable path reported again: cosmetic, no reset -> pass 3.
    const d3 = await eng.decide(probe);
    expect(d3.action).toBe('RECHECK');
    expect(eng.passCount).toBe(3);
  });

  // IDLE-09: no reset on unchanged/cosmetic-only updates (signature stable)
  it('IDLE-09: no reset on unchanged/cosmetic queue updates', async () => {
    const clock = new FakeClock(T0);
    const base = {
      tasks: [{ id: 'T-1', status: 'IN_PROGRESS', op: 'read_only_inspect' }],
      readyTaskIds: [],
      completedTaskIds: [],
      pendingReviewIds: [],
      blockedTaskIds: [],
      newlyAuthorizedTaskIds: [],
      executionPathUsable: {},
    };
    const probe = new Probe(base);
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('RECHECK');
    expect(eng.passCount).toBe(1);
    const sig1 = eng.getState().lastQueueSignature;

    // Cosmetic-only: reordered array + volatile timestamp, identical logical content.
    probe.update({
      ...base,
      tasks: [...base.tasks].reverse(),
      reviewedAt: new Date(T0 + 60 * 1000).toISOString(),
    });
    const d2 = await eng.decide(probe);
    expect(d2.action).toBe('RECHECK');
    expect(eng.passCount).toBe(2); // no reset
    expect(eng.getState().lastQueueSignature).toBe(sig1);

    const d3 = await eng.decide(probe);
    expect(d3.action).toBe('IDLE');
    expect(eng.passCount).toBe(3);
    expect(d3.nextCheckAt).toBe(new Date(T0 + 30 * 60 * 1000).toISOString());
  });

  // IDLE-10: no replay of completed tasks
  it('IDLE-10: completed tasks are never re-executed', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe({
      ...emptySnap(),
      tasks: [{ id: 'T-1', status: 'READY', depsSatisfied: true }],
      readyTaskIds: ['T-1'],
      completedTaskIds: [],
    });
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d1 = await eng.decide(probe);
    expect(d1.action).toBe('EXECUTE');
    expect(eng.executionCounter).toBe(1);

    // Probe still lists T-1 as READY (stale snapshot): state-side completed wins.
    const d2 = await eng.decide(probe);
    expect(d2.action).toBe('RECHECK');
    expect(eng.executionCounter).toBe(1);
    expect(eng.getState().completedTaskIds).toContain('T-1');
  });

  // IDLE-11: absolute nextCheckAt persisted and survives engine reload
  it('IDLE-11: absolute nextCheckAt is durable across reloads', async () => {
    const dir = await tempDir();
    const clock = new FakeClock(T0);
    const probe = new Probe(emptySnap());

    const eng1 = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, storageDir: dir, clock });
    await eng1.decide(probe);
    await eng1.decide(probe);
    const d3 = await eng1.decide(probe);
    expect(d3.action).toBe('IDLE');
    const nextCheckAt = d3.nextCheckAt!;
    expect(new Date(nextCheckAt).getTime()).toBe(T0 + 30 * 60 * 1000);
    await eng1.save();

    // Simulated process restart: a new engine loads the durable state.
    const eng2 = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, storageDir: dir, clock });
    expect(eng2.nextCheckAt).toBe(nextCheckAt);
    expect(eng2.due(clock.now())).toBe(false);
    expect(eng2.due(new Date(T0 + 31 * 60 * 1000))).toBe(true);
    expect(eng2.executionCounter).toBe(0);
  });

  // IDLE-12: executionCounter monotonic across executions and reloads
  it('IDLE-12: executionCounter is monotonic and persisted across reloads', async () => {
    const dir = await tempDir();
    const clock = new FakeClock(T0);
    const ready = (ids: string[]) =>
      new Probe({
        ...emptySnap(),
        tasks: ids.map((id) => ({ id, status: 'READY', depsSatisfied: true })),
        readyTaskIds: [...ids],
        completedTaskIds: [],
      });

    const eng1 = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, storageDir: dir, clock });
    const d1 = await eng1.decide(ready(['T-1']));
    expect(d1.action).toBe('EXECUTE');
    expect(eng1.executionCounter).toBe(1);
    const d2 = await eng1.decide(ready(['T-2'])); // T-1 completed -> not replayed; T-2 executes
    expect(d2.action).toBe('EXECUTE');
    expect(d2.taskId).toBe('T-2');
    expect(eng1.executionCounter).toBe(2);
    await eng1.save();

    const eng2 = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, storageDir: dir, clock });
    expect(eng2.executionCounter).toBe(2); // monotonic, not rewound by reload
    const d3 = await eng2.decide(ready(['T-3']));
    expect(d3.action).toBe('EXECUTE');
    expect(eng2.executionCounter).toBe(3);
  });

  // IDLE-13: SAFE_STOP for non-idempotent op without explicit authorization
  it('IDLE-13: non-idempotent op without authorization SAFE_STOPs; no EXECUTE, no override', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe({
      ...emptySnap(),
      tasks: [{ id: 'T-pay', status: 'READY', depsSatisfied: true, op: 'financial_transfer' }],
      readyTaskIds: ['T-pay'],
    });
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    const d = await eng.decide(probe);
    expect(d.action).toBe('SAFE_STOP');
    expect(d.reason).toContain('financial_transfer');
    expect(d.reason).toContain('authorized');
    expect(eng.executionCounter).toBe(0);
    expect(eng.nextCheckAt).toBeNull();

    // Explicit opt-in authorization unblocks; never a silent override.
    const eng2 = new IdleRecoveryEngine({
      missionId: MISSION,
      task: TASK,
      clock,
      authorizedNonIdempotentOps: ['financial_transfer'],
    });
    const d2 = await eng2.decide(probe);
    expect(d2.action).toBe('EXECUTE');
    expect(d2.taskId).toBe('T-pay');
    expect(eng2.executionCounter).toBe(1);
  });

  // IDLE-14: exclusive mission ownership (scheduler + runner race guard)
  it('IDLE-14: mission lease blocks a competing scheduler; release re-arms it', async () => {
    const dir = await tempDir();
    const clock = new FakeClock(T0);

    const engA = new IdleRecoveryEngine({
      missionId: MISSION,
      task: TASK,
      storageDir: dir,
      clock,
      ownerId: 'sched-A',
    });
    expect(engA.claimMission('sched-A')).toBe(true);
    expect(engA.getState().schedulerActive).toBe(true);
    await engA.save();

    // Competing scheduler B loads the same durable state and is fenced off.
    const engB = new IdleRecoveryEngine({
      missionId: MISSION,
      task: TASK,
      storageDir: dir,
      clock,
      ownerId: 'sched-B',
    });
    const dB = await engB.decide(new Probe(emptySnap()));
    expect(dB.action).toBe('SAFE_STOP');
    expect(dB.reason).toContain('sched-A');
    expect(dB.reason).toContain('sched-B');

    // Owner A proceeds normally.
    const dA = await engA.decide(new Probe(emptySnap()));
    expect(dA.action).toBe('RECHECK');

    // Release by owner re-arms the mission for another owner.
    expect(engA.releaseMission('sched-A')).toBe(true);
    await engA.save();
    const engC = new IdleRecoveryEngine({
      missionId: MISSION,
      task: TASK,
      storageDir: dir,
      clock,
      ownerId: 'sched-B',
    });
    const dC = await engC.decide(new Probe(emptySnap()));
    expect(dC.action).toBe('RECHECK');
    expect(engC.claimMission('sched-B')).toBe(true);

    // A different owner cannot steal a held mission.
    expect(engC.claimMission('sched-Z')).toBe(false);
  });

  // IDLE-15: after real execution + full idle exhaustion, sequence restarts;
  //          autonomous wake unsupported by default -> external resumption required
  it('IDLE-15: execution + exhaustion restarts 3-pass + idle; no OS cron by default', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe(emptySnap());
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    // Full exhaustion: 3 passes + 5 idle cycles (~8h) -> SAFE_STOP.
    await eng.decide(probe);
    await eng.decide(probe);
    let d = await eng.decide(probe);
    expect(d.action).toBe('IDLE');
    expect(d.idleCycle).toBe(1);
    for (const cycle of [2, 3, 4, 5]) {
      clock.advance(IDLE_INTERVALS_MINUTES[cycle - 2] * 60 * 1000 + 1000);
      expect(eng.due(clock.now())).toBe(true);
      d = await eng.decide(probe);
      expect(d.action).toBe('IDLE');
      expect(d.idleCycle).toBe(cycle);
    }
    clock.advance(IDLE_INTERVALS_MINUTES[4] * 60 * 1000 + 1000);
    expect((await eng.decide(probe)).action).toBe('SAFE_STOP');

    // New eligible work after exhaustion -> immediate execute, full restart.
    probe.update({
      tasks: [{ id: 'T-1', status: 'READY', depsSatisfied: true }],
      readyTaskIds: ['T-1'],
    });
    const dExec = await eng.decide(probe);
    expect(dExec.action).toBe('EXECUTE');
    expect(dExec.taskId).toBe('T-1');
    expect(eng.passCount).toBe(1);
    expect(eng.nextCheckAt).toBeNull();
    expect(eng.getState().idleCycleCompleted).toBe(0);

    // Fresh 3 passes then idle cycle 1 again (restarted, not continued).
    probe.update(emptySnap());
    expect((await eng.decide(probe)).passCount).toBe(2);
    expect((await eng.decide(probe)).passCount).toBe(3);
    const dIdle = await eng.decide(probe);
    expect(dIdle.action).toBe('IDLE');
    expect(dIdle.idleCycle).toBe(1);
    expect(new Date(dIdle.nextCheckAt!).getTime()).toBe(clock.get() + 30 * 60 * 1000);

    // No built-in OS cron: durable state + external due()/tick() drive resumption.
    expect(eng.autonomousWakeSupported).toBe(false);
    expect(eng.schedulerActive).toBe(false);
    expect(eng.nextCheckAt).not.toBeNull();

    // A real scheduler (if ever provided) opts in to autonomous wake support.
    const sched = { supported: true, requestWakeAt: async () => true };
    const engS = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock, scheduler: sched });
    expect(engS.autonomousWakeSupported).toBe(true);
  });

  // CR-001: decide() must respect nextCheckAt; an early call before due()
  // must not advance idleCycle/nextCheckAt or mutate any counters/schedule.
  it('CR-001: decide() before nextCheckAt does not advance the idle cycle', async () => {
    const clock = new FakeClock(T0);
    const probe = new Probe(emptySnap());
    const eng = new IdleRecoveryEngine({ missionId: MISSION, task: TASK, clock });

    // Reach idle cycle 1: nextCheckAt = T0 + 30m, passCount = 3
    await eng.decide(probe);
    await eng.decide(probe);
    const d3 = await eng.decide(probe);
    expect(d3.action).toBe('IDLE');
    expect(d3.idleCycle).toBe(1);
    expect(eng.nextCheckAt).toBe(new Date(T0 + 30 * 60 * 1000).toISOString());
    expect(eng.passCount).toBe(3);

    // Early call: 10 minutes later, still not due.
    clock.advance(10 * 60 * 1000);
    expect(eng.due(clock.now())).toBe(false);

    const dEarly = await eng.decide(probe);
    expect(dEarly.action).toBe('IDLE');
    expect(dEarly.reason).toContain('not due');
    expect(dEarly.idleCycle).toBe(1); // not advanced
    expect(dEarly.nextCheckAt).toBe(eng.nextCheckAt); // schedule unchanged
    expect(dEarly.nextCheckInMs).toBe(20 * 60 * 1000); // remaining time
    // No mutation of counters or schedule.
    expect(eng.passCount).toBe(3);
    expect(eng.idleCycle).toBe(1);
    expect(eng.nextCheckAt).toBe(new Date(T0 + 30 * 60 * 1000).toISOString());

    // Repeated early calls are idempotent: no schedule compression.
    const dEarly2 = await eng.decide(probe);
    expect(dEarly2.idleCycle).toBe(1);
    expect(eng.nextCheckAt).toBe(new Date(T0 + 30 * 60 * 1000).toISOString());

    // When due, progression resumes normally from the same cycle.
    clock.advance(20 * 60 * 1000 + 1000); // now T0 + 30m + 1s -> due
    expect(eng.due(clock.now())).toBe(true);
    const dDue = await eng.decide(probe);
    expect(dDue.action).toBe('IDLE');
    expect(dDue.idleCycle).toBe(2);
    expect(new Date(dDue.nextCheckAt!).getTime()).toBe(clock.get() + 60 * 60 * 1000);
  });

  // CR-002: durable lease fence after reload.
  it('CR-002: reload with persisted claimedBy but no ownerId is fenced; correct owner proceeds', async () => {
    const dir = await tempDir();
    const clock = new FakeClock(T0);

    // Owner sched-A claims and persists the lease.
    const engA = new IdleRecoveryEngine({
      missionId: MISSION, task: TASK, storageDir: dir, clock, ownerId: 'sched-A',
    });
    expect(engA.claimMission('sched-A')).toBe(true);
    await engA.save();

    // Reload WITHOUT ownerId: claimedBy is durable, ownerId is not restored.
    const engNoOwner = new IdleRecoveryEngine({
      missionId: MISSION, task: TASK, storageDir: dir, clock,
    });
    expect(engNoOwner.ownerId).toBeNull();
    expect(engNoOwner.claimedBy).toBe('sched-A');

    const dNoOwner = await engNoOwner.decide(new Probe(emptySnap()));
    expect(dNoOwner.action).toBe('SAFE_STOP');
    expect(dNoOwner.reason).toContain('sched-A');

    // Competing scheduler with a different ownerId is fenced.
    const engB = new IdleRecoveryEngine({
      missionId: MISSION, task: TASK, storageDir: dir, clock, ownerId: 'sched-B',
    });
    const dB = await engB.decide(new Probe(emptySnap()));
    expect(dB.action).toBe('SAFE_STOP');
    expect(dB.reason).toContain('sched-A');
    expect(dB.reason).toContain('sched-B');

    // Owner reloading with the correct ownerId still proceeds.
    const engA2 = new IdleRecoveryEngine({
      missionId: MISSION, task: TASK, storageDir: dir, clock, ownerId: 'sched-A',
    });
    const dA2 = await engA2.decide(new Probe(emptySnap()));
    expect(dA2.action).toBe('RECHECK');

    // Explicit rebind by the same owner restores the local ownerId and unblocks.
    expect(engNoOwner.claimMission('sched-A')).toBe(true);
    expect(engNoOwner.ownerId).toBe('sched-A');
    const dRebind = await engNoOwner.decide(new Probe(emptySnap()));
    expect(dRebind.action).toBe('RECHECK');
  });
});
