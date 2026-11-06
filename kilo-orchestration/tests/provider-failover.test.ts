import { describe, it, expect } from 'vitest';
import {
  SIX_STAGE_CHAIN,
  classifyFailure,
  FailoverController,
  ProviderDestinationStatus,
} from '../src/index';

describe('Provider failover', () => {
  it('six-stage chain exact order', () => {
    const ids = SIX_STAGE_CHAIN.map(d => d.id);
    expect(ids).toEqual(['gpt','beam','openrouter-nemotron-lightning','cline-nemotron-lightning','openrouter-free','kilo-auto-free']);
  });

  it('app/test failures do not trigger rotation', () => {
    const r = classifyFailure({ kind: 'repo_test_failure', message: 'test failed' });
    expect(r.rotateProvider).toBe(false);
    const r2 = classifyFailure({ kind: 'tool_failure' });
    expect(r2.rotateProvider).toBe(false);
  });

  it('429/timeout/quota classified rotatable', () => {
    expect(classifyFailure({ httpStatus: 429 }).rotateProvider).toBe(true);
    expect(classifyFailure({ message: 'request timeout' }).rotateProvider).toBe(true);
    expect(classifyFailure({ message: 'quota exhausted' }).rotateProvider).toBe(true);
  });

  it('401/403 no uncontrolled retry loop', () => {
    const r = classifyFailure({ httpStatus: 401 });
    expect(r.rotateProvider).toBe(false);
    expect(r.retryable).toBe(false);
  });

  it('controller skips unconfigured and attempts configured in order', async () => {
    const ctrl = new FailoverController();
    const calls: string[] = [];
    const res = await ctrl.run(async (dest) => {
      calls.push(dest.id);
      if (dest.id === 'openrouter-free') return { ok: true };
      return { ok: false, failure: { httpStatus: 429, message: 'rate limit' } };
    });
    // gpt, beam, openrouter-nemotron-lightning skipped (not configured)
    expect(calls).toEqual(['cline-nemotron-lightning', 'openrouter-free']);
    expect(res.succeededDestination).toBe('openrouter-free');
    expect(res.exhausted).toBe(false);
  });

  it('router exhaustion stops chain', async () => {
    const ctrl = new FailoverController();
    const res = await ctrl.run(async () => ({ ok: false, failure: { httpStatus: 429, message: 'rate limit' } }));
    expect(res.exhausted).toBe(true);
    expect(res.finalState).toBe('exhausted');
  });
});
