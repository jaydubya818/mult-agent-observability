/**
 * Helpers for task run history UI (deduping live snapshot vs archived rows, previews).
 */

/** API filter: empty / whitespace-only → no `task_id` param. */
export function normalizedOptionalTaskId(raw: string): string | undefined {
  const t = raw.trim();
  return t === '' ? undefined : t;
}

export function taskRunHistoryPreview(r: {
  error_message?: string | null;
  stderr_tail?: string;
  stdout_tail?: string;
}): string {
  const parts = [r.error_message, r.stderr_tail, r.stdout_tail].filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0
  );
  const s = parts[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!s) return '—';
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

/**
 * The live snapshot row (`task_runs` in snapshot) for a terminal task duplicates the newest archived
 * row (same `run_id`). Hide that archived row so operators see “current run” once and “prior attempts”
 * for older `run_id`s only. In-flight runs are not in history yet, so no row is dropped incorrectly.
 */
export function dedupeHistoryVsLiveSnapshot<T extends { run_id: string }>(
  history: T[],
  liveRunId: string | null | undefined
): T[] {
  if (liveRunId == null || liveRunId === '') return history;
  return history.filter((h) => h.run_id !== liveRunId);
}
