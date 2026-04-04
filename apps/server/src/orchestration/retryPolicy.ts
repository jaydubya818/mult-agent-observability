import type { ResolvedTaskRetryConfig, RetryConfigLayer, RetryJitterMode, RetryResolutionSource } from './types';
import type { WorkloadTerminalKind } from './environments/executionEnvironment';

/** Deprecated: legacy payload key; stripped on read / ignored for persistence. */
export const ORCH_RETRY_PAYLOAD_KEY = '__orch_retry';

export type TaskRetryEnvSlice = {
  max_attempts: number;
  backoff_ms: number;
  max_backoff_ms: number | null;
  jitter: RetryJitterMode;
};

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function parseOptionalPositiveInt(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseJitter(raw: string | undefined): RetryJitterMode {
  if (raw === 'uniform') return 'uniform';
  return 'off';
}

/**
 * Env tier for resolution: `ORCH_TASK_MAX_ATTEMPTS`, `ORCH_TASK_RETRY_BACKOFF_MS`,
 * `ORCH_TASK_RETRY_MAX_BACKOFF_MS` (optional cap), `ORCH_TASK_RETRY_JITTER` (`off`|`uniform`).
 */
export function readTaskRetryConfigFromEnv(): TaskRetryEnvSlice {
  const max_attempts = Math.max(1, parseNonNegativeInt(process.env.ORCH_TASK_MAX_ATTEMPTS, 1));
  const backoff_ms = parseNonNegativeInt(process.env.ORCH_TASK_RETRY_BACKOFF_MS, 1000);
  const max_backoff_ms = parseOptionalPositiveInt(process.env.ORCH_TASK_RETRY_MAX_BACKOFF_MS);
  const jitter = parseJitter(process.env.ORCH_TASK_RETRY_JITTER);
  return { max_attempts, backoff_ms, max_backoff_ms, jitter };
}

const HARDCODED: TaskRetryEnvSlice = {
  max_attempts: 1,
  backoff_ms: 1000,
  max_backoff_ms: null,
  jitter: 'off',
};

function pickNumber(
  teamV: number | null | undefined,
  policyV: number | null | undefined,
  envV: number,
  defV: number,
  sources: { team: RetryResolutionSource; policy: RetryResolutionSource; env: RetryResolutionSource; def: RetryResolutionSource }
): { value: number; source: RetryResolutionSource } {
  if (teamV != null && Number.isFinite(teamV)) {
    const v = Math.floor(Number(teamV));
    if (v >= 0) return { value: v, source: sources.team };
  }
  if (policyV != null && Number.isFinite(policyV)) {
    const v = Math.floor(Number(policyV));
    if (v >= 0) return { value: v, source: sources.policy };
  }
  if (envV != null && Number.isFinite(envV)) return { value: Math.floor(Number(envV)), source: sources.env };
  return { value: defV, source: sources.def };
}

function pickOptionalNumber(
  teamV: number | null | undefined,
  policyV: number | null | undefined,
  envV: number | null,
  defV: number | null
): { value: number | null; source: RetryResolutionSource } {
  if (teamV != null && Number.isFinite(teamV)) {
    const v = Math.floor(Number(teamV));
    if (v > 0) return { value: v, source: 'team' };
    if (v === 0) return { value: null, source: 'team' };
  }
  if (policyV != null && Number.isFinite(policyV)) {
    const v = Math.floor(Number(policyV));
    if (v > 0) return { value: v, source: 'policy' };
    if (v === 0) return { value: null, source: 'policy' };
  }
  if (envV != null && Number.isFinite(envV) && envV > 0) return { value: Math.floor(envV), source: 'env' };
  return { value: defV, source: 'default' };
}

function pickJitter(
  teamV: RetryJitterMode | null | undefined,
  policyV: RetryJitterMode | null | undefined,
  envV: RetryJitterMode,
  defV: RetryJitterMode
): { value: RetryJitterMode; source: RetryResolutionSource } {
  if (teamV === 'uniform' || teamV === 'off') return { value: teamV, source: 'team' };
  if (policyV === 'uniform' || policyV === 'off') return { value: policyV, source: 'policy' };
  if (envV === 'uniform' || envV === 'off') return { value: envV, source: 'env' };
  return { value: defV, source: 'default' };
}

/**
 * Resolution order **per field**: team column → linked execution policy columns → env → hardcoded default.
 */
export function resolveTaskRetryConfig(input: { team: RetryConfigLayer; policy: RetryConfigLayer | null }): ResolvedTaskRetryConfig {
  const env = readTaskRetryConfigFromEnv();

  const maxP = pickNumber(
    input.team.retry_max_attempts,
    input.policy?.retry_max_attempts,
    env.max_attempts,
    HARDCODED.max_attempts,
    { team: 'team', policy: 'policy', env: 'env', def: 'default' }
  );
  const max_attempts = Math.max(1, maxP.value);

  const backoffP = pickNumber(
    input.team.retry_backoff_ms,
    input.policy?.retry_backoff_ms,
    env.backoff_ms,
    HARDCODED.backoff_ms,
    { team: 'team', policy: 'policy', env: 'env', def: 'default' }
  );

  const capP = pickOptionalNumber(
    input.team.retry_max_backoff_ms,
    input.policy?.retry_max_backoff_ms,
    env.max_backoff_ms,
    HARDCODED.max_backoff_ms
  );

  const jitP = pickJitter(input.team.retry_jitter, input.policy?.retry_jitter ?? null, env.jitter, HARDCODED.jitter);

  return {
    max_attempts,
    backoff_ms: backoffP.value,
    max_backoff_ms: capP.value,
    jitter: jitP.value,
    resolution: {
      max_attempts: maxP.source,
      backoff_ms: backoffP.source,
      max_backoff_ms: capP.source,
      jitter: jitP.source,
    },
  };
}

/** Which terminal workload outcomes may be re-queued (until max_attempts). */
export function isRetryableTerminal(terminal: WorkloadTerminalKind): boolean {
  return terminal === 'process_error' || terminal === 'timed_out';
}

/**
 * Raw exponential step: `baseMs * 2 ** (failedAttempt - 1)`.
 */
export function computeRetryDelayMs(failedAttemptNumber: number, baseMs: number): number {
  if (baseMs <= 0) return 0;
  const exp = Math.max(0, failedAttemptNumber - 1);
  return baseMs * 2 ** exp;
}

/**
 * Applies optional max backoff cap and jitter (uniform: U(0.85, 1.15) on positive delays).
 */
export function computeRetryDelayWithPolicy(failedAttemptNumber: number, cfg: ResolvedTaskRetryConfig): number {
  let delay = computeRetryDelayMs(failedAttemptNumber, cfg.backoff_ms);
  if (cfg.max_backoff_ms != null && cfg.max_backoff_ms > 0 && delay > cfg.max_backoff_ms) {
    delay = cfg.max_backoff_ms;
  }
  if (cfg.jitter === 'uniform' && delay > 0) {
    delay = Math.round(delay * (0.85 + Math.random() * 0.3));
  }
  return delay;
}

export function taskQueuedAndReadyForDispatch(task: { status: string; retry_next_at: number | null }): boolean {
  if (task.status !== 'queued') return false;
  const at = task.retry_next_at;
  if (at != null && Date.now() < at) return false;
  return true;
}

/** Remove legacy embedded retry blob from user payload (in-memory). */
export function stripLegacyRetryFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  delete next[ORCH_RETRY_PAYLOAD_KEY];
  return next;
}
