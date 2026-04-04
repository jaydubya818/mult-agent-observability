import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeDatabase, initDatabase } from '../db';
import { bootstrapOrchestration } from './bootstrap';
import {
  createExecutionPolicy,
  createTeam,
  getTeamById,
  initOrchestrationSchema,
} from './repository';

const ADMIN_TOKEN = 'integration-test-admin-token';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-orchestration-admin-token',
};

describe('ORCH_ADMIN_TOKEN (protected mode)', () => {
  let dbPath: string;
  let prevToken: string | undefined;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  beforeEach(() => {
    prevToken = process.env.ORCH_ADMIN_TOKEN;
    process.env.ORCH_ADMIN_TOKEN = ADMIN_TOKEN;
    dbPath = path.join(tmpdir(), `orch-admin-${crypto.randomUUID()}.db`);
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

  test('POST /policies 401 without token (code missing)', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'p1' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
    const j = (await res!.json()) as { code: string };
    expect(j.code).toBe('orchestration_admin_token_missing');
  });

  test('POST /policies 401 with wrong token (code invalid)', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-orchestration-admin-token': 'wrong',
      },
      body: JSON.stringify({ name: 'p1' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
    const j = (await res!.json()) as { code: string };
    expect(j.code).toBe('orchestration_admin_token_invalid');
  });

  test('POST /policies 201 with matching header token', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-orchestration-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ name: 'p-ok' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(201);
    const j = (await res!.json()) as { name: string };
    expect(j.name).toBe('p-ok');
  });

  test('POST /policies 201 with Authorization Bearer token', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({ name: 'p-bearer' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(201);
  });

  test('GET /snapshot 200 without token', async () => {
    const req = new Request('http://localhost/api/orchestration/snapshot', { method: 'GET' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
  });

  test('GET /policies list 200 without token', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', { method: 'GET' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
  });

  test('GET /admin-audit 401 without token when protected', async () => {
    const req = new Request('http://localhost/api/orchestration/admin-audit', { method: 'GET' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
  });

  test('GET /admin-audit 200 with token', async () => {
    const req = new Request('http://localhost/api/orchestration/admin-audit', {
      method: 'GET',
      headers: { 'x-orchestration-admin-token': ADMIN_TOKEN },
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    const j = (await res!.json()) as { records: unknown[] };
    expect(Array.isArray(j.records)).toBe(true);
  });

  test('PUT team execution-policy assigns when authorized', async () => {
    const pol = createExecutionPolicy({ name: 'assign-me', cmd_allowlist: ['echo'] });
    const team = createTeam({ name: 'team-a' });
    const req = new Request(`http://localhost/api/orchestration/teams/${team.id}/execution-policy`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-orchestration-admin-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ execution_policy_id: pol.id }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
    const updated = getTeamById(team.id);
    expect(updated?.execution_policy_id).toBe(pol.id);
  });

  test('PUT team execution-policy 401 without token', async () => {
    const pol = createExecutionPolicy({ name: 'p2' });
    const team = createTeam({ name: 'team-b' });
    const req = new Request(`http://localhost/api/orchestration/teams/${team.id}/execution-policy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ execution_policy_id: pol.id }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
  });

  test('PATCH team name allowed without token; execution_policy_id change requires token', async () => {
    const pol = createExecutionPolicy({ name: 'p3' });
    const team = createTeam({ name: 'team-c' });

    const patchName = new Request(`http://localhost/api/orchestration/teams/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'team-c-renamed' }),
    });
    const resName = await orch.handleOrchestrationFetch(patchName, new URL(patchName.url), CORS);
    expect(resName!.status).toBe(200);

    const patchPol = new Request(`http://localhost/api/orchestration/teams/${team.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ execution_policy_id: pol.id }),
    });
    const resPol = await orch.handleOrchestrationFetch(patchPol, new URL(patchPol.url), CORS);
    expect(resPol!.status).toBe(401);
  });

  test('demo seed 401 without token when admin configured', async () => {
    const req = new Request('http://localhost/api/orchestration/demo/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
  });

  test('POST /admin/prune-history 401 without token when protected', async () => {
    const req = new Request('http://localhost/api/orchestration/admin/prune-history', { method: 'POST' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(401);
  });
});

describe('ORCH_ADMIN_TOKEN unset (open mode)', () => {
  let dbPath: string;
  let prevToken: string | undefined;
  let orch: ReturnType<typeof bootstrapOrchestration>;

  beforeEach(() => {
    prevToken = process.env.ORCH_ADMIN_TOKEN;
    delete process.env.ORCH_ADMIN_TOKEN;
    dbPath = path.join(tmpdir(), `orch-open-${crypto.randomUUID()}.db`);
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

  test('POST /policies succeeds without token', async () => {
    const req = new Request('http://localhost/api/orchestration/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'open-mode-policy' }),
    });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(201);
  });

  test('GET /admin-audit works without token in open mode', async () => {
    const req = new Request('http://localhost/api/orchestration/admin-audit', { method: 'GET' });
    const res = await orch.handleOrchestrationFetch(req, new URL(req.url), CORS);
    expect(res!.status).toBe(200);
  });
});
