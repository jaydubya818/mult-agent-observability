import type { RetryJitterMode, ResolvedTaskRetryConfig } from '../orchestrationTypes';

export type RetryJitterUi = 'inherit' | RetryJitterMode;

/** Local editable state; empty numeric strings mean "inherit" (`null` on save). */
export type RetryFormDraft = {
  retry_max_attempts: string;
  retry_backoff_ms: string;
  retry_max_backoff_ms: string;
  retry_jitter: RetryJitterUi;
};

export type RetryPatchPayload = {
  retry_max_attempts: number | null;
  retry_backoff_ms: number | null;
  retry_max_backoff_ms: number | null;
  retry_jitter: RetryJitterMode | null;
};

export function draftFromRetryLayer(layer: {
  retry_max_attempts: number | null;
  retry_backoff_ms: number | null;
  retry_max_backoff_ms: number | null;
  retry_jitter: RetryJitterMode | null;
}): RetryFormDraft {
  return {
    retry_max_attempts: layer.retry_max_attempts != null ? String(layer.retry_max_attempts) : '',
    retry_backoff_ms: layer.retry_backoff_ms != null ? String(layer.retry_backoff_ms) : '',
    retry_max_backoff_ms: layer.retry_max_backoff_ms != null ? String(layer.retry_max_backoff_ms) : '',
    retry_jitter: layer.retry_jitter ?? 'inherit',
  };
}

function parseIntField(raw: string, label: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, message: `${label} must be a whole number` };
  }
  return { ok: true, value: n };
}

/**
 * Client-side validation aligned with server expectations.
 * Server remains authoritative on persist.
 */
export function validateAndBuildRetryPatch(draft: RetryFormDraft): { ok: true; patch: RetryPatchPayload } | { ok: false; message: string } {
  const a = parseIntField(draft.retry_max_attempts, 'Max attempts');
  if (!a.ok) return a;
  if (a.value != null && a.value < 1) {
    return { ok: false, message: 'Max attempts must be at least 1 when set' };
  }

  const b = parseIntField(draft.retry_backoff_ms, 'Backoff (ms)');
  if (!b.ok) return b;
  if (b.value != null && b.value < 0) {
    return { ok: false, message: 'Backoff must be non-negative' };
  }

  const c = parseIntField(draft.retry_max_backoff_ms, 'Max backoff (ms)');
  if (!c.ok) return c;
  if (c.value != null && c.value < 0) {
    return { ok: false, message: 'Max backoff must be non-negative' };
  }

  // Cross-field: backoff must not exceed max_backoff when both are set
  if (b.value != null && c.value != null && b.value > c.value) {
    return { ok: false, message: 'Backoff (ms) must not exceed Max backoff (ms)' };
  }

  let jitter: RetryJitterMode | null;
  if (draft.retry_jitter === 'inherit') jitter = null;
  else if (draft.retry_jitter === 'off' || draft.retry_jitter === 'uniform') jitter = draft.retry_jitter;
  else return { ok: false, message: 'Jitter must be inherit, off, or uniform' };

  return {
    ok: true,
    patch: {
      retry_max_attempts: a.value,
      retry_backoff_ms: b.value,
      retry_max_backoff_ms: c.value,
      retry_jitter: jitter,
    },
  };
}

/** Shared clock formatter for retry hint labels. */
export function formatClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return String(ts);
  }
}

export function formatResolutionSource(src: ResolvedTaskRetryConfig['resolution']['max_attempts']): string {
  switch (src) {
    case 'team':
      return 'Team';
    case 'policy':
      return 'Policy';
    case 'env':
      return 'Env';
    case 'default':
      return 'Default';
    default:
      return String(src);
  }
}
