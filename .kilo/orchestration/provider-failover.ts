// Provider failover model + error classification + pure/simulated controller (MP-35)
// NO live routing, no provider calls.

export type ProviderDestinationStatus =
  | 'SUPPORTED_STATIC'
  | 'NOT_CONFIGURED'
  | 'NOT_VERIFIED'
  | 'NOT_SUPPORTED';

export interface ProviderDestination {
  id: string;
  label: string;
  order: number;
  configured: boolean;
  status: ProviderDestinationStatus;
  reason?: string;
}

export const SIX_STAGE_CHAIN: ProviderDestination[] = [
  { id: 'gpt', label: 'Existing GPT provider', order: 1, configured: false, status: 'NOT_CONFIGURED', reason: 'No gpt provider in repo/global config' },
  { id: 'beam', label: 'Kilo Beam', order: 2, configured: false, status: 'NOT_CONFIGURED', reason: 'No beam provider locally' },
  { id: 'openrouter-nemotron-lightning', label: 'OpenRouter Nemotron Lightning', order: 3, configured: false, status: 'NOT_CONFIGURED', reason: 'Exact ID not found locally' },
  { id: 'cline-nemotron-lightning', label: 'Cline Nemotron Lightning', order: 4, configured: true, status: 'SUPPORTED_STATIC', reason: 'nvidia/nemotron-3.5-lightning:free under provider.cline.models' },
  { id: 'openrouter-free', label: 'OpenRouter Free Models Router', order: 5, configured: true, status: 'SUPPORTED_STATIC', reason: 'openrouter/free under provider.cline.models' },
  { id: 'kilo-auto-free', label: 'Kilo Auto Free', order: 6, configured: false, status: 'NOT_CONFIGURED', reason: 'Not found in any local config' },
];

export type ProviderFailureType =
  | 'rate_limit_429'
  | 'quota_exhaustion'
  | 'timeout'
  | 'connection'
  | 'server_5xx'
  | 'model_unavailable'
  | 'context_overflow'
  | 'auth_401_403'
  | 'invalid_request'
  | 'tool_failure'
  | 'repo_test_failure'
  | 'unknown';

export interface ClassifiedFailure {
  type: ProviderFailureType;
  httpStatus?: number;
  rotateProvider: boolean;
  retryable: boolean;
  reason: string;
}

const ROTATABLE = new Set<ProviderFailureType>([
  'rate_limit_429',
  'quota_exhaustion',
  'timeout',
  'connection',
  'server_5xx',
  'model_unavailable',
  'context_overflow',
]);

export function classifyFailure(input: {
  httpStatus?: number;
  message?: string;
  kind?: string;
}): ClassifiedFailure {
  const msg = (input.message || '').toLowerCase();
  const kind = (input.kind || '').toLowerCase();
  const status = input.httpStatus;

  let type: ProviderFailureType = 'unknown';

  if (kind === 'repo_test_failure' || kind === 'test_failure' || kind === 'app_failure') {
    type = 'repo_test_failure';
  } else if (kind === 'tool_failure') {
    type = 'tool_failure';
  } else if (status === 429 || msg.includes('rate limit') || msg.includes('429')) {
    type = 'rate_limit_429';
  } else if (msg.includes('quota') || msg.includes('exhaust')) {
    type = 'quota_exhaustion';
  } else if (msg.includes('timeout') || msg.includes('timed out')) {
    type = 'timeout';
  } else if (msg.includes('connection') || msg.includes('econnrefused') || msg.includes('network')) {
    type = 'connection';
  } else if (status !== undefined && status >= 500 && status < 600) {
    type = 'server_5xx';
  } else if (msg.includes('model') && (msg.includes('unavailable') || msg.includes('not found') || msg.includes('does not exist'))) {
    type = 'model_unavailable';
  } else if (msg.includes('context') && (msg.includes('overflow') || msg.includes('too long') || msg.includes('length'))) {
    type = 'context_overflow';
  } else if (status === 401 || status === 403 || msg.includes('unauthorized') || msg.includes('forbidden')) {
    type = 'auth_401_403';
  } else if (status !== undefined && status >= 400 && status < 500) {
    type = 'invalid_request';
  }

  const rotateProvider = ROTATABLE.has(type);
  const retryable = type === 'auth_401_403' ? false : rotateProvider;

  return {
    type,
    httpStatus: status,
    rotateProvider,
    retryable,
    reason: type,
  };
}

export interface ProviderAttempt {
  destinationId: string;
  attempt: number;
  startedAt: string;
  outcome: 'success' | 'failed' | 'skipped';
  failureType?: ProviderFailureType;
  reason?: string;
}

export interface FailoverControllerOptions {
  maxRetriesPerDestination?: number;
  maxTotalAttempts?: number;
  backoffBaseMs?: number;
}

export interface FailoverResult {
  attempts: ProviderAttempt[];
  finalState: 'success' | 'exhausted' | 'stopped';
  succeededDestination?: string;
  exhausted: boolean;
}

export class FailoverController {
  private destinations: ProviderDestination[];
  private opts: Required<FailoverControllerOptions>;

  constructor(destinations: ProviderDestination[] = SIX_STAGE_CHAIN, opts: FailoverControllerOptions = {}) {
    this.destinations = [...destinations].sort((a, b) => a.order - b.order);
    this.opts = {
      maxRetriesPerDestination: opts.maxRetriesPerDestination ?? 1,
      maxTotalAttempts: opts.maxTotalAttempts ?? 10,
      backoffBaseMs: opts.backoffBaseMs ?? 100,
    };
  }

  async run(executor: (dest: ProviderDestination) => Promise<{ ok: boolean; failure?: { httpStatus?: number; message?: string; kind?: string } }>): Promise<FailoverResult> {
    const attempts: ProviderAttempt[] = [];
    let total = 0;
    let succeeded: string | undefined;

    for (const dest of this.destinations) {
      if (!dest.configured || dest.status !== 'SUPPORTED_STATIC') {
        attempts.push({
          destinationId: dest.id,
          attempt: total + 1,
          startedAt: new Date().toISOString(),
          outcome: 'skipped',
          reason: dest.reason || 'not configured/verified',
        });
        continue;
      }

      for (let r = 0; r < this.opts.maxRetriesPerDestination; r++) {
        if (total >= this.opts.maxTotalAttempts) {
          return { attempts, finalState: 'stopped', exhausted: true };
        }
        total++;
        const startedAt = new Date().toISOString();
        let res: { ok: boolean; failure?: { httpStatus?: number; message?: string; kind?: string } };
        try {
          res = await executor(dest);
        } catch (e) {
          res = { ok: false, failure: { message: (e as Error).message } };
        }

        if (res.ok) {
          attempts.push({ destinationId: dest.id, attempt: total, startedAt, outcome: 'success' });
          succeeded = dest.id;
          return { attempts, finalState: 'success', succeededDestination: succeeded, exhausted: false };
        }

        const cls = classifyFailure(res.failure || {});
        attempts.push({
          destinationId: dest.id,
          attempt: total,
          startedAt,
          outcome: 'failed',
          failureType: cls.type,
          reason: cls.reason,
        });

        if (!cls.rotateProvider) {
          if (cls.type === 'auth_401_403' || cls.type === 'invalid_request' || cls.type === 'tool_failure' || cls.type === 'repo_test_failure') {
            return { attempts, finalState: 'stopped', exhausted: false };
          }
          break;
        }
        break;
      }
    }

    if (!succeeded) {
      return { attempts, finalState: 'exhausted', exhausted: true };
    }
    return { attempts, finalState: 'success', succeededDestination: succeeded, exhausted: false };
  }
}
