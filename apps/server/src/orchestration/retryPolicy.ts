import type { WorkloadTerminalKind } from './environments/executionEnvironment';

/** Reserved task payload key for orchestration retry bookkeeping (JSON in DB). */
export const ORCH_RETRY_PAYLOAD_KEY = '__orch_retry';

export type TaskRetryPayloadMeta = {
  attempt: number;
  max_attempts: number;
  /** When set and `Date.now() < next_retry_at`, queued tasks are not dispatched. */
  next_retry_at?: number;
  last_failure_class?: WorkloadTerminalKind;
};

export type TaskRetryConfig = {
  max_attempts: number;
  /** Base delay for exponential backoff (ms). 0 means immediate re-queue. */
  backoff_ms: number;
};

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * Env defaults: `ORCH_TASK_MAX_ATTEMPTS` (min 1, default 1 = no retries),
 * `ORCH_TASK_RETRY_BACKOFF_MS` (default 1000).
 */
export function readTaskRetryConfigFromEnv(): TaskRetryConfig {
  const max_attempts = Math.max(1, parseNonNegativeInt(process.env.ORCH_TASK_MAX_ATTEMPTS, 1));
  const backoff_ms = parseNonNegativeInt(process.env.ORCH_TASK_RETRY_BACKOFF_MS, 1000);
  return { max_attempts, backoff_ms };
}

/** Which terminal workload outcomes may be re-queued (until max_attempts). */
export function isRetryableTerminal(terminal: WorkloadTerminalKind): boolean {
  return terminal === 'process_error' || terminal === 'timed_out';
}

/**
 * Delay before returning a failed task to `queued` after failure on `failedAttemptNumber`
 * (1-based: first failure → wait base * 2^0).
 */
export function computeRetryDelayMs(failedAttemptNumber: number, baseMs: number): number {
  if (baseMs <= 0) return 0;
  const exp = Math.max(0, failedAttemptNumber - 1);
  return baseMs * 2 ** exp;
}

export function getRetryMetaFromPayload(payload: Record<string, unknown> | undefined): TaskRetryPayloadMeta | undefined {
  if (!payload) return undefined;
  const raw = payload[ORCH_RETRY_PAYLOAD_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const attempt = typeof r.attempt === 'number' ? r.attempt : undefined;
  const max_attempts = typeof r.max_attempts === 'number' ? r.max_attempts : undefined;
  if (attempt == null || max_attempts == null) return undefined;
  const next_retry_at = typeof r.next_retry_at === 'number' ? r.next_retry_at : undefined;
  const last_failure_class =
    typeof r.last_failure_class === 'string' ? (r.last_failure_class as WorkloadTerminalKind) : undefined;
  return { attempt, max_attempts, next_retry_at, last_failure_class };
}

export function taskQueuedAndReadyForDispatch(task: { status: string; payload: Record<string, unknown> }): boolean {
  if (task.status !== 'queued') return false;
  const meta = getRetryMetaFromPayload(task.payload);
  const at = meta?.next_retry_at;
  if (at != null && Date.now() < at) return false;
  return true;
}

export function stripRetryFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  delete next[ORCH_RETRY_PAYLOAD_KEY];
  return next;
}

export function mergeRetryPayloadForNewAttempt(
  payload: Record<string, unknown>,
  attempt: number,
  max_attempts: number
): Record<string, unknown> {
  const prev = getRetryMetaFromPayload(payload);
  return {
    ...payload,
    [ORCH_RETRY_PAYLOAD_KEY]: {
      attempt,
      max_attempts,
      next_retry_at: undefined,
      last_failure_class: prev?.last_failure_class,
    } satisfies TaskRetryPayloadMeta,
  };
}

export function mergeRetryPayloadForScheduledRetry(
  payload: Record<string, unknown>,
  input: {
    attempt: number;
    max_attempts: number;
    next_retry_at: number;
    last_failure_class: WorkloadTerminalKind;
  }
): Record<string, unknown> {
  return {
    ...payload,
    [ORCH_RETRY_PAYLOAD_KEY]: {
      attempt: input.attempt,
      max_attempts: input.max_attempts,
      next_retry_at: input.next_retry_at,
      last_failure_class: input.last_failure_class,
    } satisfies TaskRetryPayloadMeta,
  };
}
