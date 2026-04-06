import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
import { bootstrapOrchestration } from './bootstrap';
import { createExecutionPolicy, createTeam, initOrchestrationSchema } from './repository';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-orchestration-admin-token',
};

function expectCors(res: Response) {
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
}

describe('Orchestration HTTP CORS headers on JSON responses', () => {
  let dbPath: string;
  let prevToken: string | undefined;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  beforeEach(() => {
    prevToken = process.env.ORCH_ADMIN_TOKEN;
    delete process.env.ORCH_ADMIN_TOKEN;
    dbPath = path.join(tmpdir(), `orch-cors-${crypto.randomUUID()}.db`);
    initDatabase(dbPath);
    initOrchestrationSchema();
    orch = bootstrapOrchestration(new Set());
  });

  afterEach(async () => {
    if (prevToken === undefined) delete process.env.ORCH_ADMIN_TOKEN;
    else process.env.ORCH_ADMIN_TOKEN = prevToken;
    await new Promise((r) => setTimeout(r, 120));
    closeDatabase();
    try {
      unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  });

  test('GET /teams/:id/effective-execution-policy includes CORS on success', async () => {
    const team = createTeam({ name: 'cors-team' });
    const req = new Request(
      `http://localhost/api/orchestration/teams/${team.id}/effective-execution-policy`,
      { method: 'GET' }
    );
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    expectCors(res!);
    const j = (await res!.json()) as { team_id: string; effective: unknown };
    expect(j.team_id).toBe(team.id);
    expect(j.effective).toBeDefined();
  });

  test('PUT /teams/:id/execution-policy includes CORS on success (open mode)', async () => {
    const pol = createExecutionPolicy({ name: 'cors-pol', cmd_allowlist: ['echo'] });
    const team = createTeam({ name: 'cors-team-put' });
    const req = new Request(`http://localhost/api/orchestration/teams/${team.id}/execution-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ execution_policy_id: pol.id }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    expectCors(res!);
  });
});
