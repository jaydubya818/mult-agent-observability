import {
  pruneOrchestrationAdminAudit,
  pruneOrchestrationTaskRunHistory,
  pruneOrchestrationTaskRuns,
} from './repository';

/** Which env var produced an effective history limit (`null` = that dimension disabled for this prune). */
export type TaskRunHistoryLimitSource = {
  max_days: 'ORCH_TASK_RUN_HISTORY_MAX_DAYS' | 'ORCH_TASK_RUNS_MAX_DAYS' | null;
  max_rows: 'ORCH_TASK_RUN_HISTORY_MAX_ROWS' | 'ORCH_TASK_RUNS_MAX_ROWS' | null;
};

/** Env tier for `orchestration_admin_audit_log` limits (null = dimension off). */
export type AdminAuditLimitSource = {
  max_days: 'ORCH_ADMIN_AUDIT_MAX_DAYS' | null;
  max_rows: 'ORCH_ADMIN_AUDIT_MAX_ROWS' | null;
};

/** Env tier for live `orchestration_task_runs` (null = dimension off). */
export type TaskRunsLimitSource = {
  max_days: 'ORCH_TASK_RUNS_MAX_DAYS' | null;
  max_rows: 'ORCH_TASK_RUNS_MAX_ROWS' | null;
};

export type RetentionSectionView = {
  max_days: number | null;
  max_rows: number | null;
  notes: string[];
};

export type RetentionConfigView = {
  /** Always true — this payload is introspection only; prune is never run. */
  read_only: true;
  admin_audit: RetentionSectionView & { limit_source: AdminAuditLimitSource };
  task_runs: RetentionSectionView & { limit_source: TaskRunsLimitSource };
  task_run_history: RetentionSectionView & { limit_source: TaskRunHistoryLimitSource };
};

export type RetentionSummary = {
  triggered_at: number;
  admin_audit: {
    removed_by_age: number;
    removed_by_row_cap: number;
    config: { max_days?: number; max_rows?: number };
  };
  task_runs: {
    removed_by_age: number;
    removed_by_row_cap: number;
    config: { max_days?: number; max_rows?: number };
  };
  task_run_history: {
    removed_by_age: number;
    removed_by_row_cap: number;
    /** Effective limits used this pass (after per-field fallback). */
    config: { max_days?: number; max_rows?: number };
    /** Per dimension: explicit history env vs inherited live `ORCH_TASK_RUNS_*`, or null if off. */
    limit_source: TaskRunHistoryLimitSource;
  };
  total_rows_removed: number;
};

function parseRetentionInt(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function retentionConfigFromEnv(): {
  adminAuditMaxDays?: number;
  adminAuditMaxRows?: number;
  /** Applies only to `orchestration_task_runs` (one live row per task). */
  taskRunsMaxDays?: number;
  taskRunsMaxRows?: number;
  /** Optional overrides for `orchestration_task_run_history`. If a value is omitted here, the corresponding `ORCH_TASK_RUNS_*` limit is reused for that dimension only (backward-compatible default). */
  taskRunHistoryMaxDays?: number;
  taskRunHistoryMaxRows?: number;
} {
  return {
    adminAuditMaxDays: parseRetentionInt(process.env.ORCH_ADMIN_AUDIT_MAX_DAYS),
    adminAuditMaxRows: parseRetentionInt(process.env.ORCH_ADMIN_AUDIT_MAX_ROWS),
    taskRunsMaxDays: parseRetentionInt(process.env.ORCH_TASK_RUNS_MAX_DAYS),
    taskRunsMaxRows: parseRetentionInt(process.env.ORCH_TASK_RUNS_MAX_ROWS),
    taskRunHistoryMaxDays: parseRetentionInt(process.env.ORCH_TASK_RUN_HISTORY_MAX_DAYS),
    taskRunHistoryMaxRows: parseRetentionInt(process.env.ORCH_TASK_RUN_HISTORY_MAX_ROWS),
  };
}

function taskRunHistoryLimitSource(cfg: ReturnType<typeof retentionConfigFromEnv>): TaskRunHistoryLimitSource {
  return {
    max_days:
      cfg.taskRunHistoryMaxDays != null
        ? 'ORCH_TASK_RUN_HISTORY_MAX_DAYS'
        : cfg.taskRunsMaxDays != null
          ? 'ORCH_TASK_RUNS_MAX_DAYS'
          : null,
    max_rows:
      cfg.taskRunHistoryMaxRows != null
        ? 'ORCH_TASK_RUN_HISTORY_MAX_ROWS'
        : cfg.taskRunsMaxRows != null
          ? 'ORCH_TASK_RUNS_MAX_ROWS'
          : null,
  };
}

function adminAuditLimitSource(cfg: ReturnType<typeof retentionConfigFromEnv>): AdminAuditLimitSource {
  return {
    max_days: cfg.adminAuditMaxDays != null ? 'ORCH_ADMIN_AUDIT_MAX_DAYS' : null,
    max_rows: cfg.adminAuditMaxRows != null ? 'ORCH_ADMIN_AUDIT_MAX_ROWS' : null,
  };
}

function taskRunsLimitSource(cfg: ReturnType<typeof retentionConfigFromEnv>): TaskRunsLimitSource {
  return {
    max_days: cfg.taskRunsMaxDays != null ? 'ORCH_TASK_RUNS_MAX_DAYS' : null,
    max_rows: cfg.taskRunsMaxRows != null ? 'ORCH_TASK_RUNS_MAX_ROWS' : null,
  };
}

function retentionNotesForTable(
  maxDays: number | undefined,
  maxRows: number | undefined,
  extraNotes: string[] = []
): string[] {
  const notes: string[] = [...extraNotes];
  const d = maxDays ?? null;
  const r = maxRows ?? null;
  if (d === null && r === null) {
    notes.push('No limits configured — this table is not pruned.');
    return notes;
  }
  if (d === null) notes.push('max_days unset — no age-based pruning.');
  if (r === null) notes.push('max_rows unset — no row-cap pruning.');
  return notes;
}

/**
 * Effective retention limits and env provenance as seen by the server **right now** (from `process.env`).
 * Does **not** run prune or touch the database. Optional `overrides` matches `runOrchestrationRetentionPrune` tests.
 */
export function getOrchestrationRetentionConfigView(
  overrides?: Partial<ReturnType<typeof retentionConfigFromEnv>>
): RetentionConfigView {
  const env = retentionConfigFromEnv();
  const cfg = { ...env, ...overrides };

  const histMaxDays = cfg.taskRunHistoryMaxDays ?? cfg.taskRunsMaxDays;
  const histMaxRows = cfg.taskRunHistoryMaxRows ?? cfg.taskRunsMaxRows;

  const histExtra: string[] = [];
  if (cfg.taskRunHistoryMaxDays == null && cfg.taskRunsMaxDays != null) {
    histExtra.push('ORCH_TASK_RUN_HISTORY_MAX_DAYS unset — max_days falls back to ORCH_TASK_RUNS_MAX_DAYS.');
  }
  if (cfg.taskRunHistoryMaxRows == null && cfg.taskRunsMaxRows != null) {
    histExtra.push('ORCH_TASK_RUN_HISTORY_MAX_ROWS unset — max_rows falls back to ORCH_TASK_RUNS_MAX_ROWS.');
  }

  return {
    read_only: true,
    admin_audit: {
      max_days: cfg.adminAuditMaxDays ?? null,
      max_rows: cfg.adminAuditMaxRows ?? null,
      limit_source: adminAuditLimitSource(cfg),
      notes: retentionNotesForTable(cfg.adminAuditMaxDays, cfg.adminAuditMaxRows),
    },
    task_runs: {
      max_days: cfg.taskRunsMaxDays ?? null,
      max_rows: cfg.taskRunsMaxRows ?? null,
      limit_source: taskRunsLimitSource(cfg),
      notes: retentionNotesForTable(cfg.taskRunsMaxDays, cfg.taskRunsMaxRows),
    },
    task_run_history: {
      max_days: histMaxDays ?? null,
      max_rows: histMaxRows ?? null,
      limit_source: taskRunHistoryLimitSource(cfg),
      notes: retentionNotesForTable(histMaxDays, histMaxRows, histExtra),
    },
  };
}

/**
 * Apply env-driven retention (unless overrides supplied). Safe to call on startup.
 * Logs one structured line to stdout only when at least one row was deleted.
 */
export function runOrchestrationRetentionPrune(overrides?: Partial<ReturnType<typeof retentionConfigFromEnv>>): RetentionSummary {
  const env = retentionConfigFromEnv();
  const cfg = { ...env, ...overrides };

  const admin = pruneOrchestrationAdminAudit(cfg.adminAuditMaxDays, cfg.adminAuditMaxRows);
  const runs = pruneOrchestrationTaskRuns(cfg.taskRunsMaxDays, cfg.taskRunsMaxRows);
  /** Per-field fallback: history uses `ORCH_TASK_RUN_HISTORY_*` when set, else the matching `ORCH_TASK_RUNS_*` for that dimension only. */
  const histMaxDays = cfg.taskRunHistoryMaxDays ?? cfg.taskRunsMaxDays;
  const histMaxRows = cfg.taskRunHistoryMaxRows ?? cfg.taskRunsMaxRows;
  const historyLimitSource = taskRunHistoryLimitSource(cfg);
  const runHist = pruneOrchestrationTaskRunHistory(histMaxDays, histMaxRows);
  const total =
    admin.removed_by_age +
    admin.removed_by_row_cap +
    runs.removed_by_age +
    runs.removed_by_row_cap +
    runHist.removed_by_age +
    runHist.removed_by_row_cap;

  const summary: RetentionSummary = {
    triggered_at: Date.now(),
    admin_audit: {
      removed_by_age: admin.removed_by_age,
      removed_by_row_cap: admin.removed_by_row_cap,
      config: { max_days: cfg.adminAuditMaxDays, max_rows: cfg.adminAuditMaxRows },
    },
    task_runs: {
      removed_by_age: runs.removed_by_age,
      removed_by_row_cap: runs.removed_by_row_cap,
      config: { max_days: cfg.taskRunsMaxDays, max_rows: cfg.taskRunsMaxRows },
    },
    task_run_history: {
      removed_by_age: runHist.removed_by_age,
      removed_by_row_cap: runHist.removed_by_row_cap,
      config: { max_days: histMaxDays, max_rows: histMaxRows },
      limit_source: historyLimitSource,
    },
    total_rows_removed: total,
  };

  if (total > 0) {
    console.log('[orchestration:retention]', JSON.stringify(summary));
  }

  return summary;
}
