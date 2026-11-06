// Task state machine (MP-35 §7)

export type TaskState =
  | 'READY'
  | 'RUNNING'
  | 'AWAITING_REVIEW'
  | 'BLOCKED_EXTERNAL'
  | 'BLOCKED_HUMAN'
  | 'BLOCKED_TECHNICAL'
  | 'FAILED_RETRYABLE'
  | 'FAILED_NONRETRYABLE'
  | 'VERIFIED_DONE';

const ALLOWED: Record<TaskState, TaskState[]> = {
  READY: ['RUNNING'],
  RUNNING: ['AWAITING_REVIEW', 'BLOCKED_EXTERNAL', 'BLOCKED_HUMAN', 'BLOCKED_TECHNICAL', 'FAILED_RETRYABLE', 'FAILED_NONRETRYABLE', 'VERIFIED_DONE'],
  AWAITING_REVIEW: ['RUNNING', 'VERIFIED_DONE', 'FAILED_RETRYABLE', 'FAILED_NONRETRYABLE', 'BLOCKED_TECHNICAL'],
  BLOCKED_EXTERNAL: ['READY', 'FAILED_NONRETRYABLE'],
  BLOCKED_HUMAN: ['READY', 'FAILED_NONRETRYABLE'],
  BLOCKED_TECHNICAL: ['READY', 'FAILED_RETRYABLE', 'FAILED_NONRETRYABLE'],
  FAILED_RETRYABLE: ['READY', 'FAILED_NONRETRYABLE'],
  FAILED_NONRETRYABLE: [],
  VERIFIED_DONE: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function transitionTask(current: TaskState, next: TaskState): TaskState {
  if (!canTransition(current, next)) {
    throw new Error(`Invalid transition ${current} -> ${next}`);
  }
  return next;
}

export interface TaskEntry { id: string; state: TaskState; }

export function hasReadyIndependentTasks(tasks: TaskEntry[]): boolean {
  return tasks.some(t => t.state === 'READY');
}

/**
 * Determines whether the task set has reached a global completion point
 * suitable for pausing orchestration.
 *
 * Semantics (current, product decision pending):
 * - Returns `true` only when the list is non-empty and every task is in a
 *   terminal-for-pause state: `VERIFIED_DONE`, `FAILED_NONRETRYABLE`,
 *   `BLOCKED_EXTERNAL`, or `BLOCKED_HUMAN`.
 * - `BLOCKED_EXTERNAL` and `BLOCKED_HUMAN` are treated as terminal here
 *   because no further automatic progress is possible for those tasks in
 *   this run. This is an intentional pause semantics, not a claim that the
 *   underlying business condition is fully resolved. A product decision to
 *   exclude or rename these states from this helper is OPEN (see
 *   `docs/agent_runs/mp-35-2026-11-06.md`: Stage B/C Corrections / CR-004
 *   disposition; CR-004) and has NOT been applied in Stage B/C.
 * - `RUNNING`, `AWAITING_REVIEW`, `BLOCKED_TECHNICAL`, `FAILED_RETRYABLE`,
 *   and `READY` are all treated as non-terminal, so `isGlobalCompletion`
 *   returns `false` while any such task remains.
 */
export function isGlobalCompletion(tasks: TaskEntry[]): boolean {
  return tasks.length > 0 && tasks.every(t => t.state === 'VERIFIED_DONE' || t.state === 'FAILED_NONRETRYABLE' || t.state === 'BLOCKED_EXTERNAL' || t.state === 'BLOCKED_HUMAN');
}

export function shouldPause(tasks: TaskEntry[]): boolean {
  if (hasReadyIndependentTasks(tasks)) return false;
  const hasAwaiting = tasks.some(t => t.state === 'AWAITING_REVIEW');
  const hasRunning = tasks.some(t => t.state === 'RUNNING');
  if (hasAwaiting && !hasRunning && !hasReadyIndependentTasks(tasks)) {
    return true;
  }
  return false;
}

export function terminationInvariant(tasks: TaskEntry[]): { ok: boolean; reason?: string } {
  if (hasReadyIndependentTasks(tasks)) {
    return { ok: false, reason: 'READY independent tasks remain' };
  }
  return { ok: true };
}
