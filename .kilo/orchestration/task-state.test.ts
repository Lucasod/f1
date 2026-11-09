import { describe, it, expect } from 'vitest';
import { transitionTask, canTransition, hasReadyIndependentTasks, isGlobalCompletion, shouldPause, terminationInvariant, TaskState } from './index';

describe('Task state machine', () => {
  it('valid transitions', () => {
    expect(canTransition('READY','RUNNING')).toBe(true);
    expect(canTransition('RUNNING','AWAITING_REVIEW')).toBe(true);
  });
  it('invalid transition throws', () => {
    expect(() => transitionTask('VERIFIED_DONE','RUNNING')).toThrow();
  });
  it('termination invariant: READY remains => not complete', () => {
    const tasks = [{ id:'a', state:'READY' as TaskState }, { id:'b', state:'VERIFIED_DONE' as TaskState }];
    expect(hasReadyIndependentTasks(tasks)).toBe(true);
    expect(terminationInvariant(tasks).ok).toBe(false);
    expect(shouldPause(tasks)).toBe(false);
  });
  it('AWAITING_REVIEW not global completion if READY present', () => {
    const tasks = [{ id:'a', state:'READY' as TaskState }, { id:'b', state:'AWAITING_REVIEW' as TaskState }];
    expect(isGlobalCompletion(tasks)).toBe(false);
  });

  // CR-004: isGlobalCompletion treats BLOCKED_* as terminal-for-pause (product decision pending)
  it('isGlobalCompletion treats BLOCKED_EXTERNAL and BLOCKED_HUMAN as terminal', () => {
    const tasks = [{ id:'a', state:'BLOCKED_EXTERNAL' as TaskState }, { id:'b', state:'BLOCKED_HUMAN' as TaskState }];
    expect(isGlobalCompletion(tasks)).toBe(true);
  });

  it('isGlobalCompletion is false when a RUNNING task remains', () => {
    const tasks = [{ id:'a', state:'VERIFIED_DONE' as TaskState }, { id:'b', state:'RUNNING' as TaskState }];
    expect(isGlobalCompletion(tasks)).toBe(false);
  });

  it('isGlobalCompletion is false for empty task list', () => {
    expect(isGlobalCompletion([])).toBe(false);
  });
});
