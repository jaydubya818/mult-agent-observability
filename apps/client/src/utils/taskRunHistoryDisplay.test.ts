import { describe, expect, test } from 'bun:test';
import {
  dedupeHistoryVsLiveSnapshot,
  normalizedOptionalTaskId,
  taskRunHistoryPreview,
} from './taskRunHistoryDisplay';

describe('taskRunHistoryDisplay', () => {
  test('normalizedOptionalTaskId trims and drops empty', () => {
    expect(normalizedOptionalTaskId('  abc  ')).toBe('abc');
    expect(normalizedOptionalTaskId('')).toBeUndefined();
    expect(normalizedOptionalTaskId('   ')).toBeUndefined();
  });

  test('taskRunHistoryPreview prefers error, then stderr, then stdout', () => {
    expect(
      taskRunHistoryPreview({
        error_message: 'boom',
        stderr_tail: 'e2',
        stdout_tail: 'o1',
      })
    ).toBe('boom');
    expect(taskRunHistoryPreview({ stderr_tail: 'e2', stdout_tail: 'o1' })).toBe('e2');
    expect(taskRunHistoryPreview({ stdout_tail: 'hello\nworld' })).toBe('hello world');
  });

  test('taskRunHistoryPreview truncates long strings', () => {
    const long = 'a'.repeat(200);
    expect(taskRunHistoryPreview({ stdout_tail: long }).length).toBeLessThanOrEqual(160);
    expect(taskRunHistoryPreview({ stdout_tail: long }).endsWith('…')).toBe(true);
  });

  test('dedupeHistoryVsLiveSnapshot removes row matching live run_id', () => {
    const rows = [
      { run_id: 'a', n: 1 },
      { run_id: 'b', n: 2 },
    ];
    expect(dedupeHistoryVsLiveSnapshot(rows, 'b')).toEqual([{ run_id: 'a', n: 1 }]);
  });

  test('dedupeHistoryVsLiveSnapshot is noop when no live id', () => {
    const rows = [{ run_id: 'x' }];
    expect(dedupeHistoryVsLiveSnapshot(rows, null)).toEqual(rows);
    expect(dedupeHistoryVsLiveSnapshot(rows, undefined)).toEqual(rows);
    expect(dedupeHistoryVsLiveSnapshot(rows, '')).toEqual(rows);
  });
});
