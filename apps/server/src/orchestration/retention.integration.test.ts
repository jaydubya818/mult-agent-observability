import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, db, initDatabase } from '../db';
import { bootstrapOrchestration } from './bootstrap';
import {
  countAdminAuditRecords,
  createTask,
  createTeam,
  finalizeTaskRun,
  initOrchestrationSchema,
  insertAdminAuditRecord,
  listAdminAuditRecords,
  startTaskRun,
} from './repository';
import { getOrchestrationRetentionConfigView, runOrchestrationRetentionPrune } from './retention';

const DAY_MS = 24 * 60 * 60 * 1000;

const RETENTION_ENV_KEYS = [
  'ORCH_ADMIN_AUDIT_MAX_DAYS',
  'ORCH_ADMIN_AUDIT_MAX_ROWS',
  'ORCH_TASK_RUNS_MAX_DAYS',
  'ORCH_TASK_RUNS_MAX_ROWS',
  'ORCH_TASK_RUN_HISTORY_MAX_DAYS',
  'ORCH_TASK_RUN_HISTORY_MAX_ROWS',
] as const;

function snapshotRetentionEnv(): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (const k of RETENTION_ENV_KEYS) o[k] = process.env[k];
  return o;
}

function restoreRetentionEnv(snap: Record<string, string | undefined>): void {
  for (const k of RETENTION_ENV_KEYS) {
    const v = snap[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Insert a terminal history row (for retention tests) without touching live `task_runs`. */
function insertTaskRunHistoryRow(input: {
  run_id: string;
  task_id: string;
  team_id: string;
  finished_at: number;
  status?: 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'policy_rejected';
}): void {
  const status = input.status ?? 'completed';
  const fin = input.finished_at;
  db.prepare(
    `INSERT INTO orchestration_task_run_history (
      run_id, task_id, team_id, agent_id, environment_kind, status, attempt,
      stdout_tail, stderr_tail, stdout_bytes, stderr_bytes, exit_code,
      started_at, finished_at, error_message, termination_reason, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.run_id,
    input.task_id,
    input.team_id,
    'a',
    'local_process',
    status,
    1,
    '',
    '',
    0,
    0,
    0,
    fin - 1000,
    fin,
    null,
    'success',
    fin
  );
}

function seedAuditRow(created_at: number, idSuffix: string): void {
  insertAdminAuditRecord({
    id: `audit-${idSuffix}`,
    created_at,
    route: '/api/orchestration/policies',
    method: 'POST',
    action: 'policy_create',
    target_entity_type: 'policy',
    target_entity_id: `pol-${idSuffix}`,
    outcome: 'success',
    auth_mode: 'open_mode',
    client_ip: null,
    metadata: { test: true },
  });
}

describe('Retention: admin audit log', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-retention-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('max_days removes stale rows; keeps fresh rows', () => {
    const now = Date.now();
    seedAuditRow(now - 90 * DAY_MS, 'old');
    seedAuditRow(now - 10 * DAY_MS, 'fresh');
    expect(countAdminAuditRecords()).toBe(2);
    const s = runOrchestrationRetentionPrune({ adminAuditMaxDays: 30 });
    expect(s.admin_audit.removed_by_age).toBe(1);
    expect(s.admin_audit.removed_by_row_cap).toBe(0);
    expect(countAdminAuditRecords()).toBe(1);
    const rows = db.prepare(`SELECT id FROM orchestration_admin_audit_log`).all() as { id: string }[];
    expect(rows[0]!.id).toBe('audit-fresh');
  });

  test('max_rows cap keeps newest rows after age prune (precedence: age then cap)', () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      seedAuditRow(now - 60 * DAY_MS - i * 1000, `old-${i}`);
    }
    for (let j = 0; j < 10; j++) {
      seedAuditRow(now - j * 1000, `new-${j}`);
    }
    expect(countAdminAuditRecords()).toBe(15);
    const s = runOrchestrationRetentionPrune({
      adminAuditMaxDays: 30,
      adminAuditMaxRows: 8,
    });
    expect(s.admin_audit.removed_by_age).toBe(5);
    expect(s.admin_audit.removed_by_row_cap).toBe(2);
    expect(countAdminAuditRecords()).toBe(8);
  });

  test('row cap alone trims oldest', () => {
    const now = Date.now();
    for (let k = 0; k < 12; k++) {
      seedAuditRow(now - k * 10000, `cap-${k}`);
    }
    const s = runOrchestrationRetentionPrune({ adminAuditMaxRows: 5 });
    expect(s.admin_audit.removed_by_age).toBe(0);
    expect(s.admin_audit.removed_by_row_cap).toBe(7);
    expect(countAdminAuditRecords()).toBe(5);
  });

  test('no config removes nothing', () => {
    seedAuditRow(Date.now(), 'x');
    const s = runOrchestrationRetentionPrune({});
    expect(s.total_rows_removed).toBe(0);
    expect(countAdminAuditRecords()).toBe(1);
  });
});

describe('Retention: task runs', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-retention-runs-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('max_days deletes old terminal runs; preserves recent and running', () => {
    const team = createTeam({ name: 't' });
    const tOld = createTask({ team_id: team.id, title: 'old', status: 'done' })!;
    const tNew = createTask({ team_id: team.id, title: 'new', status: 'done' })!;
    const tRun = createTask({ team_id: team.id, title: 'live', status: 'running' })!;
    const now = Date.now();

    startTaskRun({
      task_id: tOld.id,
      run_id: 'r1',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'local_process',
    });
    finalizeTaskRun(tOld.id, { status: 'completed', termination_reason: 'success' });
    db.prepare(`UPDATE orchestration_task_runs SET finished_at = ? WHERE task_id = ?`).run(
      now - 100 * DAY_MS,
      tOld.id
    );

    startTaskRun({
      task_id: tNew.id,
      run_id: 'r2',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'local_process',
    });
    finalizeTaskRun(tNew.id, { status: 'completed', termination_reason: 'success' });
    db.prepare(`UPDATE orchestration_task_runs SET finished_at = ? WHERE task_id = ?`).run(now - DAY_MS, tNew.id);

    startTaskRun({
      task_id: tRun.id,
      run_id: 'r3',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'local_process',
    });

    const runCount = (
      db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_runs`).get() as { c: number }
    ).c;
    expect(runCount).toBe(3);

    const s = runOrchestrationRetentionPrune({ taskRunsMaxDays: 30 });
    expect(s.task_runs.removed_by_age).toBe(1);
    const remaining = db
      .prepare(`SELECT task_id FROM orchestration_task_runs ORDER BY task_id`)
      .all() as { task_id: string }[];
    expect(remaining.length).toBe(2);
    const ids = new Set(remaining.map((r) => r.task_id));
    expect(ids.has(tNew.id)).toBe(true);
    expect(ids.has(tRun.id)).toBe(true);
    expect(ids.has(tOld.id)).toBe(false);
  });

  test('max_rows removes oldest finished terminal runs', () => {
    const team = createTeam({ name: 't2' });
    expect(team).toBeTruthy();
    const teamId = team!.id;
    const base = Date.now() - 200 * DAY_MS;
    for (let i = 0; i < 5; i++) {
      const t = createTask({ team_id: teamId, title: `x${i}`, status: 'done' })!;
      startTaskRun({
        task_id: t.id,
        run_id: `run-${i}`,
        team_id: teamId,
        agent_id: 'a',
        environment_kind: 'local_process',
      });
      finalizeTaskRun(t.id, { status: 'completed', termination_reason: 'success' });
      db.prepare(`UPDATE orchestration_task_runs SET finished_at = ? WHERE task_id = ?`).run(
        base + i * 10000,
        t.id
      );
    }
    const s = runOrchestrationRetentionPrune({ taskRunsMaxRows: 2 });
    expect(s.task_runs.removed_by_row_cap).toBe(3);
    const c = db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_runs`).get() as { c: number };
    expect(c.c).toBe(2);
  });
});

describe('Retention: task run history vs live decoupling', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-retention-hist-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('history-only row cap prunes archive without touching live task_runs', () => {
    const team = createTeam({ name: 'h1' })!;
    const t = createTask({ team_id: team.id, title: 'one', status: 'done' })!;
    const base = Date.now() - 50 * DAY_MS;
    startTaskRun({
      task_id: t.id,
      run_id: 'r0',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'local_process',
    });
    finalizeTaskRun(t.id, { status: 'completed', termination_reason: 'success' });
    db.prepare(`UPDATE orchestration_task_runs SET finished_at = ? WHERE task_id = ?`).run(base + 50_000, t.id);
    db.prepare(`UPDATE orchestration_task_run_history SET finished_at = ?, recorded_at = ? WHERE run_id = ?`).run(
      base + 50_000,
      base + 50_000,
      'r0'
    );
    for (let i = 1; i <= 4; i++) {
      insertTaskRunHistoryRow({
        run_id: `extra-${i}`,
        task_id: t.id,
        team_id: team.id,
        finished_at: base + 100 + i * 1000,
      });
    }
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_runs`).get() as { c: number }).c).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(5);

    const s = runOrchestrationRetentionPrune({ taskRunHistoryMaxRows: 2 });
    expect(s.task_runs.removed_by_row_cap + s.task_runs.removed_by_age).toBe(0);
    expect(s.task_run_history.removed_by_row_cap).toBe(3);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_runs`).get() as { c: number }).c).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(2);
    expect(s.task_run_history.limit_source.max_rows).toBe('ORCH_TASK_RUN_HISTORY_MAX_ROWS');
    expect(s.task_run_history.limit_source.max_days).toBeNull();
  });

  test('taskRunsMaxRows only uses same cap for history via per-field fallback (backward compatible)', () => {
    const team = createTeam({ name: 'h2' })!;
    const teamId = team.id;
    const base = Date.now() - 300 * DAY_MS;
    let firstTaskId = '';
    for (let i = 0; i < 5; i++) {
      const t = createTask({ team_id: teamId, title: `t${i}`, status: 'done' })!;
      if (i === 0) firstTaskId = t.id;
      startTaskRun({
        task_id: t.id,
        run_id: `run-${i}`,
        team_id: teamId,
        agent_id: 'a',
        environment_kind: 'local_process',
      });
      finalizeTaskRun(t.id, { status: 'completed', termination_reason: 'success' });
      db.prepare(`UPDATE orchestration_task_runs SET finished_at = ? WHERE task_id = ?`).run(base + i * 10000, t.id);
      db.prepare(`UPDATE orchestration_task_run_history SET finished_at = ?, recorded_at = ? WHERE run_id = ?`).run(
        base + i * 10000,
        base + i * 10000,
        `run-${i}`
      );
    }
    insertTaskRunHistoryRow({
      run_id: 'orph-1',
      task_id: firstTaskId,
      team_id: teamId,
      finished_at: base + 999999,
    });
    insertTaskRunHistoryRow({
      run_id: 'orph-2',
      task_id: firstTaskId,
      team_id: teamId,
      finished_at: base + 999999 + 1,
    });
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(7);

    const s = runOrchestrationRetentionPrune({ taskRunsMaxRows: 3 });
    expect(s.task_runs.removed_by_row_cap).toBe(2);
    expect(s.task_run_history.removed_by_row_cap).toBe(4);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_runs`).get() as { c: number }).c).toBe(3);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(3);
    expect(s.task_run_history.limit_source.max_rows).toBe('ORCH_TASK_RUNS_MAX_ROWS');
  });

  test('tight live row cap with loose history cap leaves archive untouched', () => {
    const team = createTeam({ name: 'h3' })!;
    const teamId = team.id;
    const base = Date.now() - 400 * DAY_MS;
    const taskIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = createTask({ team_id: teamId, title: `w${i}`, status: 'done' })!;
      taskIds.push(t.id);
      startTaskRun({
        task_id: t.id,
        run_id: `w-${i}`,
        team_id: teamId,
        agent_id: 'a',
        environment_kind: 'local_process',
      });
      finalizeTaskRun(t.id, { status: 'completed', termination_reason: 'success' });
      db.prepare(`UPDATE orchestration_task_runs SET finished_at = ? WHERE task_id = ?`).run(base + i * 20000, t.id);
      db.prepare(`UPDATE orchestration_task_run_history SET finished_at = ?, recorded_at = ? WHERE run_id = ?`).run(
        base + i * 20000,
        base + i * 20000,
        `w-${i}`
      );
    }
    for (let j = 0; j < 3; j++) {
      insertTaskRunHistoryRow({
        run_id: `extra-w-${j}`,
        task_id: taskIds[0]!,
        team_id: teamId,
        finished_at: base + 500000 + j,
      });
    }
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(8);

    const s = runOrchestrationRetentionPrune({ taskRunsMaxRows: 2, taskRunHistoryMaxRows: 100 });
    expect(s.task_runs.removed_by_row_cap).toBe(3);
    expect(s.task_run_history.removed_by_row_cap).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_runs`).get() as { c: number }).c).toBe(2);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(8);
    expect(s.task_run_history.limit_source.max_rows).toBe('ORCH_TASK_RUN_HISTORY_MAX_ROWS');
  });

  test('history max_days does not age-prune live rows when taskRunsMaxDays unset', () => {
    const team = createTeam({ name: 'h4' })!;
    const t = createTask({ team_id: team.id, title: 'old-live', status: 'done' })!;
    startTaskRun({
      task_id: t.id,
      run_id: 'live-run',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'local_process',
    });
    finalizeTaskRun(t.id, { status: 'completed', termination_reason: 'success' });
    const ancient = Date.now() - 100 * DAY_MS;
    db.prepare(`UPDATE orchestration_task_runs SET finished_at = ? WHERE task_id = ?`).run(ancient, t.id);
    db.prepare(`UPDATE orchestration_task_run_history SET finished_at = ?, recorded_at = ? WHERE run_id = ?`).run(
      ancient,
      ancient,
      'live-run'
    );
    insertTaskRunHistoryRow({
      run_id: 'hist-old',
      task_id: t.id,
      team_id: team.id,
      finished_at: ancient,
    });
    insertTaskRunHistoryRow({
      run_id: 'hist-fresh',
      task_id: t.id,
      team_id: team.id,
      finished_at: Date.now() - DAY_MS,
    });

    const s = runOrchestrationRetentionPrune({ taskRunHistoryMaxDays: 30 });
    expect(s.task_runs.removed_by_age).toBe(0);
    expect(s.task_run_history.removed_by_age).toBe(2);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_runs`).get() as { c: number }).c).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(1);
    expect(s.task_run_history.limit_source.max_days).toBe('ORCH_TASK_RUN_HISTORY_MAX_DAYS');
  });

  test('history retention: precedence age prune then row cap', () => {
    const team = createTeam({ name: 'h5' })!;
    const teamId = team.id;
    const t = createTask({ team_id: teamId, title: 'anchor', status: 'done' })!;
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      insertTaskRunHistoryRow({
        run_id: `stale-${i}`,
        task_id: t.id,
        team_id: teamId,
        finished_at: now - 60 * DAY_MS - i * 1000,
      });
    }
    for (let j = 0; j < 10; j++) {
      insertTaskRunHistoryRow({
        run_id: `fresh-${j}`,
        task_id: t.id,
        team_id: teamId,
        finished_at: now - j * 1000,
      });
    }
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(15);

    const s = runOrchestrationRetentionPrune({ taskRunHistoryMaxDays: 30, taskRunHistoryMaxRows: 8 });
    expect(s.task_run_history.removed_by_age).toBe(5);
    expect(s.task_run_history.removed_by_row_cap).toBe(2);
    expect((db.prepare(`SELECT COUNT(*) as c FROM orchestration_task_run_history`).get() as { c: number }).c).toBe(8);
  });
});

describe('GET /admin/retention-config', () => {
  let dbPath: string;
  let orch: ReturnType<typeof bootstrapOrchestration>;
  let prevRetentionEnv: Record<string, string | undefined>;

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-orchestration-admin-token',
  };

  beforeEach(() => {
    prevRetentionEnv = snapshotRetentionEnv();
    for (const k of RETENTION_ENV_KEYS) delete process.env[k];
    dbPath = path.join(tmpdir(), `orch-retention-config-api-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    orch = bootstrapOrchestration(new Set());
  });

  afterEach(async () => {
    restoreRetentionEnv(prevRetentionEnv);
    await new Promise((r) => setTimeout(r, 80));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('returns resolved limits, limit_source, and read_only (no prune side effects)', async () => {
    process.env.ORCH_ADMIN_AUDIT_MAX_DAYS = '14';
    process.env.ORCH_TASK_RUNS_MAX_ROWS = '7';
    process.env.ORCH_TASK_RUN_HISTORY_MAX_ROWS = '99';
    const beforeAudit = countAdminAuditRecords();
    const req = new Request('http://localhost/api/orchestration/admin/retention-config', { method: 'GET' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    const j = (await res!.json()) as {
      retention: {
        read_only: boolean;
        admin_audit: {
          max_days: number | null;
          max_rows: number | null;
          limit_source: { max_days: string | null; max_rows: string | null };
        };
        task_runs: { max_rows: number | null; limit_source: { max_rows: string | null; max_days: string | null } };
        task_run_history: {
          max_days: number | null;
          max_rows: number | null;
          limit_source: { max_days: string | null; max_rows: string | null };
          notes: string[];
        };
      };
    };
    expect(j.retention.read_only).toBe(true);
    expect(j.retention.admin_audit.max_days).toBe(14);
    expect(j.retention.admin_audit.max_rows).toBeNull();
    expect(j.retention.admin_audit.limit_source.max_days).toBe('ORCH_ADMIN_AUDIT_MAX_DAYS');
    expect(j.retention.task_runs.max_rows).toBe(7);
    expect(j.retention.task_run_history.max_rows).toBe(99);
    expect(j.retention.task_run_history.limit_source.max_rows).toBe('ORCH_TASK_RUN_HISTORY_MAX_ROWS');
    expect(j.retention.task_run_history.max_days).toBeNull();
    expect(j.retention.task_run_history.limit_source.max_days).toBeNull();
    const direct = getOrchestrationRetentionConfigView();
    expect(j.retention).toEqual(direct);
    expect(countAdminAuditRecords()).toBe(beforeAudit);
  });

  test('history row limit falls back to ORCH_TASK_RUNS_MAX_ROWS with correct limit_source and notes', async () => {
    process.env.ORCH_TASK_RUNS_MAX_ROWS = '4';
    const req = new Request('http://localhost/api/orchestration/admin/retention-config', { method: 'GET' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    const j = (await res!.json()) as {
      retention: { task_run_history: { max_rows: number | null; limit_source: { max_rows: string | null }; notes: string[] } };
    };
    expect(j.retention.task_run_history.max_rows).toBe(4);
    expect(j.retention.task_run_history.limit_source.max_rows).toBe('ORCH_TASK_RUNS_MAX_ROWS');
    expect(j.retention.task_run_history.notes.some((n) => n.includes('ORCH_TASK_RUN_HISTORY_MAX_ROWS'))).toBe(true);
  });

  test('no retention env: all effective limits null and notes explain', async () => {
    const req = new Request('http://localhost/api/orchestration/admin/retention-config', { method: 'GET' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    const j = (await res!.json()) as {
      retention: {
        admin_audit: { max_days: number | null; max_rows: number | null; notes: string[] };
        task_runs: { max_days: number | null; max_rows: number | null; notes: string[] };
        task_run_history: { max_days: number | null; max_rows: number | null; notes: string[] };
      };
    };
    expect(j.retention.admin_audit.max_days).toBeNull();
    expect(j.retention.task_runs.max_rows).toBeNull();
    expect(j.retention.task_run_history.max_rows).toBeNull();
    expect(j.retention.admin_audit.notes.some((n) => n.includes('No limits configured'))).toBe(true);
  });
});

describe('POST /admin/prune-history', () => {
  let dbPath: string;
  let prevToken: string | undefined;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-orchestration-admin-token',
  };

  beforeEach(() => {
    prevToken = process.env.ORCH_ADMIN_TOKEN;
    delete process.env.ORCH_ADMIN_TOKEN;
    dbPath = path.join(tmpdir(), `orch-prune-api-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    orch = bootstrapOrchestration(new Set());
    process.env.ORCH_ADMIN_AUDIT_MAX_ROWS = '1';
    seedAuditRow(Date.now() - 5000, 'a');
    seedAuditRow(Date.now() - 4000, 'b');
    expect(countAdminAuditRecords()).toBe(2);
  });

  afterEach(async () => {
    delete process.env.ORCH_ADMIN_AUDIT_MAX_ROWS;
    if (prevToken === undefined) delete process.env.ORCH_ADMIN_TOKEN;
    else process.env.ORCH_ADMIN_TOKEN = prevToken;
    await new Promise((r) => setTimeout(r, 80));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('open mode: POST prune applies retention and returns summary', async () => {
    const req = new Request('http://localhost/api/orchestration/admin/prune-history', { method: 'POST' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    const j = (await res!.json()) as { summary: { total_rows_removed: number } };
    expect(j.summary.total_rows_removed).toBeGreaterThanOrEqual(1);
    expect(countAdminAuditRecords()).toBe(2);
    const pruneAudits = listAdminAuditRecords({ action: 'retention_prune', limit: 5 });
    expect(pruneAudits.length).toBeGreaterThanOrEqual(1);
  });
});
