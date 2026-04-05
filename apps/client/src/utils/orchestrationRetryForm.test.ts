import { describe, expect, test } from 'bun:test';
import {
  draftFromRetryLayer,
  formatClock,
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

  test('validateAndBuildRetryPatch: negative backoff rejected', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '',
      retry_backoff_ms: '-1',
      retry_max_backoff_ms: '',
      retry_jitter: 'inherit',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('Backoff');
  });

  test('validateAndBuildRetryPatch: negative max_backoff rejected', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '',
      retry_backoff_ms: '',
      retry_max_backoff_ms: '-5',
      retry_jitter: 'inherit',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('Max backoff');
  });

  test('validateAndBuildRetryPatch: backoff > max_backoff rejected', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '3',
      retry_backoff_ms: '2000',
      retry_max_backoff_ms: '500',
      retry_jitter: 'inherit',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('exceed');
  });

  test('validateAndBuildRetryPatch: backoff === max_backoff is valid', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '3',
      retry_backoff_ms: '1000',
      retry_max_backoff_ms: '1000',
      retry_jitter: 'inherit',
    });
    expect(r.ok).toBe(true);
  });

  test('validateAndBuildRetryPatch: non-integer rejected', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '3.5',
      retry_backoff_ms: '',
      retry_max_backoff_ms: '',
      retry_jitter: 'inherit',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('whole number');
  });

  test('validateAndBuildRetryPatch: whitespace around numbers is accepted', () => {
    const r = validateAndBuildRetryPatch({
      retry_max_attempts: '  5  ',
      retry_backoff_ms: '  100  ',
      retry_max_backoff_ms: '  2000  ',
      retry_jitter: 'uniform',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.retry_max_attempts).toBe(5);
    expect(r.patch.retry_backoff_ms).toBe(100);
    expect(r.patch.retry_max_backoff_ms).toBe(2000);
  });

  test('formatClock returns a time string', () => {
    const ts = new Date('2025-01-15T14:30:45').getTime();
    const result = formatClock(ts);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('formatClock handles zero gracefully', () => {
    const result = formatClock(0);
    expect(typeof result).toBe('string');
  });
});
