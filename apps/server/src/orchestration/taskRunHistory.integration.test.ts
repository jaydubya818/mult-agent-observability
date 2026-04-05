import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, db, initDatabase } from '../db';
import { bootstrapOrchestration } from './bootstrap';
import {
  appendTaskRunStream,
  countTaskRunHistory,
  createTask,
  createTeam,
  finalizeTaskRun,
  initOrchestrationSchema,
  listTaskRunHistory,
  recordPreStartRejectedRun,
  startTaskRun,
} from './repository';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-orchestration-admin-token',
};

describe('Task run history (repository)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-run-hist-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 40));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('each finalized attempt produces a history row (multi-attempt)', () => {
    const team = createTeam({ name: 'T' });
    const task = createTask({ team_id: team.id, title: 'x', status: 'running' })!;
    startTaskRun({
      task_id: task.id,
      run_id: 'run-a',
      team_id: team.id,
      agent_id: 'ag',
      environment_kind: 'simulated',
      attempt: 1,
    });
    finalizeTaskRun(task.id, { status: 'failed', termination_reason: 'process_error' });
    startTaskRun({
      task_id: task.id,
      run_id: 'run-b',
      team_id: team.id,
      agent_id: 'ag',
      environment_kind: 'simulated',
      attempt: 2,
    });
    finalizeTaskRun(task.id, { status: 'completed', termination_reason: 'success' });
    const rows = listTaskRunHistory({ task_id: task.id, limit: 50 });
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.run_id))).toEqual(new Set(['run-a', 'run-b']));
  });

  test('pre-start policy rejection is archived once', () => {
    const team = createTeam({ name: 'T2' });
    const task = createTask({ team_id: team.id, title: 'y', status: 'queued' })!;
    recordPreStartRejectedRun({
      task_id: task.id,
      run_id: 'pre-1',
      team_id: team.id,
      agent_id: 'ag',
      environment_kind: 'local_process',
      error_message: 'no shell for you',
    });
    const rows = listTaskRunHistory({ task_id: task.id });
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('policy_rejected');
    expect(rows[0]!.error_message).toContain('no shell');
  });

  test('filters: team_id, status, text search on stderr tail', () => {
    const teamA = createTeam({ name: 'A' });
    const teamB = createTeam({ name: 'B' });
    const ta = createTask({ team_id: teamA.id, title: 'a', status: 'running' })!;
    const tb = createTask({ team_id: teamB.id, title: 'b', status: 'running' })!;
    startTaskRun({
      task_id: ta.id,
      run_id: 'ra',
      team_id: teamA.id,
      agent_id: 'x',
      environment_kind: 'local_process',
    });
    appendTaskRunStream(ta.id, 'stderr', 'UNIQUE_ERR_MARKER_alpha');
    finalizeTaskRun(ta.id, { status: 'failed', termination_reason: 'process_error' });

    startTaskRun({
      task_id: tb.id,
      run_id: 'rb',
      team_id: teamB.id,
      agent_id: 'x',
      environment_kind: 'simulated',
    });
    finalizeTaskRun(tb.id, { status: 'completed', termination_reason: 'success' });

    expect(countTaskRunHistory({ team_id: teamA.id })).toBe(1);
    expect(countTaskRunHistory({ status: 'completed' })).toBe(1);
    expect(countTaskRunHistory({ q: 'UNIQUE_ERR_MARKER_alpha' })).toBe(1);
    const hits = listTaskRunHistory({ q: 'UNIQUE_ERR_MARKER_alpha', limit: 10 });
    expect(hits[0]!.task_id).toBe(ta.id);
  });

  test('pagination: total count and offset/limit', () => {
    const team = createTeam({ name: 'P' });
    for (let i = 0; i < 5; i++) {
      const t = createTask({ team_id: team.id, title: `t${i}`, status: 'running' })!;
      startTaskRun({
        task_id: t.id,
        run_id: `r${i}`,
        team_id: team.id,
        agent_id: 'a',
        environment_kind: 'simulated',
      });
      finalizeTaskRun(t.id, { status: 'completed', termination_reason: 'success' });
    }
    expect(countTaskRunHistory({ team_id: team.id })).toBe(5);
    const page1 = listTaskRunHistory({ team_id: team.id, limit: 2, offset: 0 });
    const page2 = listTaskRunHistory({ team_id: team.id, limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    expect(new Set([...page1, ...page2].map((r) => r.run_id)).size).toBe(4);
  });

  test('time range on finished_at', () => {
    const team = createTeam({ name: 'time' });
    const t1 = createTask({ team_id: team.id, title: 'old', status: 'running' })!;
    const t2 = createTask({ team_id: team.id, title: 'new', status: 'running' })!;
    const now = Date.now();
    startTaskRun({
      task_id: t1.id,
      run_id: 'old-run',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'simulated',
    });
    finalizeTaskRun(t1.id, { status: 'completed', termination_reason: 'success' });
    startTaskRun({
      task_id: t2.id,
      run_id: 'new-run',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'simulated',
    });
    finalizeTaskRun(t2.id, { status: 'completed', termination_reason: 'success' });

    db.prepare(`UPDATE orchestration_task_run_history SET finished_at = ? WHERE run_id = ?`).run(
      now - 100_000,
      'old-run'
    );
    db.prepare(`UPDATE orchestration_task_run_history SET finished_at = ? WHERE run_id = ?`).run(now - 1000, 'new-run');

    const within = listTaskRunHistory({
      finished_at_min: now - 50_000,
      finished_at_max: now,
      team_id: team.id,
    });
    expect(within.length).toBe(1);
    expect(within[0]!.run_id).toBe('new-run');
  });
});

describe('Task run history (HTTP)', () => {
  let dbPath: string;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  beforeEach(() => {
    dbPath = path.join(tmpdir(), `orch-run-hist-http-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    orch = bootstrapOrchestration(new Set());
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 40));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('GET /api/orchestration/task-runs returns archived rows', async () => {
    const team = createTeam({ name: 'HTTP' });
    const task = createTask({ team_id: team.id, title: 'h', status: 'running' })!;
    startTaskRun({
      task_id: task.id,
      run_id: 'http-run',
      team_id: team.id,
      agent_id: 'a',
      environment_kind: 'simulated',
    });
    finalizeTaskRun(task.id, { status: 'failed', termination_reason: 'process_error' });

    const url = new URL('http://localhost/api/orchestration/task-runs?limit=5');
    const res = await orch.handleOrchestrationFetch(new Request(url.toString(), { method: 'GET' }), url, CORS);
    expect(res!.status).toBe(200);
    const j = (await res!.json()) as { runs: { run_id: string }[]; total: number };
    expect(j.total).toBeGreaterThanOrEqual(1);
    expect(j.runs.some((r) => r.run_id === 'http-run')).toBe(true);
  });

  test('GET /api/orchestration/tasks/:id/runs scopes to task', async () => {
    const team = createTeam({ name: 'HTTP2' });
    const t1 = createTask({ team_id: team.id, title: 'a', status: 'running' })!;
    const t2 = createTask({ team_id: team.id, title: 'b', status: 'running' })!;
    for (const spec of [
      { t: t1, run: 'only-a' },
      { t: t2, run: 'only-b' },
    ]) {
      startTaskRun({
        task_id: spec.t.id,
        run_id: spec.run,
        team_id: team.id,
        agent_id: 'a',
        environment_kind: 'simulated',
      });
      finalizeTaskRun(spec.t.id, { status: 'completed', termination_reason: 'success' });
    }
    const url = new URL(`http://localhost/api/orchestration/tasks/${t1.id}/runs`);
    const res = await orch.handleOrchestrationFetch(new Request(url.toString(), { method: 'GET' }), url, CORS);
    expect(res!.status).toBe(200);
    const j = (await res!.json()) as { runs: { run_id: string }[]; total: number };
    expect(j.total).toBe(1);
    expect(j.runs[0]!.run_id).toBe('only-a');
  });

  test('invalid status returns 400', async () => {
    const url = new URL('http://localhost/api/orchestration/task-runs?status=not_a_status');
    const res = await orch.handleOrchestrationFetch(new Request(url.toString(), { method: 'GET' }), url, CORS);
    expect(res!.status).toBe(400);
  });
});
