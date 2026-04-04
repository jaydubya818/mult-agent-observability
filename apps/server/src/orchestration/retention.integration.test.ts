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
import { runOrchestrationRetentionPrune } from './retention';

const DAY_MS = 24 * 60 * 60 * 1000;

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
