import { pruneOrchestrationAdminAudit, pruneOrchestrationTaskRuns } from './repository';

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
  taskRunsMaxDays?: number;
  taskRunsMaxRows?: number;
} {
  return {
    adminAuditMaxDays: parseRetentionInt(process.env.ORCH_ADMIN_AUDIT_MAX_DAYS),
    adminAuditMaxRows: parseRetentionInt(process.env.ORCH_ADMIN_AUDIT_MAX_ROWS),
    taskRunsMaxDays: parseRetentionInt(process.env.ORCH_TASK_RUNS_MAX_DAYS),
    taskRunsMaxRows: parseRetentionInt(process.env.ORCH_TASK_RUNS_MAX_ROWS),
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
  const total =
    admin.removed_by_age + admin.removed_by_row_cap + runs.removed_by_age + runs.removed_by_row_cap;

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
    total_rows_removed: total,
  };

  if (total > 0) {
    console.log('[orchestration:retention]', JSON.stringify(summary));
  }

  return summary;
}
