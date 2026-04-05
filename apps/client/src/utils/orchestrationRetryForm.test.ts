import { describe, expect, test } from 'bun:test';
import {
  draftFromRetryLayer,
  formatResolutionSource,
  validateAndBuildRetryPatch,
  type RetryFormDraft,
} from './orchestrationRetryForm';

describe('orchestrationRetryForm', () => {
  test('draftFromRetryLayer maps nulls to empty / inherit', () => {
    const d = draftFromRetryLayer({
      retry_max_attempts: null,
      retry_backoff_ms: null,
      retry_max_backoff_ms: null,
      retry_jitter: null,
    });
    expect(d.retry_max_attempts).toBe('');
    expect(d.retry_jitter).toBe('inherit');
  });

  test('validateAndBuildRetryPatch: empty fields → all null (inherit)', () => {
    const draft: RetryFormDraft = {
      retry_max_attempts: '',
      retry_backoff_ms: '',
      retry_max_backoff_ms: '',
      retry_jitter: 'inherit',
    };
    const r = validateAndBuildRetryPatch(draft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch).toEqual({
      retry_max_attempts: null,
      retry_backoff_ms: null,
      retry_max_backoff_ms: null,
      retry_jitter: null,
    });
  });

  test('validateAndBuildRetryPatch: set values', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '3',
      retry_backoff_ms: '500',
      retry_max_backoff_ms: '8000',
      retry_jitter: 'uniform',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.retry_max_attempts).toBe(3);
    expect(r.patch.retry_backoff_ms).toBe(500);
    expect(r.patch.retry_max_backoff_ms).toBe(8000);
    expect(r.patch.retry_jitter).toBe('uniform');
  });

  test('validateAndBuildRetryPatch: max_attempts must be >= 1 when set', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '0',
      retry_backoff_ms: '',
      retry_max_backoff_ms: '',
      retry_jitter: 'inherit',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('Max attempts');
  });

  test('formatResolutionSource', () => {
    expect(formatResolutionSource('team')).toBe('Team');
    expect(formatResolutionSource('policy')).toBe('Policy');
  });
});
